import { describe, it, expect, vi, beforeEach } from 'vitest';
import McpPlugin from '../src/main';

interface TestPlugin extends McpPlugin {
  loadData: () => Promise<Record<string, unknown> | null>;
  saveData: (data: unknown) => Promise<void>;
}

function createPlugin(persisted: Record<string, unknown> | null): TestPlugin {
  const app = {
    vault: { adapter: { basePath: '/tmp/vault' } },
    workspace: {},
    metadataCache: {},
  };
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
  const plugin = new McpPlugin(app as any, {} as any) as unknown as TestPlugin;
  (plugin as any).app = app;
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
  plugin.loadData = vi.fn().mockResolvedValue(persisted);
  plugin.saveData = vi.fn().mockResolvedValue(undefined);
  return plugin;
}

describe('McpPlugin.onload autoStart behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not start the server when autoStart is false, even with an access key', async () => {
    const plugin = createPlugin({
      schemaVersion: 3,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'configured-key',
      httpsEnabled: false,
      debugMode: false,
      autoStart: false,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('starts the server when autoStart is true and an access key is set', async () => {
    const plugin = createPlugin({
      schemaVersion: 3,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'configured-key',
      httpsEnabled: false,
      debugMode: false,
      autoStart: true,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).toHaveBeenCalled();
  });

  it('does not start the server when autoStart is true but no access key is set', async () => {
    const plugin = createPlugin({
      schemaVersion: 3,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      debugMode: false,
      autoStart: true,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('migrates existing installs to autoStart=false so the server stays stopped on first load', async () => {
    const plugin = createPlugin({
      schemaVersion: 2,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'legacy-key',
      httpsEnabled: false,
      debugMode: false,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(plugin.settings.autoStart).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
  });
});
