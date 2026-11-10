import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ToolModule, ToolDefinition, annotations as annPresets } from '../../src/registry/types';
import { CallToolResult } from '@modelcontextprotocol/server';
import { Logger } from '../../src/utils/logger';

function createMockLogger(): Logger {
  const logger = new Logger('test', { debugMode: false, accessKey: '' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return logger;
}

function createMockTool(name: string, readOnly: boolean): ToolDefinition {
  return {
    name,
    title: `Mock ${name}`,
    description: `Mock tool: ${name}`,
    schema: {},
    handler: (): Promise<CallToolResult> =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'ok' }],
      }),
    annotations: readOnly ? annPresets.read : annPresets.destructive,
  };
}

function createMockModule(
  id: string,
  tools: ToolDefinition[],
  defaultEnabled?: boolean,
): ToolModule {
  return {
    metadata: {
      id,
      name: `Mock ${id}`,
      description: `Mock module: ${id}`,
      ...(defaultEnabled !== undefined ? { defaultEnabled } : {}),
    },
    tools: () => tools,
  };
}

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    vi.restoreAllMocks();
    const logger = createMockLogger();
    registry = new ModuleRegistry(logger);
  });

  describe('registerModule', () => {
    it('should register a module', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      expect(registry.getModules()).toHaveLength(1);
      expect(registry.getModules()[0].module).toBe(module);
    });

    it('should register modules as enabled by default', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      expect(registry.getModules()[0].enabled).toBe(true);
    });

    it('should honor defaultEnabled: false on registration', () => {
      const module = createMockModule('extras', [], false);
      registry.registerModule(module);
      expect(registry.isModuleEnabled('extras')).toBe(false);
    });

    it('should skip duplicate module registration', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      registry.registerModule(module);
      expect(registry.getModules()).toHaveLength(1);
    });
  });

  describe('unregisterModule', () => {
    it('should remove a registered module', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      registry.unregisterModule('vault');
      expect(registry.getModules()).toHaveLength(0);
    });

    it('should handle unregistering a non-existent module gracefully', () => {
      expect(() => registry.unregisterModule('missing')).not.toThrow();
    });
  });

  describe('enableModule / disableModule', () => {
    it('should disable a module', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      registry.disableModule('vault');
      expect(registry.isModuleEnabled('vault')).toBe(false);
    });

    it('should re-enable a disabled module', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      registry.disableModule('vault');
      registry.enableModule('vault');
      expect(registry.isModuleEnabled('vault')).toBe(true);
    });

    it('should throw when enabling a non-existent module', () => {
      expect(() => registry.enableModule('missing')).toThrow('not registered');
    });

    it('should throw when disabling a non-existent module', () => {
      expect(() => registry.disableModule('missing')).toThrow('not registered');
    });
  });

  describe('getActiveTools', () => {
    it('should return tools from enabled modules', () => {
      const tools = [createMockTool('vault_read', true), createMockTool('vault_create', false)];
      const module = createMockModule('vault', tools);
      registry.registerModule(module);
      expect(registry.getActiveTools()).toHaveLength(2);
    });

    it('should exclude tools from disabled modules', () => {
      const module = createMockModule('vault', [createMockTool('vault_read', true)]);
      registry.registerModule(module);
      registry.disableModule('vault');
      expect(registry.getActiveTools()).toHaveLength(0);
    });

    it('should expose mutating tools from enabled modules regardless of readOnly annotation', () => {
      const tools = [createMockTool('vault_read', true), createMockTool('vault_create', false)];
      const module = createMockModule('vault', tools);
      registry.registerModule(module);
      const active = registry.getActiveTools();
      expect(active).toHaveLength(2);
      expect(active.map((t) => t.name).sort()).toEqual(['vault_create', 'vault_read']);
    });

    it('should aggregate tools from multiple modules', () => {
      registry.registerModule(
        createMockModule('vault', [createMockTool('vault_read', true)]),
      );
      registry.registerModule(
        createMockModule('search', [createMockTool('search_fulltext', true)]),
      );
      expect(registry.getActiveTools()).toHaveLength(2);
    });
  });

  describe('applyState / getState', () => {
    it('should apply state from settings', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      registry.applyState({
        vault: { enabled: false },
      });
      expect(registry.isModuleEnabled('vault')).toBe(false);
    });

    it('should ignore state for unregistered modules', () => {
      registry.applyState({ missing: { enabled: false } });
      expect(registry.getModules()).toHaveLength(0);
    });

    it('should return current state', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      registry.disableModule('vault');
      const state = registry.getState();
      expect(state.vault).toEqual({ enabled: false });
    });
  });

  describe('extras group per-tool toggles', () => {
    function createExtrasModule(
      id: string,
      tools: ToolDefinition[],
    ): ToolModule {
      return {
        metadata: {
          id,
          name: `Mock ${id}`,
          description: `Mock extras: ${id}`,
          group: 'extras',
          defaultEnabled: false,
        },
        tools: () => tools,
      };
    }

    it('initializes tool states to disabled on registration', () => {
      const mod = createExtrasModule('extras', [
        createMockTool('get_date', true),
      ]);
      registry.registerModule(mod);
      expect(registry.isToolEnabled('extras', 'get_date')).toBe(false);
    });

    it('setToolEnabled toggles a single tool', () => {
      const mod = createExtrasModule('extras', [
        createMockTool('get_date', true),
        createMockTool('get_uuid', true),
      ]);
      registry.registerModule(mod);
      registry.setToolEnabled('extras', 'get_date', true);
      expect(registry.isToolEnabled('extras', 'get_date')).toBe(true);
      expect(registry.isToolEnabled('extras', 'get_uuid')).toBe(false);
    });

    it('setToolEnabled throws for non-extras modules', () => {
      registry.registerModule(
        createMockModule('vault', [createMockTool('vault_read', true)]),
      );
      expect(() =>
        registry.setToolEnabled('vault', 'vault_read', true),
      ).toThrow('does not support per-tool');
    });

    it('setToolEnabled throws for unknown tool names', () => {
      registry.registerModule(
        createExtrasModule('extras', [createMockTool('get_date', true)]),
      );
      expect(() =>
        registry.setToolEnabled('extras', 'nope', true),
      ).toThrow('is not defined by');
    });

    it('getActiveTools excludes disabled extras tools', () => {
      const mod = createExtrasModule('extras', [
        createMockTool('get_date', true),
        createMockTool('get_uuid', true),
      ]);
      registry.registerModule(mod);
      registry.setToolEnabled('extras', 'get_date', true);
      const active = registry.getActiveTools();
      expect(active.map((t) => t.name)).toEqual(['get_date']);
    });

    it('getActiveTools returns nothing when no extras tool is enabled', () => {
      registry.registerModule(
        createExtrasModule('extras', [createMockTool('get_date', true)]),
      );
      expect(registry.getActiveTools()).toHaveLength(0);
    });

    it('getState includes per-tool states for extras', () => {
      registry.registerModule(
        createExtrasModule('extras', [createMockTool('get_date', true)]),
      );
      registry.setToolEnabled('extras', 'get_date', true);
      const state = registry.getState();
      expect(state.extras.toolStates).toEqual({ get_date: true });
    });

    it('applyState restores per-tool states', () => {
      registry.registerModule(
        createExtrasModule('extras', [
          createMockTool('get_date', true),
          createMockTool('get_uuid', true),
        ]),
      );
      registry.applyState({
        extras: {
          enabled: true,
          toolStates: { get_date: true },
        },
      });
      expect(registry.isToolEnabled('extras', 'get_date')).toBe(true);
      expect(registry.isToolEnabled('extras', 'get_uuid')).toBe(false);
    });

    it('applyState without toolStates leaves extras tools disabled', () => {
      registry.registerModule(
        createExtrasModule('extras', [createMockTool('get_date', true)]),
      );
      registry.applyState({
        extras: { enabled: true },
      });
      expect(registry.isToolEnabled('extras', 'get_date')).toBe(false);
    });

    it('getEnabledModuleIds lists enabled modules and extras only while a tool is on (#402)', () => {
      registry.registerModule(createMockModule('vault', [createMockTool('a', true)]));
      registry.registerModule(createMockModule('editor', [createMockTool('b', true)]));
      registry.registerModule(
        createExtrasModule('extras', [createMockTool('get_date', true)]),
      );
      registry.disableModule('editor');
      expect(registry.getEnabledModuleIds()).toEqual(['vault']);
      registry.setToolEnabled('extras', 'get_date', true);
      expect(registry.getEnabledModuleIds()).toEqual(['vault', 'extras']);
    });
  });

  describe('onChange', () => {
    it('should notify on module registration', () => {
      const handler = vi.fn();
      registry.onChange(handler);
      registry.registerModule(createMockModule('vault', []));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should notify on enable/disable', () => {
      const handler = vi.fn();
      registry.registerModule(createMockModule('vault', []));
      registry.onChange(handler);
      registry.disableModule('vault');
      registry.enableModule('vault');
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should support unsubscribe', () => {
      const handler = vi.fn();
      const unsubscribe = registry.onChange(handler);
      unsubscribe();
      registry.registerModule(createMockModule('vault', []));
      expect(handler).not.toHaveBeenCalled();
    });

    it('counts subscribers, so open MCP sessions can be checked for leaks (#448)', () => {
      expect(registry.changeHandlerCount).toBe(0);
      const unsubscribeA = registry.onChange(vi.fn());
      const unsubscribeB = registry.onChange(vi.fn());
      expect(registry.changeHandlerCount).toBe(2);
      unsubscribeA();
      unsubscribeB();
      expect(registry.changeHandlerCount).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all modules', () => {
      registry.registerModule(createMockModule('vault', []));
      registry.registerModule(createMockModule('search', []));
      registry.clear();
      expect(registry.getModules()).toHaveLength(0);
    });
  });

  describe('getModule', () => {
    it('should return a specific module registration', () => {
      const module = createMockModule('vault', []);
      registry.registerModule(module);
      expect(registry.getModule('vault')?.module).toBe(module);
    });

    it('should return undefined for non-existent module', () => {
      expect(registry.getModule('missing')).toBeUndefined();
    });
  });

  describe('isModuleEnabled', () => {
    it('should return false for non-existent module', () => {
      expect(registry.isModuleEnabled('missing')).toBe(false);
    });
  });
});

