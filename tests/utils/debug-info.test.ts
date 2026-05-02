import { describe, it, expect, beforeEach } from 'vitest';
import { collectDebugInfo, type DebugInfoPluginRef } from '../../src/utils/debug-info';
import type { McpPluginSettings } from '../../src/types';
import type { ModuleRegistration, ToolModule } from '../../src/registry/types';

const SECRET = 'super-secret-access-key';
const FAKE_PEM = '-----BEGIN CERTIFICATE-----\nABCDEF\n-----END CERTIFICATE-----';

interface FakeAdapter {
  files: Map<string, string>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  stat(path: string): Promise<{ size: number } | null>;
}

function adapter(files: Record<string, string> = {}): FakeAdapter {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    exists: (p: string): Promise<boolean> => Promise.resolve(map.has(p)),
    read: (p: string): Promise<string> => {
      const v = map.get(p);
      if (v === undefined) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve(v);
    },
    write: (p: string, d: string): Promise<void> => {
      map.set(p, d);
      return Promise.resolve();
    },
    append: (p: string, d: string): Promise<void> => {
      map.set(p, (map.get(p) ?? '') + d);
      return Promise.resolve();
    },
    stat: (p: string): Promise<{ size: number } | null> => {
      const v = map.get(p);
      return Promise.resolve(v === undefined ? null : { size: v.length });
    },
  };
}

function makeModule(
  id: string,
  group: 'extras' | undefined,
  toolNames: string[] = [],
): ToolModule {
  return {
    metadata: {
      id,
      name: id,
      description: '',
      ...(group ? { group } : {}),
    },
    tools(): ReturnType<ToolModule['tools']> {
      return toolNames.map((name) => ({
        name,
        description: '',
        schema: {},
        handler: () => Promise.resolve({ content: [] }),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      }));
    },
  };
}

const baseSettings: McpPluginSettings = {
  schemaVersion: 10,
  serverAddress: '127.0.0.1',
  port: 28741,
  authEnabled: true,
  accessKey: SECRET,
  httpsEnabled: false,
  tlsCertificate: { cert: FAKE_PEM, key: FAKE_PEM },
  useCustomTls: false,
  customTlsCertPath: null,
  customTlsKeyPath: null,
  debugMode: true,
  autoStart: false,
  executeCommandAllowlist: [],
  allowedOrigins: [
    'http://127.0.0.1',
    'http://localhost',
    'https://127.0.0.1',
    'https://localhost',
  ],
  allowedHosts: ['127.0.0.1', 'localhost'],
  allowNullOrigin: false,
  requireOrigin: false,
  iAcceptInsecureMode: false,
  seenInsecureWarning: true,
  moduleStates: {},
};

function makePlugin(opts: {
  settings?: Partial<McpPluginSettings>;
  files?: Record<string, string>;
  httpServer?: DebugInfoPluginRef['httpServer'];
  modules?: ModuleRegistration[];
} = {}): DebugInfoPluginRef {
  const a = adapter(opts.files);
  return {
    app: {
      vault: { adapter: a, configDir: '.obsidian' },
      appVersion: '1.8.9',
      // unused fields cast away
    } as unknown as DebugInfoPluginRef['app'],
    manifest: { id: 'obsidian-mcp', version: '2.2.0' },
    settings: { ...baseSettings, ...(opts.settings ?? {}) },
    httpServer: opts.httpServer ?? null,
    registry: { getModules: () => opts.modules ?? [] },
  };
}

