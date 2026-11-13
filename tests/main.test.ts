import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
  type MockInstance,
} from 'vitest';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App, PluginManifest } from 'obsidian';
import McpPlugin from '../src/main';
import { generateSelfSignedCert } from '../src/server/tls';
import type { TlsCertificateData } from '../src/types';
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
    expect(ribbonEl.ariaLabel).toBe('MCP server (stopped)');

    // Simulate the server becoming running, then refresh the status display.
    internals.httpServer = { isRunning: true };
    internals.updateStatusDisplay();

    expect(ribbonEl._icon).toBe('plug-zap');
    expect(ribbonEl.ariaLabel).toBe('MCP server (running on :28741)');

    // Simulate the server being stopped again.
    internals.httpServer = null;
    internals.updateStatusDisplay();

    expect(ribbonEl._icon).toBe('plug');
    expect(ribbonEl.ariaLabel).toBe('MCP server (stopped)');
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
      expect(statusBar.children[0].className).toBe('vault-mcp-statusbar-error');
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

describe('McpPlugin module defaults and plugin tools (#469)', () => {
  const OPEN_NOTE_MODULES = ['editor', 'workspace', 'ui'];

  it('a new install starts with editor, workspace and ui off', async () => {
    const plugin = createPlugin(null);
    await plugin.onload();
    for (const id of OPEN_NOTE_MODULES) {
      expect(plugin.registry.isModuleEnabled(id)).toBe(false);
    }
    for (const id of ['vault', 'search', 'templates', 'plugin-interop']) {
      expect(plugin.registry.isModuleEnabled(id)).toBe(true);
    }
    plugin.onunload();
  });

  it('an existing 4.x install keeps editor, workspace and ui on', async () => {
    const plugin = createPlugin({
      schemaVersion: 12,
      accessKey: 'k',
      authEnabled: true,
      seenInsecureWarning: true,
      moduleStates: {},
    });
    await plugin.onload();
    for (const id of OPEN_NOTE_MODULES) {
      expect(plugin.registry.isModuleEnabled(id)).toBe(true);
    }
    plugin.onunload();
  });

  it('an existing install keeps a module it had switched off', async () => {
    const plugin = createPlugin({
      schemaVersion: 12,
      accessKey: 'k',
      authEnabled: true,
      seenInsecureWarning: true,
      moduleStates: { editor: { enabled: false } },
    });
    await plugin.onload();
    expect(plugin.registry.isModuleEnabled('editor')).toBe(false);
    expect(plugin.registry.isModuleEnabled('workspace')).toBe(true);
    plugin.onunload();
  });

  it('polls tool availability while loaded and stops on unload', async () => {
    // The polling uses the window's timers in Obsidian (#557); Vitest does
    // not fake the `node:timers` fallback used without a window.
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    try {
      const plugin = createPlugin(null);
      await plugin.onload();
      const refresh = vi.spyOn(plugin.registry, 'refreshAvailability');
      vi.advanceTimersByTime(10_000);
      expect(refresh).toHaveBeenCalled();
      plugin.onunload();
      refresh.mockClear();
      vi.advanceTimersByTime(10_000);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('lists plugin_execute_command only once the allowlist has an entry', async () => {
    const plugin = createPlugin(null);
    await plugin.onload();
    const names = (): string[] => plugin.registry.getActiveTools().map((t) => t.name);
    expect(names()).not.toContain('plugin_execute_command');
    plugin.settings.executeCommandAllowlist = ['editor:save-file'];
    expect(plugin.registry.refreshAvailability()).toBe(true);
    expect(names()).toContain('plugin_execute_command');
    plugin.onunload();
  });
});

describe('McpPlugin refuses to run without auth outside loopback (#558)', () => {
  function insecureSettings(serverAddress: string, authEnabled = false): Record<string, unknown> {
    return {
      schemaVersion: 13,
      serverAddress,
      port: 28741,
      accessKey: authEnabled ? 'configured-key' : '',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: true,
      authEnabled,
      iAcceptInsecureMode: !authEnabled,
      seenInsecureWarning: true,
      moduleStates: {},
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not auto-start without auth on 0.0.0.0, even with insecure mode accepted', async () => {
    const plugin = createPlugin(insecureSettings('0.0.0.0'));
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).not.toHaveBeenCalled();
    plugin.onunload();
  });

  it('still auto-starts without auth on 127.0.0.1 with insecure mode accepted', async () => {
    const plugin = createPlugin(insecureSettings('127.0.0.1'));
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).toHaveBeenCalled();
    plugin.onunload();
  });

  it('still auto-starts with auth on a non-loopback address', async () => {
    const plugin = createPlugin(insecureSettings('0.0.0.0', true));
    const startSpy = vi.spyOn(plugin, 'startServer').mockResolvedValue();

    await plugin.onload();

    expect(startSpy).toHaveBeenCalled();
    plugin.onunload();
  });

  it('startServer refuses to bind without auth on a non-loopback address and says why', async () => {
    const obsidian = await import('obsidian');
    const plugin = createPlugin({ ...insecureSettings('192.168.1.10'), autoStart: false });
    await plugin.onload();

    const { HttpMcpServer } = await import('../src/server/http-server');
    const bindSpy = vi.spyOn(HttpMcpServer.prototype, 'start').mockResolvedValue(undefined);
    const noticeSpy = vi.spyOn(obsidian, 'Notice');

    await plugin.startServer();

    expect(bindSpy).not.toHaveBeenCalled();
    expect(plugin.httpServer).toBeNull();
    expect(noticeSpy).toHaveBeenCalledTimes(1);
    const [message] = noticeSpy.mock.calls[0] as [string];
    expect(message).toContain('Vault MCP Server');
    expect(message).toContain('127.0.0.1');
    plugin.onunload();
  });
});

describe('McpPlugin renews the self-signed certificate before it expires (#564)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let workDir: string;
  let freshCert: TlsCertificateData;
  let expiringCert: TlsCertificateData;
  let expiredCert: TlsCertificateData;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'cert-renewal-'));
    freshCert = await generateSelfSignedCert({ validityDays: 365 });
    expiringCert = await generateSelfSignedCert({ validityDays: 10 });
    expiredCert = await generateSelfSignedCert({ validityDays: 0 });
    // Make sure "now" is strictly past the 0-day certificate's notAfter.
    await new Promise((r) => setTimeout(r, 20));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function httpsSettings(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      schemaVersion: 13,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'configured-key',
      httpsEnabled: true,
      tlsCertificate: null,
      useCustomTls: false,
      customTlsCertPath: null,
      customTlsKeyPath: null,
      debugMode: false,
      autoStart: false,
      authEnabled: true,
      iAcceptInsecureMode: false,
      seenInsecureWarning: true,
      moduleStates: {},
      ...overrides,
    };
  }

  async function startWith(
    overrides: Record<string, unknown>,
  ): Promise<{ plugin: TestPlugin; notices: string[]; bindSpy: MockInstance }> {
    const obsidian = await import('obsidian');
    const { HttpMcpServer } = await import('../src/server/http-server');
    const plugin = createPlugin(httpsSettings(overrides));
    await plugin.onload();
    const bindSpy = vi.spyOn(HttpMcpServer.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(HttpMcpServer.prototype, 'isRunning', 'get').mockReturnValue(true);
    const noticeSpy = vi.spyOn(obsidian, 'Notice');
    vi.mocked(plugin.saveData).mockClear();
    await plugin.startServer();
    const notices = noticeSpy.mock.calls.map((call) => (call as [string])[0]);
    return { plugin, notices, bindSpy };
  }

  function lastSavedCertificate(plugin: TestPlugin): unknown {
    const calls = vi.mocked(plugin.saveData).mock.calls;
    if (calls.length === 0) return undefined;
    const saved = calls[calls.length - 1][0] as { tlsCertificate?: unknown };
    return saved.tlsCertificate;
  }

  function daysLeft(cert: string): number {
    return (new Date(new X509Certificate(cert).validTo).getTime() - Date.now()) / DAY_MS;
  }

  it('keeps a cached certificate that is still valid for more than 30 days', async () => {
    const { plugin, notices, bindSpy } = await startWith({ tlsCertificate: freshCert });

    expect(plugin.settings.tlsCertificate).toEqual(freshCert);
    expect(plugin.saveData).not.toHaveBeenCalled();
    expect(notices.some((n) => n.includes('renewed'))).toBe(false);
    expect(bindSpy).toHaveBeenCalled();
    plugin.onunload();
  });

  it.each([
    ['expires within 30 days', (): TlsCertificateData => expiringCert],
    ['has expired', (): TlsCertificateData => expiredCert],
    ['does not parse', (): TlsCertificateData => ({ cert: 'NOT A PEM', key: 'NOT A KEY' })],
  ])('regenerates, persists and announces a cached certificate that %s', async (_label, cached) => {
    const old = cached();
    const { plugin, notices, bindSpy } = await startWith({ tlsCertificate: old });

    const renewed = plugin.settings.tlsCertificate;
    expect(renewed).not.toBeNull();
    expect(renewed?.cert).not.toBe(old.cert);
    expect(renewed?.key).not.toBe(old.key);
    expect(daysLeft(renewed?.cert ?? '')).toBeGreaterThan(364);
    expect(lastSavedCertificate(plugin)).toEqual(renewed);
    expect(notices.some((n) => n.includes('renewed') && n.includes('trust'))).toBe(true);
    expect(bindSpy).toHaveBeenCalled();
    plugin.onunload();
  });

  it('does not show the renewal notice when it generates the first certificate', async () => {
    const { plugin, notices } = await startWith({ tlsCertificate: null });

    expect(plugin.settings.tlsCertificate).not.toBeNull();
    expect(notices.some((n) => n.includes('renewed'))).toBe(false);
    plugin.onunload();
  });

  async function writeCustomPair(
    prefix: string,
    pair: TlsCertificateData,
  ): Promise<{ customTlsCertPath: string; customTlsKeyPath: string }> {
    const customTlsCertPath = join(workDir, `${prefix}.crt`);
    const customTlsKeyPath = join(workDir, `${prefix}.key`);
    await writeFile(customTlsCertPath, pair.cert, 'utf8');
    await writeFile(customTlsKeyPath, pair.key, 'utf8');
    return { customTlsCertPath, customTlsKeyPath };
  }

  it('never replaces your own certificate that expires within 30 days, but warns', async () => {
    const paths = await writeCustomPair('custom-expiring', expiringCert);
    const { plugin, notices, bindSpy } = await startWith({
      useCustomTls: true,
      ...paths,
      // An expiring cached self-signed certificate must stay untouched too:
      // with your own certificate, the self-signed one is not used.
      tlsCertificate: expiringCert,
    });

    expect(await readFile(paths.customTlsCertPath, 'utf8')).toBe(expiringCert.cert);
    expect(await readFile(paths.customTlsKeyPath, 'utf8')).toBe(expiringCert.key);
    expect(plugin.settings.customTlsCertPath).toBe(paths.customTlsCertPath);
    expect(plugin.settings.customTlsKeyPath).toBe(paths.customTlsKeyPath);
    expect(plugin.settings.tlsCertificate).toEqual(expiringCert);
    expect(plugin.saveData).not.toHaveBeenCalled();
    expect(notices.some((n) => n.includes('renewed'))).toBe(false);
    expect(notices.some((n) => n.includes('expires'))).toBe(true);
    expect(bindSpy).toHaveBeenCalled();
    plugin.onunload();
  });

  it('never replaces your own expired certificate; the server refuses to start', async () => {
    const paths = await writeCustomPair('custom-expired', expiredCert);
    const { plugin, notices, bindSpy } = await startWith({
      useCustomTls: true,
      ...paths,
      tlsCertificate: null,
    });

    expect(await readFile(paths.customTlsCertPath, 'utf8')).toBe(expiredCert.cert);
    expect(plugin.settings.tlsCertificate).toBeNull();
    expect(plugin.saveData).not.toHaveBeenCalled();
    expect(notices.some((n) => n.includes('expiry'))).toBe(true);
    expect(bindSpy).not.toHaveBeenCalled();
    plugin.onunload();
  });

  it('does not warn about your own certificate while it is valid for more than 30 days', async () => {
    const paths = await writeCustomPair('custom-fresh', freshCert);
    const { plugin, notices, bindSpy } = await startWith({ useCustomTls: true, ...paths });

    expect(notices.some((n) => n.includes('expires'))).toBe(false);
    expect(bindSpy).toHaveBeenCalled();
    plugin.onunload();
  });
});
