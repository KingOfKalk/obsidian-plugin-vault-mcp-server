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

  it('should register 21 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const tools = module.tools();
    expect(tools).toHaveLength(20);
  });

  it('should have 6 read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const readOnlyTools = module.tools().filter((t) => t.annotations.readOnlyHint);
    expect(readOnlyTools).toHaveLength(6);
  });

  it('should have 15 write tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const writeTools = module.tools().filter((t) => !t.annotations.readOnlyHint);
    expect(writeTools).toHaveLength(14);
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
      'vault_daily_note',
      'vault_delete',
      'vault_delete_folder',
      'vault_get_aspect',
      'vault_get_metadata',
      'vault_insert',
      'vault_list',
      'vault_list_recursive',
      'vault_move',
      'vault_read',
      'vault_read_binary',
      'vault_rename',
      'vault_replace',
      'vault_set_frontmatter',
      'vault_update',
      'vault_write_binary',
    ]);
  });

  it('registers vault_daily_note', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const names = module.tools().map((t) => t.name);
    expect(names).toContain('vault_daily_note');
  });
});

/**
 * #248: every vault read tool that emits `structuredContent` must declare
 * an `outputSchema`, and that schema must accurately describe the payload
 * the handler actually produces. Drift between renderer and structured
 * payload is the failure mode this guards against.
 *
 * `vault_read_binary` was retrofitted in Batch D so it now emits
 * `structuredContent: { path, data, encoding, sizeBytes }` while keeping
 * the bare base64 string in `result.content[0].text` for existing callers.
 */
describe('vault read tools — outputSchema declarations', () => {
  function getStructured(tool: {
    outputSchema?: z.ZodRawShape | z.ZodTypeAny;
  }): z.ZodTypeAny {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    // Raw shape (Record<string, ZodTypeAny>) → wrap in z.object().strict().
    // Full Zod schema (e.g. z.discriminatedUnion) → return as-is.
    if (tool.outputSchema instanceof z.ZodType) {
      return tool.outputSchema;
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

  it('document and binary tools declare no outputSchema (#467)', () => {
    for (const name of ['vault_read', 'vault_daily_note', 'vault_read_binary']) {
      expect(findTool(name).outputSchema, name).toBeUndefined();
    }
  });

  it('every other vault tool declares an outputSchema (#467)', () => {
    const adapter = new MockObsidianAdapter();
    const data = createVaultModule(adapter)
      .tools()
      .filter((t) => !['vault_read', 'vault_daily_note', 'vault_read_binary'].includes(t.name));
    expect(data).toHaveLength(17);
    for (const tool of data) expect(tool.outputSchema, tool.name).toBeDefined();
  });

  it('vault_get_metadata declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_get_metadata');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', 'hi', { ctime: 1000, mtime: 2000 });
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.getMetadata({
      path: 'note.md',
    });
    const parsed = schema.parse(result.structuredContent) as {
      path: string;
      size: number;
      created: string;
      modified: string;
    };
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
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.listFolder({
      path: 'notes',
    });
    const parsed = schema.parse(result.structuredContent) as {
      files: string[];
      folders: string[];
    };
    expect(parsed.files).toEqual(expect.any(Array));
    expect(parsed.folders).toEqual(expect.any(Array));
  });

  it('vault_list_recursive declares outputSchema and parses with nextOffset present', async () => {
    const tool = findTool('vault_list_recursive');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFolder('lots');
    for (let i = 0; i < 5; i++) {
      adapter.addFile(`lots/f-${String(i)}.md`, 'x');
    }
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.listRecursive({
      path: 'lots',
      limit: 2,
    });
    const parsed = schema.parse(result.structuredContent) as {
      total: number;
      count: number;
      hasMore: boolean;
      nextOffset?: number;
      items: string[];
    };
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextOffset).toBe(2);
    expect(parsed.items).toHaveLength(2);
  });

  it('vault_list_recursive parses cleanly when hasMore is false (no nextOffset)', async () => {
    const tool = findTool('vault_list_recursive');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFolder('few');
    adapter.addFile('few/a.md', 'a');
    adapter.addFile('few/b.md', 'b');
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.listRecursive({
      path: 'few',
    });
    const parsed = schema.parse(result.structuredContent) as {
      hasMore: boolean;
      nextOffset?: number;
    };
    expect(parsed.hasMore).toBe(false);
    expect(parsed.nextOffset).toBeUndefined();
  });

  it('vault_get_aspect declares a discriminated outputSchema and parses each variant', async () => {
    const tool = findTool('vault_get_aspect');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'A line ^anchor\n');
    adapter.setMetadata('a.md', {
      frontmatter: { status: 'done', tags: ['x'] },
      headings: [
        { heading: 'Top', level: 1 },
        { heading: 'Sub', level: 2 },
      ],
      links: [{ link: 'b', displayText: 'Bee' }, { link: 'c' }],
      embeds: [{ link: 'image.png' }],
    });
    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });

    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const cases = [
      {
        aspect: 'frontmatter' as const,
        expected: { aspect: 'frontmatter', path: 'a.md', frontmatter: { status: 'done', tags: ['x'] } },
      },
      {
        aspect: 'headings' as const,
        expected: {
          aspect: 'headings',
          path: 'a.md',
          headings: [
            { heading: 'Top', level: 1 },
            { heading: 'Sub', level: 2 },
          ],
        },
      },
      {
        aspect: 'outgoing_links' as const,
        expected: {
          aspect: 'outgoing_links',
          path: 'a.md',
          links: [
            { link: 'b', path: 'b.md', displayText: 'Bee' },
            { link: 'c', path: null },
          ],
        },
      },
      {
        aspect: 'embeds' as const,
        expected: { aspect: 'embeds', path: 'a.md', embeds: [{ link: 'image.png', path: null }] },
      },
      {
        aspect: 'backlinks' as const,
        expected: { aspect: 'backlinks', path: 'a.md', backlinks: ['b.md'], total: 1, hasMore: false },
      },
      {
        aspect: 'block_references' as const,
        expected: {
          aspect: 'block_references',
          path: 'a.md',
          blockRefs: [{ id: 'anchor', text: 'A line ^anchor' }],
        },
      },
    ];

    for (const { aspect, expected } of cases) {
      const result = await handlers.getAspect({
        path: 'a.md',
        aspect,
      });
      const parsed = schema.parse(result.structuredContent);
      expect(parsed).toEqual(expected);
    }
  });

  it('vault_get_aspect outputSchema parses backlinks with includeContext (#408)', async () => {
    const schema = getStructured(findTool('vault_get_aspect'));
    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'x');
    adapter.addFile('b.md', 'top\nsee [[a]]');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.getAspect({
      path: 'a.md',
      aspect: 'backlinks',
      includeContext: true,
    });
    expect(schema.parse(result.structuredContent)).toEqual({
      aspect: 'backlinks',
      path: 'a.md',
      backlinks: ['b.md'],
      backlinkContext: [{ path: 'b.md', matches: [{ line: 2, text: 'see [[a]]' }] }],
      total: 1,
      hasMore: false,
    });

    // includeContext is ignored for other aspects.
    const headings = await handlers.getAspect({
      path: 'a.md',
      aspect: 'headings',
      includeContext: true,
    });
    expect(headings.structuredContent).toEqual({ aspect: 'headings', path: 'a.md', headings: [] });
  });

});