describe('collectDebugInfo', () => {
  let bundle: string;

  describe('with running server, set access key, cached TLS, modules', () => {
    beforeEach(async () => {
      const vaultMod: ModuleRegistration = {
        module: makeModule('vault', undefined),
        enabled: true,
        toolStates: {},
      };
      const editorMod: ModuleRegistration = {
        module: makeModule('editor', undefined),
        enabled: false,
        toolStates: {},
      };
      const extrasMod: ModuleRegistration = {
        module: makeModule('extras', 'extras', ['get_date', 'other_tool']),
        enabled: true,
        toolStates: { get_date: true, other_tool: false },
      };
      bundle = await collectDebugInfo(
        makePlugin({
          httpServer: {
            isRunning: true,
            scheme: 'https',
            connectedClients: 2,
            activeSessions: 3,
            port: 28741,
          },
          modules: [vaultMod, editorMod, extrasMod],
          files: {
            '.obsidian/plugins/obsidian-mcp/debug.log':
              'line-1\nline-2\nline-3\n',
          },
        }),
      );
    });

    it('contains all five section headers', () => {
      expect(bundle).toContain('=== Environment ===');
      expect(bundle).toContain('=== Server ===');
      expect(bundle).toContain('=== Settings (redacted) ===');
      expect(bundle).toContain('=== Modules ===');
      expect(bundle).toContain('=== Recent log');
    });

    it('renders environment fields', () => {
      expect(bundle).toContain('Plugin: obsidian-mcp 2.2.0');
      expect(bundle).toContain('Obsidian: 1.8.9');
      expect(bundle).toContain('Platform:');
      expect(bundle).toContain('Node:');
    });

    it('renders server snapshot fields', () => {
      expect(bundle).toContain('Status: running');
      expect(bundle).toContain('Scheme: https');
      expect(bundle).toContain('Address: 127.0.0.1');
      expect(bundle).toContain('Port: 28741');
      expect(bundle).toContain('Connected clients: 2');
      expect(bundle).toContain('Active sessions: 3');
    });

    it('redacts the access key as <set>, never the literal value', () => {
      expect(bundle).toContain('accessKey: <set>');
      expect(bundle).not.toContain(SECRET);
    });

    it('redacts the TLS certificate as <present>, never the PEM', () => {
      expect(bundle).toContain('tlsCertificate: <present>');
      expect(bundle).not.toContain('BEGIN CERTIFICATE');
      expect(bundle).not.toContain(FAKE_PEM);
    });

    it('lists core modules with enabled state', () => {
      expect(bundle).toContain('- vault (enabled)');
      expect(bundle).toContain('- editor (disabled)');
    });

    it('lists extras module with per-tool state', () => {
      expect(bundle).toContain('- extras (extras)');
      expect(bundle).toContain('    - get_date (enabled)');
      expect(bundle).toContain('    - other_tool (disabled)');
    });

    it('includes the recent log tail', () => {
      expect(bundle).toContain('line-1');
      expect(bundle).toContain('line-3');
    });
  });

  describe('with empty access key and absent TLS', () => {
    it('shows <empty> for access key and <absent> for TLS', async () => {
      bundle = await collectDebugInfo(
        makePlugin({
          settings: { accessKey: '', tlsCertificate: null },
        }),
      );
      expect(bundle).toContain('accessKey: <empty>');
      expect(bundle).toContain('tlsCertificate: <absent>');
    });
  });

  describe('with no server running', () => {
    it('renders Status: stopped without other server fields', async () => {
      bundle = await collectDebugInfo(makePlugin({ httpServer: null }));
      expect(bundle).toContain('Status: stopped');
      expect(bundle).not.toContain('Connected clients:');
    });
  });

  describe('with no log file present', () => {
    it('shows "(log is empty)"', async () => {
      bundle = await collectDebugInfo(makePlugin());
      expect(bundle).toContain('(log is empty)');
    });
  });

  describe('with no modules registered', () => {
    it('shows "(none registered)"', async () => {
      bundle = await collectDebugInfo(makePlugin({ modules: [] }));
      expect(bundle).toContain('(none registered)');
    });
  });

  describe('recent log tail size', () => {
    it('limits the included tail to the most recent ~200 lines', async () => {
      const lines = Array.from({ length: 500 }, (_, i) => `entry-${String(i)}`);
      bundle = await collectDebugInfo(
        makePlugin({
          files: {
            '.obsidian/plugins/obsidian-mcp/debug.log': lines.join('\n') + '\n',
          },
        }),
      );
      expect(bundle).toContain('entry-499');
      expect(bundle).toContain('entry-300');
      expect(bundle).not.toContain('entry-100');
    });
  });
});
