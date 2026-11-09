import { browser } from '@wdio/globals';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

export const PLUGIN_ID = 'vault-mcp-server';

/**
 * Port the plugin listens on during the E2E run. Not the default 28741, so a
 * developer's own Obsidian with the plugin running does not answer instead.
 * E2E_MCP_PORT overrides it.
 */
export const MCP_PORT = Number(process.env.E2E_MCP_PORT ?? '28749');

/** Bearer access key the specs configure; only valid for the throwaway vault. */
export const ACCESS_KEY = 'e2e-access-key-not-a-secret';

/** The plugin fields the specs touch, read through `app.plugins`. */
interface McpPluginHandle {
  settings: {
    serverAddress: string;
    port: number;
    authEnabled: boolean;
    accessKey: string;
    httpsEnabled: boolean;
    autoStart: boolean;
  };
  saveSettings(): Promise<void>;
  restartServer(): Promise<void>;
  lastStartError: { port: number; message: string } | null;
}

/**
 * Configure the plugin for the test (127.0.0.1, fixed port, Bearer auth with
 * a known key, plain HTTP) and (re)start its server through the plugin's own
 * start path. Throws with the plugin's start error if the bind fails.
 */
export async function startMcpServer(): Promise<void> {
  const error = await browser.executeObsidian(
    async ({ app }, pluginId, port, accessKey) => {
      const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins;
      const plugin = plugins[pluginId] as McpPluginHandle | undefined;
      if (!plugin) return `plugin ${pluginId} is not loaded`;
      Object.assign(plugin.settings, {
        serverAddress: '127.0.0.1',
        port,
        authEnabled: true,
        accessKey,
        httpsEnabled: false,
        autoStart: false,
      });
      await plugin.saveSettings();
      await plugin.restartServer();
      return plugin.lastStartError?.message ?? null;
    },
    PLUGIN_ID,
    MCP_PORT,
    ACCESS_KEY,
  );
  if (error !== null) throw new Error(`MCP server did not start: ${error}`);
}

/** Connect an MCP SDK client to the plugin over Streamable HTTP. */
export async function connectClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${String(MCP_PORT)}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${ACCESS_KEY}` } } },
  );
  const client = new Client({ name: 'vault-mcp-e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

/** Call a tool; fail with its text when the tool reports an error. */
export async function callTool<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) {
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
    throw new Error(`${name} failed: ${text}`);
  }
  if (result.structuredContent === undefined) {
    throw new Error(`${name} returned no structuredContent`);
  }
  return result.structuredContent as T;
}

/** Absolute path of the (temporary) vault Obsidian has open. */
export async function vaultBasePath(): Promise<string> {
  return browser.executeObsidian(({ app }) =>
    (app.vault.adapter as unknown as { getBasePath(): string }).getBasePath(),
  );
}

/** Read a vault file from disk, bypassing Obsidian. `null` when missing. */
export async function readFromDisk(vaultPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(await vaultBasePath(), vaultPath), 'utf8');
  } catch {
    return null;
  }
}

/** Set a vault config key (`.obsidian/app.json`), e.g. alwaysUpdateLinks. */
export async function setVaultConfig(key: string, value: unknown): Promise<void> {
  await browser.executeObsidian(
    ({ app }, k, v) => {
      (app.vault as unknown as { setConfig(key: string, value: unknown): void }).setConfig(k, v);
    },
    key,
    value,
  );
}

/** Create (or overwrite) notes through Obsidian, creating parent folders. */
export async function writeNotes(notes: Record<string, string>): Promise<void> {
  await browser.executeObsidian(async ({ app }, files) => {
    for (const [filePath, content] of Object.entries(files)) {
      const folder = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
      if (folder !== '' && app.vault.getAbstractFileByPath(folder) === null) {
        await app.vault.createFolder(folder);
      }
      const existing = app.vault.getAbstractFileByPath(filePath);
      if (existing) {
        await app.vault.adapter.write(filePath, content);
      } else {
        await app.vault.create(filePath, content);
      }
    }
  }, notes);
}

/**
 * Wait until the metadata cache has indexed every given note and resolved
 * the expected link counts (`source -> target -> count`).
 */
export async function waitForLinks(
  expected: Record<string, Record<string, number>>,
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.executeObsidian(({ app }, want) => {
        const resolved = app.metadataCache.resolvedLinks;
        return Object.entries(want).every(([source, targets]) =>
          Object.entries(targets).every(([target, n]) => resolved[source]?.[target] === n),
        );
      }, expected),
    { timeout: 30000, timeoutMsg: `links not resolved: ${JSON.stringify(expected)}` },
  );
}

/** Wait until the metadata cache has an entry for each path. */
export async function waitForCache(paths: string[]): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.executeObsidian(({ app }, notePaths) => {
        return notePaths.every((p) => {
          const file = app.vault.getAbstractFileByPath(p);
          return file !== null && app.metadataCache.getCache(p) !== null;
        });
      }, paths),
    { timeout: 30000, timeoutMsg: `no metadata cache for ${paths.join(', ')}` },
  );
}
