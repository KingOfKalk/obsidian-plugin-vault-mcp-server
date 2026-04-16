import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createVaultModule } from '../../../src/tools/vault/index';

describe('vault module', () => {
  it('should have correct metadata', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    expect(module.metadata.id).toBe('vault');
    expect(module.metadata.name).toBe('Vault and File Operations');
    expect(module.metadata.supportsReadOnly).toBe(true);
  });

  it('should register 6 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const tools = module.tools();
    expect(tools).toHaveLength(6);
  });

  it('should have 2 read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const readOnlyTools = module.tools().filter((t) => t.isReadOnly);
    expect(readOnlyTools).toHaveLength(2);
    expect(readOnlyTools.map((t) => t.name).sort()).toEqual(['vault_get_metadata', 'vault_read']);
  });

  it('should have 4 write tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const writeTools = module.tools().filter((t) => !t.isReadOnly);
    expect(writeTools).toHaveLength(4);
  });

  it('should have correct tool names', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const names = module.tools().map((t) => t.name).sort();
    expect(names).toEqual([
      'vault_append',
      'vault_create',
      'vault_delete',
      'vault_get_metadata',
      'vault_read',
      'vault_update',
    ]);
  });
});
