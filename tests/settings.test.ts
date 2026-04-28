import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Setting } from 'obsidian';
import { migrateSettings, generateAccessKey, isValidIPv4, McpSettingsTab } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/types';

describe('migrateSettings', () => {
  it('should migrate v0 (no schemaVersion) to current schema', () => {
    const data: Record<string, unknown> = {};
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.port).toBe(28741);
    expect(result.accessKey).toBe('');
    expect(result.httpsEnabled).toBe(false);
    expect(result.debugMode).toBe(false);
    expect(result.moduleStates).toEqual({});
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
    expect(result.authEnabled).toBe(false);
  });

  it('should preserve existing values during migration', () => {
    const data: Record<string, unknown> = {
      port: 9999,
      accessKey: 'my-key',
      debugMode: true,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.port).toBe(9999);
    expect(result.accessKey).toBe('my-key');
    expect(result.debugMode).toBe(true);
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v1 data by adding serverAddress and autoStart', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 1,
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v2 data by adding autoStart=false', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 2,
      serverAddress: '192.168.1.100',
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v3 data by stripping per-module readOnly flags', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 3,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      autoStart: false,
      moduleStates: {
        vault: { enabled: true, readOnly: true },
        editor: { enabled: false, readOnly: false },
      },
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.moduleStates).toEqual({
      vault: { enabled: true },
      editor: { enabled: false },
    });
  });

  it('should migrate v4 data to v5 by adding tlsCertificate=null', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 4,
      serverAddress: '192.168.1.100',
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      autoStart: true,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.tlsCertificate).toBeNull();
  });

  it('should migrate v5 data to v6 by adding authEnabled=false', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 5,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      tlsCertificate: null,
      debugMode: false,
      autoStart: false,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.authEnabled).toBe(false);
  });

  it('v5->v6 migration sets authEnabled=false even when an access key is configured', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 5,
      accessKey: 'pre-existing-key',
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.authEnabled).toBe(false);
    expect(result.accessKey).toBe('pre-existing-key');
  });

  it('v5->v6 preserves an explicitly set authEnabled=true value', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 5,
      authEnabled: true,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.authEnabled).toBe(true);
  });

  it('should not modify data already at v7', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 7,
      serverAddress: '192.168.1.100',
      port: 28741,
      accessKey: 'test',
      httpsEnabled: true,
      tlsCertificate: { cert: 'C', key: 'K' },
      useCustomTls: false,
      customTlsCertPath: null,
      customTlsKeyPath: null,
      debugMode: false,
      autoStart: true,
      authEnabled: true,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result).toEqual(data);
  });

  it('should migrate v6 data to v7 by adding the custom TLS fields', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 6,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: '',
      httpsEnabled: true,
      tlsCertificate: { cert: 'C', key: 'K' },
      debugMode: false,
      autoStart: false,
      authEnabled: false,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.useCustomTls).toBe(false);
    expect(result.customTlsCertPath).toBeNull();
    expect(result.customTlsKeyPath).toBeNull();
    // Pre-existing tlsCertificate is untouched so users can flip the toggle back off.
    expect(result.tlsCertificate).toEqual({ cert: 'C', key: 'K' });
  });

  it('v6->v7 preserves explicitly set custom TLS values', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 6,
      useCustomTls: true,
      customTlsCertPath: '/etc/ssl/my.crt',
      customTlsKeyPath: '/etc/ssl/my.key',
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.useCustomTls).toBe(true);
    expect(result.customTlsCertPath).toBe('/etc/ssl/my.crt');
    expect(result.customTlsKeyPath).toBe('/etc/ssl/my.key');
  });

  it('preserves an existing tlsCertificate across migration', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 4,
      tlsCertificate: { cert: 'EXISTING_CERT', key: 'EXISTING_KEY' },
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.tlsCertificate).toEqual({
      cert: 'EXISTING_CERT',
      key: 'EXISTING_KEY',
    });
  });

  it('should handle partially populated v0 data', () => {
    const data: Record<string, unknown> = {
      port: 3000,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    expect(result.port).toBe(3000);
    expect(result.accessKey).toBe('');
    expect(result.moduleStates).toEqual({});
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
    expect(result.authEnabled).toBe(false);
  });

  it('should migrate v3 extras state to per-tool states (enabled -> get_date on)', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 3,
      serverAddress: '127.0.0.1',
      port: 28741,
      accessKey: 'k',
      httpsEnabled: false,
      debugMode: false,
      autoStart: false,
      moduleStates: { extras: { enabled: true, readOnly: false } },
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(8);
    const states = result.moduleStates as Record<
      string,
      { enabled: boolean; readOnly: boolean; toolStates?: Record<string, boolean> }
    >;
    expect(states.extras.toolStates).toEqual({ get_date: true });
  });

  it('should migrate v3 extras state to per-tool states (disabled -> empty)', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 3,
      moduleStates: { extras: { enabled: false, readOnly: false } },
    };
    const result = migrateSettings(data);
    const states = result.moduleStates as Record<
      string,
      { enabled: boolean; readOnly: boolean; toolStates?: Record<string, boolean> }
    >;
    expect(states.extras.toolStates).toEqual({});
  });

  it('should leave existing v4 toolStates untouched', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 4,
      moduleStates: {
        extras: {
          enabled: true,
          readOnly: false,
          toolStates: { get_date: true, something_else: false },
        },
      },
    };
    const result = migrateSettings(data);
    const states = result.moduleStates as Record<
      string,
      { enabled: boolean; readOnly: boolean; toolStates?: Record<string, boolean> }
    >;
    expect(states.extras.toolStates).toEqual({
      get_date: true,
      something_else: false,
    });
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('should default autoStart to false', () => {
    expect(DEFAULT_SETTINGS.autoStart).toBe(false);
  });

  it('should default authEnabled to false', () => {
    expect(DEFAULT_SETTINGS.authEnabled).toBe(false);
  });

  it('declares schemaVersion 8', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(8);
  });

  it('defaults custom TLS fields to off/null', () => {
    expect(DEFAULT_SETTINGS.useCustomTls).toBe(false);
    expect(DEFAULT_SETTINGS.customTlsCertPath).toBeNull();
    expect(DEFAULT_SETTINGS.customTlsKeyPath).toBeNull();
  });
});

