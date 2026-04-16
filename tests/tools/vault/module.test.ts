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

  it('should register 16 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const tools = module.tools();
    expect(tools).toHaveLength(16);
  });

  it('should have 5 read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const readOnlyTools = module.tools().filter((t) => t.isReadOnly);
    expect(readOnlyTools).toHaveLength(5);
  });

  it('should have 11 write tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const writeTools = module.tools().filter((t) => !t.isReadOnly);
    expect(writeTools).toHaveLength(11);
  });

  it('should have correct tool names', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const names = module.tools().map((t) => t.name).sort();
    expect(names).toEqual([
      'vault_append',
      'vault_copy',
      'vault_create',
      'vault_create_folder',
      'vault_delete',
      'vault_delete_folder',
      'vault_get_metadata',
      'vault_list',
      'vault_list_recursive',
      'vault_move',
      'vault_read',
      'vault_read_binary',
      'vault_rename',
      'vault_rename_folder',
      'vault_update',
      'vault_write_binary',
    ]);
  });
});
