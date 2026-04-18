/**
 * Persistent log-file sink for the Diagnostics surface (CR23).
 *
 * Writes to `<vault>/.obsidian/plugins/<plugin-id>/debug.log` via the
 * Obsidian DataAdapter (no Node `fs`). All writes are serialized through
 * a per-instance promise chain so concurrent log calls do not interleave,
 * and the file is rotated in place when it grows past 1 MiB.
 */

export const LOG_FILE_NAME = 'debug.log';
export const ROTATE_THRESHOLD_BYTES = 1024 * 1024;
export const ROTATE_KEEP_BYTES = 512 * 1024;
export const ROTATE_MARKER = '--- rotated ---\n';

interface AdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  stat(path: string): Promise<{ size: number } | null>;
}

export interface LogFilePluginRef {
  app: { vault: { configDir: string; adapter: AdapterLike } };
  manifest: { id: string };
}

export function getLogFilePath(plugin: LogFilePluginRef): string {
  const configDir = plugin.app.vault.configDir;
  return `${configDir}/plugins/${plugin.manifest.id}/${LOG_FILE_NAME}`;
}

export function createLogFileSink(
  plugin: LogFilePluginRef,
): (line: string) => void {
  const adapter = plugin.app.vault.adapter;
  const path = getLogFilePath(plugin);
  let chain: Promise<void> = Promise.resolve();

  return (line: string): void => {
    chain = chain
      .then(() => writeOneLine(adapter, path, line))
      .catch(() => {
        // Logging must never throw — swallow disk errors.
      });
  };
}

export async function readLogFile(plugin: LogFilePluginRef): Promise<string> {
  const adapter = plugin.app.vault.adapter;
  const path = getLogFilePath(plugin);
  if (!(await adapter.exists(path))) {
    return '';
  }
  return adapter.read(path);
}

export async function clearLogFile(plugin: LogFilePluginRef): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const path = getLogFilePath(plugin);
  await adapter.write(path, '');
}

async function writeOneLine(
  adapter: AdapterLike,
  path: string,
  line: string,
): Promise<void> {
  await rotateIfNeeded(adapter, path);
  const payload = `${line}\n`;
  if (await adapter.exists(path)) {
    await adapter.append(path, payload);
  } else {
    await adapter.write(path, payload);
  }
}

async function rotateIfNeeded(
  adapter: AdapterLike,
  path: string,
): Promise<void> {
  const stats = await adapter.stat(path);
  if (!stats || stats.size <= ROTATE_THRESHOLD_BYTES) {
    return;
  }
  const existing = await adapter.read(path);
  const tail = existing.slice(-ROTATE_KEEP_BYTES);
  // Drop the leading partial line so the rotated file starts cleanly.
  const firstNewline = tail.indexOf('\n');
  const aligned = firstNewline === -1 ? tail : tail.slice(firstNewline + 1);
  await adapter.write(path, ROTATE_MARKER + aligned);
}
