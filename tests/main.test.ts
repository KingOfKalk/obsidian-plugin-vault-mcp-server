import { describe, it, expect, vi, beforeEach } from 'vitest';
import McpPlugin from '../src/main';

interface TestPlugin extends McpPlugin {
  loadData: () => Promise<Record<string, unknown> | null>;
  saveData: (data: unknown) => Promise<void>;
}

function createPlugin(persisted: Record<string, unknown> | null): TestPlugin {
  const app = {
    vault: {
      configDir: '.obsidian',
      adapter: {
        basePath: '/tmp/vault',
        exists: (): Promise<boolean> => Promise.resolve(false),
        read: (): Promise<string> => Promise.resolve(''),
        write: (): Promise<void> => Promise.resolve(),
        append: (): Promise<void> => Promise.resolve(),
        stat: (): Promise<null> => Promise.resolve(null),
      },
    },
    workspace: {},
    metadataCache: {},
  };
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
  const plugin = new McpPlugin(app as any, { id: 'obsidian-mcp', version: '0.0.0' } as any) as unknown as TestPlugin;
  (plugin as any).app = app;
  (plugin as any).manifest = { id: 'obsidian-mcp', version: '0.0.0' };
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

  it('does not start the server when autoStart is true, auth is required, but no access key is set', async () => {
    const plugin = createPlugin({
      schemaVersion: 6,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: true,
      authEnabled: true,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('starts the server when autoStart is true and Bearer auth is disabled, even without an access key', async () => {
    const plugin = createPlugin({
      schemaVersion: 6,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: true,
      authEnabled: false,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).toHaveBeenCalled();
  });

  it('swaps the ribbon icon glyph when the server transitions between stopped and running', async () => {
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

    interface RibbonStub {
      _icon: string;
      ariaLabel: string;
    }
    interface InternalPlugin {
      addRibbonIcon: (icon: string, title: string, cb: () => void) => RibbonStub;
      httpServer: { isRunning: boolean } | null;
      updateStatusDisplay: () => void;
    }

    const ribbonEl: RibbonStub = { _icon: '', ariaLabel: '' };
    const internals = plugin as unknown as InternalPlugin;
    internals.addRibbonIcon = (icon: string): RibbonStub => {
      ribbonEl._icon = icon;
      return ribbonEl;
    };

    await plugin.onload();

    // Initial render: server stopped, so the ribbon should show the default plug glyph.
    expect(ribbonEl._icon).toBe('plug');
    expect(ribbonEl.ariaLabel).toBe('MCP Server (stopped)');

    // Simulate the server becoming running, then refresh the status display.
    internals.httpServer = { isRunning: true };
    internals.updateStatusDisplay();

    expect(ribbonEl._icon).toBe('plug-zap');
    expect(ribbonEl.ariaLabel).toBe('MCP Server (running on :28741)');

    // Simulate the server being stopped again.
    internals.httpServer = null;
    internals.updateStatusDisplay();

    expect(ribbonEl._icon).toBe('plug');
    expect(ribbonEl.ariaLabel).toBe('MCP Server (stopped)');
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
