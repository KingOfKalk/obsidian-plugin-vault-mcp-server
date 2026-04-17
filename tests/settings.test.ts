import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Setting } from 'obsidian';
import { migrateSettings, generateAccessKey, isValidIPv4, McpSettingsTab } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/types';

describe('migrateSettings', () => {
  it('should migrate v0 (no schemaVersion) to v4', () => {
    const data: Record<string, unknown> = {};
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(4);
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
    expect(result.schemaVersion).toBe(4);
    expect(result.port).toBe(9999);
    expect(result.accessKey).toBe('my-key');
    expect(result.debugMode).toBe(true);
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v1 data to v4 by adding serverAddress and autoStart', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 1,
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(4);
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v2 data to v4 by adding autoStart=false', () => {
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
    expect(result.schemaVersion).toBe(4);
    expect(result.autoStart).toBe(false);
  });

  it('should migrate v3 data to v4 by stripping per-module readOnly flags', () => {
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
    expect(result.schemaVersion).toBe(4);
    expect(result.moduleStates).toEqual({
      vault: { enabled: true },
      editor: { enabled: false },
    });
  });

  it('should not modify data already at v4', () => {
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
    expect(result).toEqual(data);
  });

  it('should handle partially populated v0 data', () => {
    const data: Record<string, unknown> = {
      port: 3000,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(4);
    expect(result.port).toBe(3000);
    expect(result.accessKey).toBe('');
    expect(result.moduleStates).toEqual({});
    expect(result.serverAddress).toBe('127.0.0.1');
    expect(result.autoStart).toBe(false);
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
    expect(result.schemaVersion).toBe(4);
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

  it('should render a <pre><code> card with the MCP config JSON', () => {
    const { container } = renderWithTracking();
    const pre = findByClass(container, 'mcp-config-code');
    expect(pre).toBeDefined();
    expect(pre!.tagName).toBe('pre');
    const code = pre!.children[0];
    expect(code.tagName).toBe('code');
    expect(code.textContent).toContain('"url"');
    expect(code.textContent).toContain('28741');
    expect(code.textContent).toContain('Bearer test-key-abc');
  });

  it('should render Copy and Regenerate as icon buttons on one line', () => {
    const { container } = renderWithTracking();
    const actions = findByClass(container, 'mcp-config-actions');
    expect(actions).toBeDefined();
    expect(actions!.children).toHaveLength(2);

    const copyBtn = actions!.children[0];
    expect(copyBtn.tagName).toBe('button');
    expect(copyBtn.attributes['aria-label']).toBe('Copy configuration');
    expect(copyBtn._icon).toBe('copy');

    const regenBtn = actions!.children[1];
    expect(regenBtn.tagName).toBe('button');
    expect(regenBtn.attributes['aria-label']).toBe('Regenerate configuration');
    expect(regenBtn._icon).toBe('refresh-cw');
  });

  it('Regenerate button should update the code block with current settings', () => {
    const { container, plugin } = renderWithTracking();
    const code = findByClass(container, 'mcp-config-code')!.children[0];
    const actions = findByClass(container, 'mcp-config-actions')!;
    const regenBtn = actions.children[1];

    expect(code.textContent).toContain('28741');

    plugin.settings.port = 9999;
    plugin.settings.accessKey = 'new-key-xyz';
    regenBtn.handlers['click'][0]();

    expect(code.textContent).toContain('9999');
    expect(code.textContent).toContain('Bearer new-key-xyz');
    expect(code.textContent).not.toContain('28741');
  });

  it('should omit headers when access key is empty', () => {
    const { container } = renderWithTracking({ accessKey: '' });
    const code = findByClass(container, 'mcp-config-code')!.children[0];
    expect(code.textContent).toContain('"url"');
    expect(code.textContent).not.toContain('Authorization');
    expect(code.textContent).not.toContain('headers');
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
      saveSettings: vi.fn().mockResolvedValue(undefined),
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
    isReadOnly: boolean;
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
          { name: 'get_date', description: 'Get the current date', isReadOnly: true },
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
            { name: 'get_date', description: 'd1', isReadOnly: true },
            { name: 'get_uuid', description: 'd2', isReadOnly: true },
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