describe('generateAccessKey', () => {
  it('should generate a 64-character hex string', () => {
    const key = generateAccessKey();
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('should generate unique keys', () => {
    const key1 = generateAccessKey();
    const key2 = generateAccessKey();
    expect(key1).not.toBe(key2);
  });
});

describe('isValidIPv4', () => {
  it('should accept valid IPv4 addresses', () => {
    expect(isValidIPv4('127.0.0.1')).toBe(true);
    expect(isValidIPv4('0.0.0.0')).toBe(true);
    expect(isValidIPv4('192.168.1.100')).toBe(true);
    expect(isValidIPv4('255.255.255.255')).toBe(true);
    expect(isValidIPv4('10.0.0.1')).toBe(true);
  });

  it('should reject invalid IPv4 addresses', () => {
    expect(isValidIPv4('')).toBe(false);
    expect(isValidIPv4('localhost')).toBe(false);
    expect(isValidIPv4('256.0.0.1')).toBe(false);
    expect(isValidIPv4('1.2.3')).toBe(false);
    expect(isValidIPv4('1.2.3.4.5')).toBe(false);
    expect(isValidIPv4('abc.def.ghi.jkl')).toBe(false);
    expect(isValidIPv4('1.2.3.-1')).toBe(false);
    expect(isValidIPv4('::1')).toBe(false);
  });
});

interface TrackingEl {
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  rows: number;
  spellcheck: boolean;
  style: Record<string, string>;
  attributes: Record<string, string>;
  _icon?: string;
  classList: { add: () => void; remove: () => void };
  handlers: Record<string, Array<() => void>>;
  children: TrackingEl[];
  empty: () => void;
  setText: () => void;
  addEventListener: (event: string, handler: () => void) => void;
  createEl: (
    tag?: string,
    opts?: { text?: string; cls?: string; attr?: Record<string, string> },
  ) => TrackingEl;
  createDiv: (opts?: { cls?: string }) => TrackingEl;
}

function createTrackingEl(): TrackingEl {
  const el: TrackingEl = {
    tagName: '',
    className: '',
    textContent: '',
    value: '',
    rows: 0,
    spellcheck: true,
    style: {},
    attributes: {},
    classList: { add: (): void => {}, remove: (): void => {} },
    handlers: {},
    children: [],
    empty: (): void => {
      el.children.length = 0;
    },
    setText: (): void => {},
    addEventListener: (event: string, handler: () => void): void => {
      if (!el.handlers[event]) el.handlers[event] = [];
      el.handlers[event].push(handler);
    },
    createEl: (
      tag?: string,
      opts?: { text?: string; cls?: string; attr?: Record<string, string> },
    ): TrackingEl => {
      const child = createTrackingEl();
      if (tag) child.tagName = tag;
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
      if (opts?.attr) Object.assign(child.attributes, opts.attr);
      el.children.push(child);
      return child;
    },
    createDiv: (opts?: { cls?: string }): TrackingEl => {
      const child = createTrackingEl();
      child.tagName = 'div';
      if (opts?.cls) child.className = opts.cls;
      el.children.push(child);
      return child;
    },
  };
  return el;
}

function findByClass(root: TrackingEl, cls: string): TrackingEl | undefined {
  for (const child of root.children) {
    if (child.className === cls) return child;
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return undefined;
}

describe('McpSettingsTab MCP config display', () => {
  type ExtraButtonInfo = { icon: string; tooltip: string; callback: (() => void) | null };
  type SettingInstance = {
    settingName: string;
    settingDesc: string;
    extraButtons: ExtraButtonInfo[];
  };

  beforeEach(() => {
    (Setting as unknown as { instances: unknown[] }).instances = [];
  });

  function createConfigMockPlugin(overrides?: Partial<{ port: number; accessKey: string; authEnabled: boolean }>): {
    settings: { serverAddress: string; port: number; accessKey: string; authEnabled: boolean; httpsEnabled: boolean; debugMode: boolean; moduleStates: Record<string, unknown>; schemaVersion: number };
    httpServer: null;
    registry: { getModules: () => [] };
    logger: { updateOptions: () => void };
    saveSettings: ReturnType<typeof vi.fn>;
    app: { vault: { configDir: string } };
    manifest: { id: string; version: string };
  } {
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        accessKey: 'test-key-abc',
        authEnabled: true,
        ...overrides,
      },
      httpServer: null,
      registry: { getModules: () => [] },
      logger: { updateOptions: (): void => {} },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      app: { vault: { configDir: '.obsidian' } },
      manifest: { id: 'obsidian-mcp', version: '0.0.0' },
    };
  }

  function renderTab(
    overrides?: Partial<{ port: number; accessKey: string; authEnabled: boolean }>,
  ): { container: TrackingEl } {
    const plugin = createConfigMockPlugin(overrides);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const tab = new McpSettingsTab({} as any, plugin as any);
    const container = createTrackingEl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (tab as any).containerEl = container;
    tab.display();
    return { container };
  }

  function getClientConfigSetting(): SettingInstance {
    return (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === 'Client configuration',
    )!;
  }

  it('renders a Client configuration Setting row with an explanatory description', () => {
    renderTab();
    const setting = getClientConfigSetting();
    expect(setting).toBeDefined();
    expect(setting.settingDesc).toMatch(/mcpServers/);
  });

  it('renders exactly one copy extra button (no regenerate button)', () => {
    renderTab();
    const extras = getClientConfigSetting().extraButtons;
    expect(extras).toHaveLength(1);
    expect(extras[0].icon).toBe('copy');
    expect(extras[0].tooltip).toBe('Copy configuration');
  });

  it('does not render the old inline <pre>/<code> JSON preview', () => {
    const { container } = renderTab();
    expect(findByClass(container, 'mcp-config-preview')).toBeUndefined();
    expect(findByClass(container, 'mcp-config-code')).toBeUndefined();
    expect(findByClass(container, 'mcp-config-actions')).toBeUndefined();
  });

  it('clicking the copy button writes the generated JSON to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    renderTab();
    getClientConfigSetting().extraButtons[0].callback!();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('"url"');
    expect(copied).toContain('28741');
    expect(copied).toContain('Bearer test-key-abc');
  });

  it('copied JSON omits the Authorization header when the access key is empty', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    renderTab({ accessKey: '' });
    getClientConfigSetting().extraButtons[0].callback!();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('"url"');
    expect(copied).not.toContain('Authorization');
    expect(copied).not.toContain('headers');
  });

  it('copied JSON omits the Authorization header when Bearer auth is disabled', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    renderTab({ authEnabled: false });
    getClientConfigSetting().extraButtons[0].callback!();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('"url"');
    expect(copied).not.toContain('Authorization');
    expect(copied).not.toContain('headers');
  });
});