describe('vault tools document shared args in inputSchema', () => {
  // Parameters are documented by each field's .describe() in inputSchema,
  // not by an Args section in the description (#388).
  function schemaFor(name: string): Record<string, { description?: string }> {
    const adapter = new MockObsidianAdapter();
    const tool = createVaultModule(adapter)
      .tools()
      .find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.schema as unknown as Record<string, { description?: string }>;
  }

  it('vault_list_recursive exposes described pagination fields', () => {
    const schema = schemaFor('vault_list_recursive');
    expect(schema.limit.description).toContain('Maximum items');
    expect(schema.offset.description).toContain('skip');
  });

  it('no tool takes responseFormat any more (#467)', () => {
    const adapter = new MockObsidianAdapter();
    for (const tool of createVaultModule(adapter).tools()) {
      expect(Object.keys(tool.schema), tool.name).not.toContain('responseFormat');
    }
  });
});

describe('vault_get_aspect dispatcher', () => {
  it('routes each aspect to the matching searchHandlers method', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'A line ^anchor\n');
    adapter.setMetadata('a.md', {
      frontmatter: { tag: 'x' },
      headings: [{ heading: 'H', level: 1 }],
      links: [{ link: 'b' }],
      embeds: [{ link: 'img.png', path: null }],
    });
    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });

    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const fm = await handlers.getAspect({ path: 'a.md', aspect: 'frontmatter' });
    expect(fm.structuredContent).toEqual({
      aspect: 'frontmatter',
      path: 'a.md',
      frontmatter: { tag: 'x' },
    });

    const headings = await handlers.getAspect({ path: 'a.md', aspect: 'headings' });
    expect(headings.structuredContent).toEqual({
      aspect: 'headings',
      path: 'a.md',
      headings: [{ heading: 'H', level: 1 }],
    });

    const out = await handlers.getAspect({ path: 'a.md', aspect: 'outgoing_links' });
    expect(out.structuredContent).toEqual({
      aspect: 'outgoing_links',
      path: 'a.md',
      links: [{ link: 'b', path: 'b.md' }],
    });

    const emb = await handlers.getAspect({ path: 'a.md', aspect: 'embeds' });
    expect(emb.structuredContent).toEqual({
      aspect: 'embeds',
      path: 'a.md',
      embeds: [{ link: 'img.png', path: null }],
    });

    const back = await handlers.getAspect({ path: 'a.md', aspect: 'backlinks' });
    expect(back.structuredContent).toEqual({
      aspect: 'backlinks',
      path: 'a.md',
      backlinks: ['b.md'],
      total: 1,
      hasMore: false,
    });

    const blocks = await handlers.getAspect({ path: 'a.md', aspect: 'block_references' });
    expect(blocks.structuredContent).toEqual({
      aspect: 'block_references',
      path: 'a.md',
      blockRefs: [{ id: 'anchor', text: 'A line ^anchor' }],
    });
  });

  it.each([
    'frontmatter',
    'headings',
    'outgoing_links',
    'embeds',
    'backlinks',
    'block_references',
  ] as const)('reports "File not found" for a missing path with aspect=%s (#447)', async (aspect) => {
    // Every aspect fails the same way on a mistyped path; backlinks used to
    // answer "no backlinks" instead (#447).
    const adapter = new MockObsidianAdapter();
    adapter.addFile('b.md', 'See [[missing]].');
    adapter.setMetadata('b.md', { links: [{ link: 'missing' }] });
    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const result = await handlers.getAspect({ path: 'missing.md', aspect });
    expect(result.isError).toBe(true);
    const block = result.content[0];
    expect(block.type === 'text' ? block.text : '').toContain('File not found: missing.md');
  });
});
