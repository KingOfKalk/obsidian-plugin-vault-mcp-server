import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createVaultModule } from '../../../src/tools/vault/index';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';

describe('vault module', () => {
  it('should have correct metadata', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    expect(module.metadata.id).toBe('vault');
    expect(module.metadata.name).toBe('Vault and File Operations');
  });

  it('should register 22 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const tools = module.tools();
    expect(tools).toHaveLength(22);
  });

  it('should have 11 read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const readOnlyTools = module.tools().filter((t) => t.annotations.readOnlyHint);
    expect(readOnlyTools).toHaveLength(11);
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
      'vault_get_backlinks',
      'vault_get_block_references',
      'vault_get_embeds',
      'vault_get_frontmatter',
      'vault_get_headings',
      'vault_get_metadata',
      'vault_get_outgoing_links',
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
 * #248: every vault read tool that emits `structuredContent` must declare
 * an `outputSchema`, and that schema must accurately describe the payload
 * the handler actually produces. Drift between renderer and structured
 * payload is the failure mode this guards against.
 *
 * `vault_read_binary` was retrofitted in Batch D so it now emits
 * `structuredContent: { path, data, encoding, size_bytes }` while keeping
 * the bare base64 string in `result.content[0].text` for existing callers.
 */
describe('vault read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape | z.ZodTypeAny },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    if (tool.outputSchema instanceof z.ZodType) {
      throw new Error('expected outputSchema to be a raw shape, not a full Zod schema');
    }
    return z.object(tool.outputSchema).strict();
  }

  function findTool(
    name: string,
  ): { name: string; outputSchema?: z.ZodRawShape | z.ZodTypeAny } {
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

  it('vault_read_binary declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_read_binary');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('img.png', '');
    await adapter.writeBinary('img.png', new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const handlers = createHandlers(adapter, new WriteMutex());

    const result = await handlers.readBinary({
      path: 'img.png',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed).toEqual({
      path: 'img.png',
      data: '/9j/',
      encoding: 'base64',
      size_bytes: 3,
    });
  });

  it('vault_read_binary plain-text rendering still returns the bare base64 string', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('img.png', '');
    await adapter.writeBinary('img.png', new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const handlers = createHandlers(adapter, new WriteMutex());

    // Default response_format ('markdown'); no callsite churn for existing
    // callers — the rendered text remains the bare base64 string.
    const result = await handlers.readBinary({ path: 'img.png' });
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('/9j/');
    }
  });

  it('vault_get_frontmatter declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_frontmatter');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', '');
    adapter.setMetadata('note.md', { frontmatter: { status: 'done', tags: ['x'] } });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchFrontmatter({
      path: 'note.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('note.md');
    expect(parsed.frontmatter).toEqual({ status: 'done', tags: ['x'] });
  });

  it('vault_get_headings declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_headings');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', '');
    adapter.setMetadata('note.md', {
      headings: [
        { heading: 'Top', level: 1 },
        { heading: 'Sub', level: 2 },
      ],
    });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchHeadings({
      path: 'note.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.headings).toEqual([
      { heading: 'Top', level: 1 },
      { heading: 'Sub', level: 2 },
    ]);
  });

  it('vault_get_outgoing_links declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_outgoing_links');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', {
      links: [{ link: 'b', displayText: 'Bee' }, { link: 'c' }],
    });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchOutgoingLinks({
      path: 'a.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('a.md');
    expect(parsed.links).toEqual([
      { link: 'b', displayText: 'Bee' },
      { link: 'c' },
    ]);
  });

  it('vault_get_embeds declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_embeds');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', {
      embeds: [{ link: 'image.png' }],
    });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchEmbeds({
      path: 'a.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.embeds).toEqual([{ link: 'image.png' }]);
  });

  it('vault_get_backlinks declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_backlinks');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchBacklinks({
      path: 'a.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('a.md');
    expect(parsed.backlinks).toEqual(['b.md']);
  });

  it('vault_get_block_references declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_block_references');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', 'A line ^anchor-1\nAnother ^anchor-2\n');
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchBlockReferences({
      path: 'note.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('note.md');
    expect(parsed.blockRefs).toEqual([
      { id: 'anchor-1', line: 'A line ^anchor-1' },
      { id: 'anchor-2', line: 'Another ^anchor-2' },
    ]);
  });
});

describe('vault tool descriptions document shared args', () => {
  function descriptionFor(name: string): string {
    const adapter = new MockObsidianAdapter();
    const tool = createVaultModule(adapter)
      .tools()
      .find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.description;
  }

  it('documents pagination and response_format on vault_list_recursive', () => {
    const desc = descriptionFor('vault_list_recursive');
    expect(desc).toContain('limit (integer');
    expect(desc).toContain('offset (integer');
    expect(desc).toContain('response_format (enum');
  });

  it('documents response_format on read-only tools that spread responseFormatField', () => {
    for (const name of ['vault_read', 'vault_get_metadata', 'vault_list']) {
      const desc = descriptionFor(name);
      expect(desc).toContain('response_format (enum');
    }
  });
});
