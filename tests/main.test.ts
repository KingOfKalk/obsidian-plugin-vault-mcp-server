import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, PluginManifest } from 'obsidian';
import McpPlugin from '../src/main';
import { mockApp, type MockApp, type MockManifest } from './__mocks__/obsidian';

interface TestPlugin extends McpPlugin {
  loadData: () => Promise<Record<string, unknown> | null>;
  saveData: (data: unknown) => Promise<void>;
}

interface MutablePluginFields {
  app: MockApp;
  manifest: MockManifest;
}

function createPlugin(persisted: Record<string, unknown> | null): TestPlugin {
  const app = mockApp();
  const manifest: MockManifest = { id: 'vault-mcp-server', version: '0.0.0' };
  const plugin = new McpPlugin(
    app as unknown as App,
    manifest as unknown as PluginManifest,
  );
  const mutable = plugin as unknown as MutablePluginFields;
  mutable.app = app;
  mutable.manifest = manifest;
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

  it('starts the server when autoStart is true, authEnabled is true, and an access key is set', async () => {
    const plugin = createPlugin({
      schemaVersion: 10,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'configured-key',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: true,
      authEnabled: true,
      iAcceptInsecureMode: false,
      seenInsecureWarning: true,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).toHaveBeenCalled();
  });

  it('auto-starts the server when autoStart is true and authEnabled is on with an empty key (a key is auto-generated on first load)', async () => {
    const plugin = createPlugin({
      schemaVersion: 10,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: true,
      authEnabled: true,
      iAcceptInsecureMode: false,
      seenInsecureWarning: true,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    // After ensureAccessKey() auto-generates a 32-byte key, the
    // canBindServer() guard is satisfied and the server auto-starts.
    expect(plugin.settings.accessKey).not.toBe('');
    expect(startSpy).toHaveBeenCalled();
  });

  it('starts the server when autoStart is true, auth is off, and the user explicitly accepted insecure mode', async () => {
    const plugin = createPlugin({
      schemaVersion: 10,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: true,
      authEnabled: false,
      iAcceptInsecureMode: true,
      seenInsecureWarning: true,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).toHaveBeenCalled();
  });

  it('refuses to auto-start when authEnabled is off and iAcceptInsecureMode is not set', async () => {
    const plugin = createPlugin({
      schemaVersion: 10,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: true,
      authEnabled: false,
      iAcceptInsecureMode: false,
      seenInsecureWarning: true,
      moduleStates: {},
    });
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('auto-generates a 32-byte access key on first load when authEnabled is true and the key is empty', async () => {
    const plugin = createPlugin({
      schemaVersion: 10,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: false,
      authEnabled: true,
      iAcceptInsecureMode: false,
      seenInsecureWarning: true,
      moduleStates: {},
    });
    vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(plugin.settings.accessKey).not.toBe('');
    // base64url of 32 bytes is 43 chars (no padding).
    expect(plugin.settings.accessKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(plugin.saveData).toHaveBeenCalled();
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

  it('marks the status bar and ribbon as failed when startServer rejects with a port-in-use error', async () => {
    const plugin = createPlugin({
      schemaVersion: 6,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: false,
      authEnabled: false,
      moduleStates: {},
    });

    interface StatusBarStub {
      textContent: string;
      title: string;
      ariaLabel: string;
      children: { className: string; textContent: string }[];
    }
    interface RibbonStub {
      _icon: string;
      ariaLabel: string;
    }
    interface InternalPlugin {
      addStatusBarItem: () => StatusBarStub;
      addRibbonIcon: (icon: string, title: string, cb: () => void) => RibbonStub;
      lastStartError: { port: number; message: string } | null;
    }

    const ribbonEl: RibbonStub = { _icon: '', ariaLabel: '' };
    const internals = plugin as unknown as InternalPlugin;
    internals.addRibbonIcon = (icon: string): RibbonStub => {
      ribbonEl._icon = icon;
      return ribbonEl;
    };

    await plugin.onload();

    const { HttpMcpServer } = await import('../src/server/http-server');
    const startSpy = vi
      .spyOn(HttpMcpServer.prototype, 'start')
      .mockRejectedValue(
        new Error('Port 28741 is already in use. Choose a different port in settings.'),
      );

    try {
      await plugin.startServer();

      // Ribbon returns to stopped glyph.
      expect(ribbonEl._icon).toBe('plug');
      // Last-start error is recorded.
      expect(internals.lastStartError).not.toBeNull();
      expect(internals.lastStartError?.port).toBe(28741);

      // Status bar should show the struck-through port and a tooltip.
      const statusBar = (plugin as unknown as { statusBarItem: StatusBarStub })
        .statusBarItem;
      expect(statusBar.textContent).toBe('');
      expect(statusBar.children).toHaveLength(1);
      expect(statusBar.children[0].className).toBe('mcp-statusbar-error');
      expect(statusBar.children[0].textContent).toBe('MCP :28741');
      expect(statusBar.title).toBe('Port 28741 is already in use');
      expect(statusBar.ariaLabel).toBe('Port 28741 is already in use');
    } finally {
      startSpy.mockRestore();
    }
  });

  it('leaves plugin.httpServer null when startServer fails, and wires a fresh instance on the next successful start', async () => {
    const plugin = createPlugin({
      schemaVersion: 6,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: false,
      authEnabled: false,
      moduleStates: {},
    });

    interface InternalPlugin {
      httpServer: unknown;
    }

    await plugin.onload();

    const internals = plugin as unknown as InternalPlugin;
    expect(internals.httpServer).toBeNull();

    const { HttpMcpServer } = await import('../src/server/http-server');
    const failingStart = vi
      .spyOn(HttpMcpServer.prototype, 'start')
      .mockRejectedValueOnce(new Error('EADDRINUSE'));

    try {
      await plugin.startServer();
      // After a failed start, httpServer must remain null — no half-constructed
      // reference hanging around.
      expect(internals.httpServer).toBeNull();
    } finally {
      failingStart.mockRestore();
    }

    // A subsequent successful start must assign a fresh instance.
    const okStart = vi
      .spyOn(HttpMcpServer.prototype, 'start')
      .mockResolvedValue(undefined);
    const isRunningSpy = vi
      .spyOn(HttpMcpServer.prototype, 'isRunning', 'get')
      .mockReturnValue(true);
    try {
      await plugin.startServer();
      expect(internals.httpServer).not.toBeNull();
    } finally {
      okStart.mockRestore();
      isRunningSpy.mockRestore();
    }
  });

  it('clears the last-start error when the next startServer succeeds', async () => {
    const plugin = createPlugin({
      schemaVersion: 6,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: false,
      authEnabled: false,
      moduleStates: {},
    });

    interface InternalPlugin {
      lastStartError: { port: number; message: string } | null;
      statusBarItem: { title: string; ariaLabel: string; textContent: string; children: unknown[] };
    }

    await plugin.onload();

    const internals = plugin as unknown as InternalPlugin;
    internals.lastStartError = { port: 28741, message: 'stale' };

    const { HttpMcpServer } = await import('../src/server/http-server');
    const startSpy = vi
      .spyOn(HttpMcpServer.prototype, 'start')
      .mockResolvedValue(undefined);
    const isRunningSpy = vi
      .spyOn(HttpMcpServer.prototype, 'isRunning', 'get')
      .mockReturnValue(true);

    try {
      await plugin.startServer();
      expect(internals.lastStartError).toBeNull();
      expect(internals.statusBarItem.title).toBe('');
      expect(internals.statusBarItem.children).toHaveLength(0);
      expect(internals.statusBarItem.textContent).toBe('MCP :28741');
    } finally {
      startSpy.mockRestore();
      isRunningSpy.mockRestore();
    }
  });

  it('clears the last-start error when stopServer is called', async () => {
    const plugin = createPlugin({
      schemaVersion: 6,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: false,
      authEnabled: false,
      moduleStates: {},
    });

    interface InternalPlugin {
      httpServer: { stop: () => Promise<void>; isRunning: boolean } | null;
      lastStartError: { port: number; message: string } | null;
    }

    await plugin.onload();

    const internals = plugin as unknown as InternalPlugin;
    internals.lastStartError = { port: 28741, message: 'stale' };
    internals.httpServer = {
      stop: (): Promise<void> => Promise.resolve(),
      isRunning: false,
    };

    await plugin.stopServer();

    expect(internals.lastStartError).toBeNull();
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