describe('ModuleRegistry runtime availability (#469)', () => {
  let registry: ModuleRegistry;
  let available: boolean;

  function conditionalTool(name: string): ToolDefinition {
    return { ...createMockTool(name, true), isAvailable: (): boolean => available };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    registry = new ModuleRegistry(createMockLogger());
    available = false;
    registry.registerModule(
      createMockModule('plugins', [createMockTool('always', true), conditionalTool('sometimes')]),
    );
  });

  it('leaves an unavailable tool out of the active tools', () => {
    expect(registry.getActiveTools().map((t) => t.name)).toEqual(['always']);
    available = true;
    expect(registry.getActiveTools().map((t) => t.name)).toEqual(['always', 'sometimes']);
  });

  it('keeps the module on: availability is separate from the user switch', () => {
    expect(registry.isModuleEnabled('plugins')).toBe(true);
    expect(registry.getState()).toEqual({ plugins: { enabled: true } });
    expect(registry.getEnabledModuleIds()).toEqual(['plugins']);
  });

  it('an available tool of a disabled module stays inactive', () => {
    available = true;
    registry.disableModule('plugins');
    expect(registry.getActiveTools()).toEqual([]);
  });

  it('refreshAvailability notifies only when availability changed', () => {
    const handler = vi.fn();
    registry.onChange(handler);

    expect(registry.refreshAvailability()).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    available = true;
    expect(registry.refreshAvailability()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(registry.refreshAvailability()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);

    available = false;
    expect(registry.refreshAvailability()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a change already notified by a switch is not notified again', () => {
    const handler = vi.fn();
    registry.onChange(handler);
    available = true;
    registry.disableModule('plugins');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(registry.refreshAvailability()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a check that throws counts as unavailable', () => {
    registry.registerModule(
      createMockModule('broken', [
        {
          ...createMockTool('throws', true),
          isAvailable: (): boolean => {
            throw new Error('plugin API gone');
          },
        },
      ]),
    );
    expect(registry.getActiveTools().map((t) => t.name)).not.toContain('throws');
    expect(registry.refreshAvailability()).toBe(false);
  });
});

describe('default module states (#469)', () => {
  it('modules with defaultEnabled: false start off and can be applied on', () => {
    const registry = new ModuleRegistry(createMockLogger());
    registry.registerModule(createMockModule('editor', [createMockTool('editor_x', true)], false));
    expect(registry.isModuleEnabled('editor')).toBe(false);
    expect(registry.getActiveTools()).toEqual([]);
    registry.applyState({ editor: { enabled: true } });
    expect(registry.getActiveTools().map((t) => t.name)).toEqual(['editor_x']);
  });
});
