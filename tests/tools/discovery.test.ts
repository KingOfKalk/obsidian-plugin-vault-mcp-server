import { describe, it, expect, vi } from 'vitest';
import { discoverModules, MODULE_FACTORIES } from '../../src/tools';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { Logger } from '../../src/utils/logger';

function createSilentLogger(): Logger {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return new Logger('test', { debugMode: false, accessKey: '' });
}

describe('tool discovery', () => {
  it('exposes all seven module factories', () => {
    expect(MODULE_FACTORIES).toHaveLength(7);
  });

  it('discovers modules with unique ids', () => {
    const adapter = new MockObsidianAdapter();
    const modules = discoverModules(adapter);
    const ids = modules.map((m) => m.metadata.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'vault',
        'editor',
        'search',
        'workspace',
        'ui',
        'templates',
        'plugin-interop',
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each discovered module exposes at least one tool', () => {
    const adapter = new MockObsidianAdapter();
    for (const module of discoverModules(adapter)) {
      expect(module.tools().length).toBeGreaterThan(0);
    }
  });

  it('registering all discovered modules produces a non-empty active tool list', () => {
    const adapter = new MockObsidianAdapter();
    const registry = new ModuleRegistry(createSilentLogger());
    for (const module of discoverModules(adapter)) {
      registry.registerModule(module);
    }
    expect(registry.getModules().length).toBe(MODULE_FACTORIES.length);
    expect(registry.getActiveTools().length).toBeGreaterThan(0);
  });
});
