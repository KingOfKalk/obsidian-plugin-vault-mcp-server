import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Setting } from 'obsidian';
import { migrateSettings, generateAccessKey, isValidIPv4, McpSettingsTab } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/types';

describe('migrateSettings', () => {
  it('should migrate v0 (no schemaVersion) to v3', () => {
    const data: Record<string, unknown> = {};
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(3);
    expect(result.port).toBe(28741);
    expect(result.accessKey).toBe('');
    expect(result.httpsEnabled).toBe(false);
    expect(result.debugMode).toBe(false);
    expect(result.moduleStates).toEqual({});
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });

  it('should preserve existing values during migration', () => {
    const data: Record<string, unknown> = {
      port: 9999,
      accessKey: 'my-key',
      debugMode: true,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(3);
    expect(result.port).toBe(9999);
    expect(result.accessKey).toBe('my-key');
    expect(result.debugMode).toBe(true);
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v1 data to v3 by adding serverAddress and autoStart', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 1,
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(3);
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v2 data to v3 by adding autoStart=false', () => {
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
    expect(result.schemaVersion).toBe(3);
    expect(result.autoStart).toBe(false);
  });

  it('should not modify data already at v3', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 3,
      serverAddress: '192.168.1.100',
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      autoStart: true,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result).toEqual(data);
  });

  it('should handle partially populated v0 data', () => {
    const data: Record<string, unknown> = {
      port: 3000,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(3);
    expect(result.port).toBe(3000);
    expect(result.accessKey).toBe('');
    expect(result.moduleStates).toEqual({});
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('should default autoStart to false', () => {
    expect(DEFAULT_SETTINGS.autoStart).toBe(false);
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
  classList: { add: () => void; remove: () => void };
  handlers: Record<string, Array<() => void>>;
  children: TrackingEl[];
  empty: () => void;
  setText: () => void;
  addEventListener: (event: string, handler: () => void) => void;
  createEl: (tag?: string, opts?: { text?: string; cls?: string }) => TrackingEl;
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
    createEl: (tag?: string, opts?: { text?: string; cls?: string }): TrackingEl => {
      const child = createTrackingEl();
      if (tag) child.tagName = tag;
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
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
  beforeEach(() => {
    (Setting as unknown as { instances: unknown[] }).instances = [];
  });

  function renderWithTracking(
    overrides?: Partial<{ port: number; accessKey: string }>,
  ): { tab: McpSettingsTab; container: TrackingEl; plugin: ReturnType<typeof createConfigMockPlugin> } {
    const plugin = createConfigMockPlugin(overrides);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const tab = new McpSettingsTab({} as any, plugin as any);
    const container = createTrackingEl();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (tab as any).containerEl = container;
    tab.display();
    return { tab, container, plugin };
  }

  function createConfigMockPlugin(overrides?: Partial<{ port: number; accessKey: string }>): {
    settings: { serverAddress: string; port: number; accessKey: string; httpsEnabled: boolean; debugMode: boolean; moduleStates: Record<string, unknown>; schemaVersion: number };
    httpServer: null;
    registry: { getModules: () => [] };
    logger: { updateOptions: () => void };
    saveSettings: ReturnType<typeof vi.fn>;
  } {
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        accessKey: 'test-key-abc',
        ...overrides,
      },
      httpServer: null,
      registry: { getModules: () => [] },
      logger: { updateOptions: (): void => {} },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('should render a textarea with the MCP config JSON', () => {
    const { container } = renderWithTracking();
    const textarea = findByClass(container, 'mcp-config-textarea');
    expect(textarea).toBeDefined();
    expect(textarea!.tagName).toBe('textarea');
    expect(textarea!.value).toContain('"url"');
    expect(textarea!.value).toContain('28741');
    expect(textarea!.value).toContain('Bearer test-key-abc');
    expect(textarea!.spellcheck).toBe(false);
  });

  it('should render Copy and Regenerate buttons', () => {
    const { container } = renderWithTracking();
    const actions = findByClass(container, 'mcp-config-actions');
    expect(actions).toBeDefined();
    expect(actions!.children).toHaveLength(2);
    expect(actions!.children[0].textContent).toBe('Copy');
    expect(actions!.children[1].textContent).toBe('Regenerate');
  });

  it('Regenerate button should update textarea with current settings', () => {
    const { container, plugin } = renderWithTracking();
    const textarea = findByClass(container, 'mcp-config-textarea')!;
    const actions = findByClass(container, 'mcp-config-actions')!;
    const regenBtn = actions.children[1];

    expect(textarea.value).toContain('28741');

    plugin.settings.port = 9999;
    plugin.settings.accessKey = 'new-key-xyz';
    regenBtn.handlers['click'][0]();

    expect(textarea.value).toContain('9999');
    expect(textarea.value).toContain('Bearer new-key-xyz');
    expect(textarea.value).not.toContain('28741');
  });

  it('should set textarea rows based on config line count', () => {
    const { container } = renderWithTracking();
    const textarea = findByClass(container, 'mcp-config-textarea')!;
    const lineCount = textarea.value.split('\n').length;
    expect(textarea.rows).toBe(lineCount + 1);
  });

  it('should omit headers when access key is empty', () => {
    const { container } = renderWithTracking({ accessKey: '' });
    const textarea = findByClass(container, 'mcp-config-textarea')!;
    expect(textarea.value).toContain('"url"');
    expect(textarea.value).not.toContain('Authorization');
    expect(textarea.value).not.toContain('headers');
  });
});

describe('McpSettingsTab server controls', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPlugin: Record<string, any>;

  function createMockPlugin(isRunning: boolean, clients = 0) {
    return {
      settings: { ...DEFAULT_SETTINGS, accessKey: 'test-key' },
      httpServer: isRunning
        ? { isRunning: true, connectedClients: clients }
        : null,
      registry: { getModules: () => [] },
      startServer: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue(undefined),
      restartServer: vi.fn().mockResolvedValue(undefined),
    };
  }

  type ButtonInfo = { text: string; disabled: boolean; callback: (() => void) | null };
  type SettingInstance = { settingName: string; buttons: ButtonInfo[] };

  function getSettingButtons(name: string): ButtonInfo[] {
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === name,
    );
    return setting?.buttons ?? [];
  }

  function getStatusButtons(): ButtonInfo[] {
    return getSettingButtons('Status');
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

  it('should render three status buttons (Start, Stop, Restart)', () => {
    renderTab(false);
    const buttons = getStatusButtons();
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.text)).toEqual(['Start', 'Stop', 'Restart']);
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

  it('should render a copy icon extra button on the Access Key setting', () => {
    renderTab(false);
    const setting = (Setting as unknown as { instances: SettingInstance[] }).instances.find(
      (s) => s.settingName === 'Access Key',
    ) as unknown as { extraButtons: Array<{ icon: string; tooltip: string; callback: (() => void) | null }> };
    expect(setting).toBeDefined();
    expect(setting.extraButtons).toHaveLength(1);
    expect(setting.extraButtons[0].icon).toBe('copy');
    expect(setting.extraButtons[0].tooltip).toBe('Copy access key');
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

  it('should disable Stop and Restart when server is stopped', () => {
    renderTab(false);
    const buttons = getStatusButtons();
    const start = buttons.find((b) => b.text === 'Start')!;
    const stop = buttons.find((b) => b.text === 'Stop')!;
    const restart = buttons.find((b) => b.text === 'Restart')!;
    expect(start.disabled).toBe(false);
    expect(stop.disabled).toBe(true);
    expect(restart.disabled).toBe(true);
  });

  it('should disable Start when server is running', () => {
    renderTab(true);
    const buttons = getStatusButtons();
    const start = buttons.find((b) => b.text === 'Start')!;
    const stop = buttons.find((b) => b.text === 'Stop')!;
    const restart = buttons.find((b) => b.text === 'Restart')!;
    expect(start.disabled).toBe(true);
    expect(stop.disabled).toBe(false);
    expect(restart.disabled).toBe(false);
  });

  it('Start button calls startServer()', async () => {
    renderTab(false);
    const start = getStatusButtons().find((b) => b.text === 'Start')!;
    start.callback!();
    await vi.waitFor(() => {
      expect(mockPlugin.startServer).toHaveBeenCalled();
    });
  });

  it('Stop button calls stopServer()', async () => {
    renderTab(true);
    const stop = getStatusButtons().find((b) => b.text === 'Stop')!;
    stop.callback!();
    await vi.waitFor(() => {
      expect(mockPlugin.stopServer).toHaveBeenCalled();
    });
  });

  it('Restart button calls restartServer()', async () => {
    renderTab(true);
    const restart = getStatusButtons().find((b) => b.text === 'Restart')!;
    restart.callback!();
    await vi.waitFor(() => {
      expect(mockPlugin.restartServer).toHaveBeenCalled();
    });
  });
});