describe('McpSettingsTab server controls', () => {
  let mockPlugin: Record<string, unknown>;

  function createMockPlugin(isRunning: boolean, clients = 0): Record<string, unknown> {
    return {
      settings: { ...DEFAULT_SETTINGS, accessKey: 'test-key', authEnabled: true },
      httpServer: isRunning
        ? { isRunning: true, connectedClients: clients }
        : null,
      registry: { getModules: (): unknown[] => [] },
      startServer: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue(undefined),
      restartServer: vi.fn().mockResolvedValue(undefined),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      logger: { updateOptions: (): void => {} },
      app: { vault: { configDir: '.obsidian' } },
      manifest: { id: 'obsidian-mcp', version: '0.0.0' },
    };
  }

  type ButtonInfo = { text: string; disabled: boolean; callback: (() => void) | null };
  type ExtraButtonInfo = { icon: string; tooltip: string; callback: (() => void) | null };
  type ToggleInfo = { value: boolean; tooltip: string; callback: ((value: boolean) => void) | null };
  type SettingInstance = {
    settingName: string;
    buttons: ButtonInfo[];
    extraButtons: ExtraButtonInfo[];
    toggles: ToggleInfo[];
  };

  function getSettingButtons(name: string): ButtonInfo[] {
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === name,
    );
    return setting?.buttons ?? [];
  }

  function getSettingExtraButtons(name: string): ExtraButtonInfo[] {
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === name,
    );
    return setting?.extraButtons ?? [];
  }

  function getStatusToggle(): ToggleInfo {
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === 'Status',
    )!;
    return setting.toggles[0];
  }

  function getStatusButtons(): ButtonInfo[] {
    return getSettingButtons('Status');
  }

  function getStatusExtraButtons(): ExtraButtonInfo[] {
    return getSettingExtraButtons('Status');
  }

  beforeEach(() => {
    (Setting as unknown as { instances: unknown[] }).instances = [];
  });

  function renderTab(isRunning: boolean, clients = 0): void {
    mockPlugin = createMockPlugin(isRunning, clients);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const tab = new McpSettingsTab({} as any, mockPlugin as any);
    tab.display();
  }

  it('should render a single toggle on the Status row', () => {
    renderTab(false);
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === 'Status',
    )!;
    expect(setting.toggles).toHaveLength(1);
  });

  it('toggle reflects stopped state when server is stopped', () => {
    renderTab(false);
    expect(getStatusToggle().value).toBe(false);
  });

  it('toggle reflects running state when server is running', () => {
    renderTab(true);
    expect(getStatusToggle().value).toBe(true);
  });

  it('should not render Restart button when server is stopped', () => {
    renderTab(false);
    expect(getStatusButtons()).toHaveLength(0);
    expect(getStatusExtraButtons()).toHaveLength(0);
  });

  it('should render a copy icon extra button on the Server URL setting', () => {
    renderTab(false);
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === 'Server URL',
    ) as unknown as { extraButtons: Array<{ icon: string; tooltip: string; callback: (() => void) | null }> };
    expect(setting).toBeDefined();
    expect(setting.extraButtons).toHaveLength(1);
    expect(setting.extraButtons[0].icon).toBe('copy');
    expect(setting.extraButtons[0].tooltip).toBe('Copy server URL');
  });

  it('Server URL copy button copies the URL to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    renderTab(false);
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === 'Server URL',
    ) as unknown as { extraButtons: Array<{ icon: string; tooltip: string; callback: (() => void) | null }> };
    setting.extraButtons[0].callback!();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:28741/mcp');
    });
  });

  it('should render copy and generate extra buttons on the Access Key setting', () => {
    renderTab(false);
    const extras = getSettingExtraButtons('Access Key');
    expect(extras).toHaveLength(2);
    expect(extras[0].icon).toBe('copy');
    expect(extras[0].tooltip).toBe('Copy access key');
    expect(extras[1].icon).toBe('refresh-cw');
    expect(extras[1].tooltip).toBe('Generate');
  });

  it('should not render any text buttons on the Access Key setting', () => {
    renderTab(false);
    expect(getSettingButtons('Access Key')).toHaveLength(0);
  });

  it('Generate extra button replaces the access key with a new random value', async () => {
    renderTab(false);
    const getKey = (): string => (mockPlugin.settings as { accessKey: string }).accessKey;
    const originalKey = getKey();
    const generate = getSettingExtraButtons('Access Key').find((b) => b.icon === 'refresh-cw')!;
    generate.callback!();
    await vi.waitFor(() => {
      expect(getKey()).not.toBe(originalKey);
      expect(getKey()).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('Access Key copy button copies accessKey to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    renderTab(false);
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === 'Access Key',
    ) as unknown as { extraButtons: Array<{ icon: string; tooltip: string; callback: (() => void) | null }> };
    setting.extraButtons[0].callback!();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('test-key');
    });
  });

  it('should render a refresh icon extra button to restart the server when running', () => {
    renderTab(true);
    expect(getStatusButtons()).toHaveLength(0);
    const extra = getStatusExtraButtons();
    expect(extra).toHaveLength(1);
    expect(extra[0].icon).toBe('refresh-cw');
    expect(extra[0].tooltip).toBe('Restart server');
  });

  it('turning the toggle on calls startServer()', async () => {
    renderTab(false);
    getStatusToggle().callback!(true);
    await vi.waitFor(() => {
      expect(mockPlugin.startServer).toHaveBeenCalled();
    });
  });

  it('turning the toggle off calls stopServer()', async () => {
    renderTab(true);
    getStatusToggle().callback!(false);
    await vi.waitFor(() => {
      expect(mockPlugin.stopServer).toHaveBeenCalled();
    });
  });

  it('Restart extra button calls restartServer()', async () => {
    renderTab(true);
    const restart = getStatusExtraButtons().find((b) => b.icon === 'refresh-cw')!;
    restart.callback!();
    await vi.waitFor(() => {
      expect(mockPlugin.restartServer).toHaveBeenCalled();
    });
  });

  describe('Port-in-use inline error', () => {
    interface ChildEl {
      className: string;
      textContent: string;
    }
    interface PortSetting {
      descEl: { children: ChildEl[] };
      texts: { callback: ((value: string) => void | Promise<void>) | null }[];
    }

    function getPortSetting(): PortSetting {
      return (Setting as unknown as { instances: PortSetting[] & { settingName?: string }[] }).instances.find(
        (s) => (s as unknown as { settingName: string }).settingName === 'Port',
      ) as unknown as PortSetting;
    }

    function portErrors(): ChildEl[] {
      return getPortSetting().descEl.children.filter(
        (c) => c.className === 'mcp-settings-error',
      );
    }

    function renderWithLastError(
      lastStartError: { port: number; message: string } | null,
      portValue = 28741,
    ): Record<string, unknown> {
      const plugin = createMockPlugin(false);
      plugin.settings = { ...DEFAULT_SETTINGS, accessKey: 'test-key', authEnabled: true, port: portValue };
      plugin.lastStartError = lastStartError;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      const tab = new McpSettingsTab({} as any, plugin as any);
      tab.display();
      return plugin;
    }

    it('shows the inline error under the Port field when lastStartError matches the current port', () => {
      renderWithLastError({ port: 28741, message: 'Port 28741 is already in use.' }, 28741);
      const errors = portErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].textContent).toBe(
        'Port 28741 is already in use. Choose a different port.',
      );
    });

    it('does not show the inline error when lastStartError.port differs from the current port', () => {
      renderWithLastError({ port: 9999, message: 'stale error' }, 28741);
      expect(portErrors()).toHaveLength(0);
    });

    it('does not show the inline error when lastStartError is null', () => {
      renderWithLastError(null, 28741);
      expect(portErrors()).toHaveLength(0);
    });

    it('clears the inline error when the user types a new valid port', async () => {
      renderWithLastError({ port: 28741, message: 'fail' }, 28741);
      expect(portErrors()).toHaveLength(1);
      const port = getPortSetting();
      await port.texts[0].callback!('28742');
      expect(portErrors()).toHaveLength(0);
    });
  });

  describe('Require Bearer authentication toggle', () => {
    function getAuthEnabledSetting(): SettingInstance | undefined {
      return (Setting as unknown as { instances: SettingInstance[] }).instances.find(
        (s) => s.settingName === 'Require Bearer authentication',
      );
    }

    function createAuthMockPlugin(authEnabled: boolean): Record<string, unknown> {
      return {
        settings: { ...DEFAULT_SETTINGS, accessKey: 'test-key', authEnabled },
        httpServer: null,
        registry: { getModules: () => [] },
        startServer: vi.fn().mockResolvedValue(undefined),
        stopServer: vi.fn().mockResolvedValue(undefined),
        restartServer: vi.fn().mockResolvedValue(undefined),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        logger: { updateOptions: (): void => {} },
        app: { vault: { configDir: '.obsidian' } },
        manifest: { id: 'obsidian-mcp', version: '0.0.0' },
      };
    }

    function renderAuthTab(authEnabled: boolean): Record<string, unknown> {
      const plugin = createAuthMockPlugin(authEnabled);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      const tab = new McpSettingsTab({} as any, plugin as any);
      tab.display();
      return plugin;
    }

    it('renders the toggle with the stored value', () => {
      renderAuthTab(true);
      const setting = getAuthEnabledSetting();
      expect(setting).toBeDefined();
      expect(setting!.toggles).toHaveLength(1);
      expect(setting!.toggles[0].value).toBe(true);
    });

    it('reflects authEnabled=false in the toggle value', () => {
      renderAuthTab(false);
      expect(getAuthEnabledSetting()!.toggles[0].value).toBe(false);
    });

    it('hides the Access Key row when auth is disabled', () => {
      renderAuthTab(false);
      const accessKey = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
        (s) => s.settingName === 'Access Key',
      );
      expect(accessKey).toBeUndefined();
    });

    it('shows the Access Key row when auth is enabled', () => {
      renderAuthTab(true);
      const accessKey = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
        (s) => s.settingName === 'Access Key',
      );
      expect(accessKey).toBeDefined();
    });

    it('toggling on persists authEnabled=true via saveSettings', async () => {
      const plugin = renderAuthTab(false);
      getAuthEnabledSetting()!.toggles[0].callback!(true);
      await vi.waitFor(() => {
        expect((plugin.saveSettings as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      });
      expect((plugin.settings as { authEnabled: boolean }).authEnabled).toBe(true);
    });

    it('toggling off persists authEnabled=false via saveSettings', async () => {
      const plugin = renderAuthTab(true);
      getAuthEnabledSetting()!.toggles[0].callback!(false);
      await vi.waitFor(() => {
        expect((plugin.saveSettings as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      });
      expect((plugin.settings as { authEnabled: boolean }).authEnabled).toBe(false);
    });
  });
});

