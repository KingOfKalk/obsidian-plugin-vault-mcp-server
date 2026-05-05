import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearLogFile,
  createLogFileSink,
  getLogFilePath,
  readLogFile,
  ROTATE_KEEP_BYTES,
  ROTATE_MARKER,
  ROTATE_THRESHOLD_BYTES,
} from '../../src/utils/log-file';

interface FakeAdapter {
  files: Map<string, string>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  stat(path: string): Promise<{ size: number } | null>;
}

function createFakeAdapter(): FakeAdapter {
  const files = new Map<string, string>();
  return {
    files,
    exists: (path: string): Promise<boolean> => Promise.resolve(files.has(path)),
    read: (path: string): Promise<string> => {
      const v = files.get(path);
      if (v === undefined) return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(v);
    },
    write: (path: string, data: string): Promise<void> => {
      files.set(path, data);
      return Promise.resolve();
    },
    append: (path: string, data: string): Promise<void> => {
      files.set(path, (files.get(path) ?? '') + data);
      return Promise.resolve();
    },
    stat: (path: string): Promise<{ size: number } | null> => {
      const v = files.get(path);
      if (v === undefined) return Promise.resolve(null);
      return Promise.resolve({ size: Buffer.byteLength(v, 'utf8') });
    },
  };
}

function makePlugin(adapter: FakeAdapter): {
  app: { vault: { adapter: FakeAdapter; configDir: string } };
  manifest: { id: string };
} {
  return {
    app: { vault: { adapter, configDir: '.obsidian' } },
    manifest: { id: 'vault-mcp-server' },
  };
}

const expectedPath = '.obsidian/plugins/vault-mcp-server/debug.log';

async function flush(): Promise<void> {
  // The sink serializes writes through a Promise chain whose individual
  // links each await several microtasks (exists / stat / write or
  // append). Drain a generous number of microtasks so the chain settles
  // even for batches of ~50 calls.
  for (let i = 0; i < 500; i++) {
    await Promise.resolve();
  }
}

describe('log-file', () => {
  let adapter: FakeAdapter;
  let plugin: ReturnType<typeof makePlugin>;

  beforeEach(() => {
    adapter = createFakeAdapter();
    plugin = makePlugin(adapter);
  });

  describe('getLogFilePath', () => {
    it('returns <configDir>/plugins/<id>/debug.log', () => {
      expect(getLogFilePath(plugin)).toBe(expectedPath);
    });
  });

  describe('readLogFile', () => {
    it('returns "" when the file does not exist', async () => {
      expect(await readLogFile(plugin)).toBe('');
    });

    it('returns the file contents when it exists', async () => {
      adapter.files.set(expectedPath, 'hello\n');
      expect(await readLogFile(plugin)).toBe('hello\n');
    });
  });

  describe('clearLogFile', () => {
    it('writes an empty string to the file', async () => {
      adapter.files.set(expectedPath, 'old data\n');
      await clearLogFile(plugin);
      expect(adapter.files.get(expectedPath)).toBe('');
    });
  });

  describe('createLogFileSink', () => {
    it('creates the file on first write and appends a newline', async () => {
      const sink = createLogFileSink(plugin);
      sink('first');
      await flush();
      expect(adapter.files.get(expectedPath)).toBe('first\n');
    });

    it('appends subsequent lines instead of overwriting', async () => {
      const sink = createLogFileSink(plugin);
      sink('one');
      sink('two');
      sink('three');
      await flush();
      expect(adapter.files.get(expectedPath)).toBe('one\ntwo\nthree\n');
    });

    it('serializes concurrent writes (no interleaving)', async () => {
      const sink = createLogFileSink(plugin);
      const lines = Array.from({ length: 50 }, (_, i) => `line-${String(i)}`);
      for (const l of lines) sink(l);
      await flush();
      const expected = lines.map((l) => `${l}\n`).join('');
      expect(adapter.files.get(expectedPath)).toBe(expected);
    });

    it('rotates when the file exceeds the threshold', async () => {
      // Pre-seed a file comfortably over the threshold. Lines are
      // 9 bytes (`n-NNNNNN\n`) so we need at least
      // ceil(threshold / 9) + buffer entries.
      const lineCount = Math.ceil(ROTATE_THRESHOLD_BYTES / 9) + 1000;
      const seeded =
        Array.from(
          { length: lineCount },
          (_, i) => `n-${String(i).padStart(6, '0')}`,
        ).join('\n') + '\n';
      adapter.files.set(expectedPath, seeded);
      expect(Buffer.byteLength(seeded, 'utf8')).toBeGreaterThan(
        ROTATE_THRESHOLD_BYTES,
      );

      const sink = createLogFileSink(plugin);
      sink('after-rotate');
      await flush();

      const result = adapter.files.get(expectedPath) ?? '';
      expect(result.startsWith(ROTATE_MARKER)).toBe(true);
      expect(result.endsWith('after-rotate\n')).toBe(true);
      // Rotated payload is bounded by ROTATE_KEEP_BYTES + marker + new line.
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThan(
        ROTATE_KEEP_BYTES + ROTATE_MARKER.length + 50,
      );
    });

    it('does not rotate when the file is under the threshold', async () => {
      adapter.files.set(expectedPath, 'small\n');
      const sink = createLogFileSink(plugin);
      sink('next');
      await flush();
      expect(adapter.files.get(expectedPath)).toBe('small\nnext\n');
    });

    it('swallows adapter errors so the sink never throws', async () => {
      const failing: FakeAdapter = {
        files: new Map(),
        exists: (): Promise<boolean> => Promise.reject(new Error('boom')),
        read: (): Promise<string> => Promise.reject(new Error('boom')),
        write: (): Promise<void> => Promise.reject(new Error('boom')),
        append: (): Promise<void> => Promise.reject(new Error('boom')),
        stat: (): Promise<{ size: number } | null> =>
          Promise.reject(new Error('boom')),
      };
      const sink = createLogFileSink(makePlugin(failing));
      expect(() => sink('x')).not.toThrow();
      await flush();
    });
  });
});
