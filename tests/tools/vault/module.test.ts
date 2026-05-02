import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createVaultModule } from '../../../src/tools/vault/index';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';

describe('vault module', () => {
  it('should have correct metadata', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    expect(module.metadata.id).toBe('vault');
    expect(module.metadata.name).toBe('Vault and File Operations');
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
    const readOnlyTools = module.tools().filter((t) => t.annotations.readOnlyHint);
    expect(readOnlyTools).toHaveLength(5);
  });

  it('should have 11 write tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const writeTools = module.tools().filter((t) => !t.annotations.readOnlyHint);
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

/**
 * Batch A of #248: every vault read tool that emits `structuredContent`
 * must declare an `outputSchema`, and that schema must accurately describe
 * the payload the handler actually produces. Drift between renderer and
 * structured payload is the failure mode this guards against.
 *
 * `vault_read_binary` is excluded — its handler returns plain text (no
 * `structuredContent`), so declaring an `outputSchema` would violate the
 * MCP contract. Deferred to the Batch D follow-up (see plan).
 */
describe('vault read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }

  function findTool(
    name: string,
  ): { name: string; outputSchema?: z.ZodRawShape } {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const tool = module.tools().find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not found`);
    return tool;
  }

  it('vault_read declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_read');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('test.md', '# Hello');
    const handlers = createHandlers(adapter, new WriteMutex());

    const result = await handlers.readFile({
      path: 'test.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed).toEqual({ path: 'test.md', content: '# Hello' });
  });

  it('vault_get_metadata declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_get_metadata');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', 'hi', { ctime: 1000, mtime: 2000 });
    const handlers = createHandlers(adapter, new WriteMutex());

    const result = await handlers.getMetadata({
      path: 'note.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('note.md');
    expect(parsed.size).toBe(2);
    expect(typeof parsed.created).toBe('string');
    expect(typeof parsed.modified).toBe('string');
  });

  it('vault_list declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_list');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFolder('notes');
    adapter.addFile('notes/a.md', 'a');
    adapter.addFolder('notes/sub');
    const handlers = createHandlers(adapter, new WriteMutex());

    const result = await handlers.listFolder({
      path: 'notes',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.files).toEqual(expect.any(Array));
    expect(parsed.folders).toEqual(expect.any(Array));
  });

  it('vault_list_recursive declares outputSchema and parses with next_offset present', async () => {
    const tool = findTool('vault_list_recursive');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFolder('lots');
    for (let i = 0; i < 5; i++) {
      adapter.addFile(`lots/f-${String(i)}.md`, 'x');
    }
    const handlers = createHandlers(adapter, new WriteMutex());

    const result = await handlers.listRecursive({
      path: 'lots',
      limit: 2,
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_offset).toBe(2);
    expect(parsed.items).toHaveLength(2);
  });

  it('vault_list_recursive parses cleanly when has_more is false (no next_offset)', async () => {
    const tool = findTool('vault_list_recursive');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFolder('few');
    adapter.addFile('few/a.md', 'a');
    adapter.addFile('few/b.md', 'b');
    const handlers = createHandlers(adapter, new WriteMutex());

    const result = await handlers.listRecursive({
      path: 'few',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_offset).toBeUndefined();
  });

  it('vault_read_binary intentionally omits outputSchema (no structuredContent emitted)', () => {
    const tool = findTool('vault_read_binary');
    // Deferred to Batch D. Asserting the absence pins the deviation
    // documented in docs/superpowers/plans/248-output-schema.md so a
    // future change cannot silently add one without re-checking that the
    // handler also emits a matching structuredContent slot.
    expect(tool.outputSchema).toBeUndefined();
  });
});