describe('McpSettingsTab module rows rendering', () => {
  type ToggleInfo = { value: boolean; tooltip: string; callback: ((value: boolean) => void) | null };
  type ModuleSettingInstance = {
    settingName: string;
    settingDesc: string;
    settingClass: string;
    container: unknown;
    toggles: ToggleInfo[];
  };

  interface ToolEntry {
    name: string;
    description: string;
  }

  interface ModuleRegistration {
    enabled: boolean;
    toolStates: Record<string, boolean>;
    module: {
      metadata: {
        id: string;
        name: string;
        description: string;
        group?: 'extras';
      };
      tools?: () => ToolEntry[];
    };
  }

  function createRegistry(modules: ModuleRegistration[]): {
    getModules: () => ModuleRegistration[];
    enableModule: ReturnType<typeof vi.fn>;
    disableModule: ReturnType<typeof vi.fn>;
    setToolEnabled: ReturnType<typeof vi.fn>;
    getState: () => Record<string, unknown>;
  } {
    return {
      getModules: () => modules,
      enableModule: vi.fn(),
      disableModule: vi.fn(),
      setToolEnabled: vi.fn(),
      getState: () => ({}),
    };
  }

  function renderModules(modules: ModuleRegistration[]): {
    registry: ReturnType<typeof createRegistry>;
    container: TrackingEl;
  } {
    const registry = createRegistry(modules);
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, accessKey: 'k' },
      httpServer: null,
      registry,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      logger: { updateOptions: (): void => {} },
      app: { vault: { configDir: '.obsidian' } },
      manifest: { id: 'obsidian-mcp', version: '0.0.0' },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const tab = new McpSettingsTab({} as any, plugin as any);
    const container = createTrackingEl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (tab as any).containerEl = container;
    tab.display();
    return { registry, container };
  }

  function findAllByClass(root: TrackingEl, cls: string): TrackingEl[] {
    const results: TrackingEl[] = [];
    for (const child of root.children) {
      if (child.className === cls) results.push(child);
      results.push(...findAllByClass(child, cls));
    }
    return results;
  }

  function getSetting(name: string): ModuleSettingInstance | undefined {
    return (Setting as unknown as { instances: ModuleSettingInstance[] }).instances.find(
      (s) => s.settingName === name,
    );
  }

  const vaultModule: ModuleRegistration = {
    enabled: true,
    toolStates: {},
    module: {
      metadata: { id: 'vault', name: 'Vault', description: 'Vault ops' },
    },
  };

  beforeEach(() => {
    (Setting as unknown as { instances: unknown[] }).instances = [];
  });

  it('renders the module enable-toggle with exactly one toggle on the module row', () => {
    renderModules([vaultModule]);
    const moduleRow = getSetting('Vault');
    expect(moduleRow).toBeDefined();
    expect(moduleRow!.toggles).toHaveLength(1);
  });

  it('does not render a Read-only sub-row for any module', () => {
    renderModules([vaultModule]);
    expect(getSetting('Read-only')).toBeUndefined();
  });

  it('wraps each module in its own .mcp-module-card container', () => {
    const { container } = renderModules([
      vaultModule,
      {
        enabled: false,
        toolStates: {},
        module: {
          metadata: { id: 'ui', name: 'UI', description: 'UI ops' },
        },
      },
    ]);
    const cards = findAllByClass(container, 'mcp-module-card');
    expect(cards).toHaveLength(2);
  });

  it('marks the module header row with the mcp-module-card-header class', () => {
    renderModules([vaultModule]);
    expect(getSetting('Vault')!.settingClass).toContain('mcp-module-card-header');
  });

  describe('extras group per-tool rendering', () => {
    const extrasModule: ModuleRegistration = {
      enabled: true,
      toolStates: { get_date: false },
      module: {
        metadata: {
          id: 'extras',
          name: 'Extras',
          description: 'Utility tools',
          group: 'extras',
        },
        tools: () => [
          { name: 'get_date', description: 'Get the current date' },
        ],
      },
    };

    it('renders one toggle row per extras tool (not a module-level row)', () => {
      renderModules([extrasModule]);
      expect(getSetting('get_date')).toBeDefined();
      expect(getSetting('Extras')).toBeUndefined();
    });

    it('uses the tool description on the per-tool row', () => {
      renderModules([extrasModule]);
      const row = getSetting('get_date')!;
      expect(row.settingDesc).toBe('Get the current date');
    });

    it('does not render a Read-only sub-row for the extras group', () => {
      renderModules([extrasModule]);
      expect(getSetting('Read-only')).toBeUndefined();
    });

    it('reflects the stored per-tool state in the toggle value', () => {
      const mod: ModuleRegistration = {
        ...extrasModule,
        toolStates: { get_date: true },
      };
      renderModules([mod]);
      expect(getSetting('get_date')!.toggles[0].value).toBe(true);
    });

    it('toggling a tool row calls registry.setToolEnabled', async () => {
      const { registry } = renderModules([extrasModule]);
      const row = getSetting('get_date')!;
      row.toggles[0].callback!(true);
      await vi.waitFor(() => {
        expect(registry.setToolEnabled).toHaveBeenCalledWith(
          'extras',
          'get_date',
          true,
        );
      });
    });

    it('renders one flat row per tool with no mcp-module-card wrapper', () => {
      const two: ModuleRegistration = {
        ...extrasModule,
        toolStates: { get_date: false, get_uuid: false },
        module: {
          ...extrasModule.module,
          tools: () => [
            { name: 'get_date', description: 'd1' },
            { name: 'get_uuid', description: 'd2' },
          ],
        },
      };
      renderModules([two]);
      expect(getSetting('get_date')).toBeDefined();
      expect(getSetting('get_uuid')).toBeDefined();
      expect(getSetting('get_date')!.settingClass).not.toContain(
        'mcp-module-card-header',
      );
      expect(getSetting('get_uuid')!.settingClass).not.toContain(
        'mcp-module-card-header',
      );
    });

    it('does not wrap extras tool rows in a .mcp-module-card container', () => {
      // When only an extras module is present, no module cards should be
      // created (cards are reserved for core module rows).
      const { container } = renderModules([extrasModule]);
      const cards = findAllByClass(container, 'mcp-module-card');
      expect(cards).toHaveLength(0);
    });

    it('defaults the get_date toggle to off on a fresh install', () => {
      // Fresh install: registry initialises toolStates[get_date] = false
      renderModules([extrasModule]);
      expect(getSetting('get_date')!.toggles[0].value).toBe(false);
    });
  });
});

