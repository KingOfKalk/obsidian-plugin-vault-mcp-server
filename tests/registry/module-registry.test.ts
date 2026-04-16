import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ToolModule, ToolDefinition } from '../../src/registry/types';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../../src/utils/logger';

function createMockLogger(): Logger {
  const logger = new Logger('test', { debugMode: false, accessKey: '' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return logger;
}

function createMockTool(name: string, isReadOnly: boolean): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    schema: {},
    handler: (): Promise<CallToolResult> =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'ok' }],
      }),
    isReadOnly,
  };
}

function createMockModule(
  id: string,
  tools: ToolDefinition[],
  supportsReadOnly = false,
  defaultEnabled?: boolean,
): ToolModule {
  return {
    metadata: {
      id,
      name: `Mock ${id}`,
      description: `Mock module: ${id}`,
      supportsReadOnly,
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
      const module = createMockModule('extras', [], true, false);
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

  describe('setReadOnly', () => {
    it('should set a module to read-only', () => {
      const module = createMockModule('vault', [], true);
      registry.registerModule(module);
      registry.setReadOnly('vault', true);
      const reg = registry.getModule('vault');
      expect(reg?.readOnly).toBe(true);
    });

    it('should throw when module does not support read-only', () => {
      const module = createMockModule('search', [], false);
      registry.registerModule(module);
      expect(() => registry.setReadOnly('search', true)).toThrow('does not support read-only');
    });

    it('should throw for non-existent module', () => {
      expect(() => registry.setReadOnly('missing', true)).toThrow('not registered');
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

    it('should exclude write tools in read-only mode', () => {
      const tools = [createMockTool('vault_read', true), createMockTool('vault_create', false)];
      const module = createMockModule('vault', tools, true);
      registry.registerModule(module);
      registry.setReadOnly('vault', true);
      const active = registry.getActiveTools();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('vault_read');
    });

    it('should include all tools when read-only is off', () => {
      const tools = [createMockTool('vault_read', true), createMockTool('vault_create', false)];
      const module = createMockModule('vault', tools, true);
      registry.registerModule(module);
      expect(registry.getActiveTools()).toHaveLength(2);
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
      const module = createMockModule('vault', [], true);
      registry.registerModule(module);
      registry.applyState({
        vault: { enabled: false, readOnly: true },
      });
      expect(registry.isModuleEnabled('vault')).toBe(false);
      expect(registry.getModule('vault')?.readOnly).toBe(true);
    });

    it('should ignore state for unregistered modules', () => {
      registry.applyState({ missing: { enabled: false, readOnly: false } });
      expect(registry.getModules()).toHaveLength(0);
    });

    it('should return current state', () => {
      const module = createMockModule('vault', [], true);
      registry.registerModule(module);
      registry.disableModule('vault');
      const state = registry.getState();
      expect(state.vault).toEqual({ enabled: false, readOnly: false });
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
