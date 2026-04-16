import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Setting } from 'obsidian';
import { migrateSettings, generateAccessKey, isValidIPv4, McpSettingsTab } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/types';

describe('migrateSettings', () => {
  it('should migrate v0 (no schemaVersion) to v2', () => {
    const data: Record<string, unknown> = {};
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(2);
    expect(result.port).toBe(28741);
    expect(result.accessKey).toBe('');
    expect(result.httpsEnabled).toBe(false);
    expect(result.debugMode).toBe(false);
    expect(result.moduleStates).toEqual({});
    expect(result.serverAddress).toBe('127.0.0.1');
  });

  it('should preserve existing values during migration', () => {
    const data: Record<string, unknown> = {
      port: 9999,
      accessKey: 'my-key',
      debugMode: true,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(2);
    expect(result.port).toBe(9999);
    expect(result.accessKey).toBe('my-key');
    expect(result.debugMode).toBe(true);
    expect(result.serverAddress).toBe('127.0.0.1');
  });

  it('should migrate v1 data to v2 by adding serverAddress', () => {
    const data: Record<string, unknown> = {
      schemaVersion: 1,
      port: 28741,
      accessKey: 'test',
      httpsEnabled: false,
      debugMode: false,
      moduleStates: {},
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(2);
    expect(result.serverAddress).toBe('127.0.0.1');
  });

  it('should not modify data already at v2', () => {
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
    expect(result).toEqual(data);
  });

  it('should handle partially populated v0 data', () => {
    const data: Record<string, unknown> = {
      port: 3000,
    };
    const result = migrateSettings(data);
    expect(result.schemaVersion).toBe(2);
    expect(result.port).toBe(3000);
    expect(result.accessKey).toBe('');
    expect(result.moduleStates).toEqual({});
    expect(result.serverAddress).toBe('127.0.0.1');
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

  it('should render Copy URL button in Server URL setting', () => {
    renderTab(false);
    const buttons = getSettingButtons('Server URL');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].text).toBe('Copy URL');
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