describe('McpSettingsTab server settings validation', () => {
  interface TextInfo {
    placeholder: string;
    value: string;
    callback: ((value: string) => void | Promise<void>) | null;
  }
  interface ValidationSettingInstance {
    settingName: string;
    texts: TextInfo[];
    descEl: TrackingEl;
  }

  beforeEach(() => {
    (Setting as unknown as { instances: unknown[] }).instances = [];
  });

  function createValidationMockPlugin(): {
    settings: typeof DEFAULT_SETTINGS & { accessKey: string };
    httpServer: null;
    registry: { getModules: () => [] };
    logger: { updateOptions: () => void };
    saveSettings: ReturnType<typeof vi.fn>;
    app: { vault: { configDir: string } };
    manifest: { id: string; version: string };
  } {
    return {
      settings: { ...DEFAULT_SETTINGS, accessKey: 'k' },
      httpServer: null,
      registry: { getModules: () => [] },
      logger: { updateOptions: (): void => {} },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      app: { vault: { configDir: '.obsidian' } },
      manifest: { id: 'obsidian-mcp', version: '0.0.0' },
    };
  }

  function renderValidationTab(): ReturnType<typeof createValidationMockPlugin> {
    const plugin = createValidationMockPlugin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const tab = new McpSettingsTab({} as any, plugin as any);
    const container = createTrackingEl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (tab as any).containerEl = container;
    tab.display();
    return plugin;
  }

  function getSettingByName(name: string): ValidationSettingInstance {
    return (Setting as unknown as { instances: ValidationSettingInstance[] }).instances.find(
      (s) => s.settingName === name,
    )!;
  }

  function errorElements(setting: ValidationSettingInstance): TrackingEl[] {
    const results: TrackingEl[] = [];
    for (const child of setting.descEl.children) {
      if (child.className === 'mcp-settings-error') results.push(child);
    }
    return results;
  }

  describe('Server Address (IP) validation', () => {
    it('does not show an error element on initial render with a valid IP', () => {
      renderValidationTab();
      const setting = getSettingByName('Server Address');
      expect(errorElements(setting)).toHaveLength(0);
    });

    it('shows an error element when an invalid IP is typed', async () => {
      renderValidationTab();
      const setting = getSettingByName('Server Address');
      await setting.texts[0].callback!('not-an-ip');
      const errors = errorElements(setting);
      expect(errors).toHaveLength(1);
      expect(errors[0].textContent).toMatch(/invalid/i);
    });

    it('does not persist invalid IP values', async () => {
      const plugin = renderValidationTab();
      const setting = getSettingByName('Server Address');
      await setting.texts[0].callback!('256.256.256.256');
      expect(plugin.settings.serverAddress).toBe('127.0.0.1');
      expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('clears the error element when a valid IP is typed after an invalid one', async () => {
      const plugin = renderValidationTab();
      const setting = getSettingByName('Server Address');
      await setting.texts[0].callback!('bogus');
      expect(errorElements(setting)).toHaveLength(1);
      await setting.texts[0].callback!('10.0.0.1');
      expect(errorElements(setting)).toHaveLength(0);
      expect(plugin.settings.serverAddress).toBe('10.0.0.1');
      expect(plugin.saveSettings).toHaveBeenCalled();
    });
  });

  describe('Port validation', () => {
    it('does not show an error element on initial render with a valid port', () => {
      renderValidationTab();
      const setting = getSettingByName('Port');
      expect(errorElements(setting)).toHaveLength(0);
    });

    it('shows an error when the port is 0', async () => {
      renderValidationTab();
      const setting = getSettingByName('Port');
      await setting.texts[0].callback!('0');
      const errors = errorElements(setting);
      expect(errors).toHaveLength(1);
      expect(errors[0].textContent).toMatch(/invalid/i);
    });

    it('shows an error when the port is out of range (99999)', async () => {
      renderValidationTab();
      const setting = getSettingByName('Port');
      await setting.texts[0].callback!('99999');
      expect(errorElements(setting)).toHaveLength(1);
    });

    it('shows an error for a non-numeric port', async () => {
      renderValidationTab();
      const setting = getSettingByName('Port');
      await setting.texts[0].callback!('abc');
      expect(errorElements(setting)).toHaveLength(1);
    });

    it('does not persist invalid port values', async () => {
      const plugin = renderValidationTab();
      const setting = getSettingByName('Port');
      await setting.texts[0].callback!('0');
      expect(plugin.settings.port).toBe(28741);
      expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('clears the error when a valid port is typed after an invalid one', async () => {
      const plugin = renderValidationTab();
      const setting = getSettingByName('Port');
      await setting.texts[0].callback!('99999');
      expect(errorElements(setting)).toHaveLength(1);
      await setting.texts[0].callback!('3000');
      expect(errorElements(setting)).toHaveLength(0);
      expect(plugin.settings.port).toBe(3000);
      expect(plugin.saveSettings).toHaveBeenCalled();
    });
  });
});
