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

  it('should register 19 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const tools = module.tools();
    expect(tools).toHaveLength(19);
  });

  it('should have 6 read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const readOnlyTools = module.tools().filter((t) => t.annotations.readOnlyHint);
    expect(readOnlyTools).toHaveLength(6);
  });

  it('should have 13 write tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const writeTools = module.tools().filter((t) => !t.annotations.readOnlyHint);
    expect(writeTools).toHaveLength(13);
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
      'vault_list',
      'vault_list_recursive',
      'vault_move',
      'vault_read',
      'vault_read_binary',
      'vault_rename',
      'vault_rename_folder',
      'vault_replace',
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

  it('vault_read declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_read');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('test.md', '# Hello', { mtime: 2000 });
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.readFile({
      path: 'test.md',
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed).toEqual({
      path: 'test.md',
      content: '# Hello',
      totalLength: 7,
      offset: 0,
      hasMore: false,
      modified: '1970-01-01T00:00:02.000Z',
    });
  });

  it('vault_get_metadata declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_get_metadata');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', 'hi', { ctime: 1000, mtime: 2000 });
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.getMetadata({
      path: 'note.md',
      responseFormat: 'json',
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
      responseFormat: 'json',
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
      responseFormat: 'json',
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
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent) as {
      hasMore: boolean;
      nextOffset?: number;
    };
    expect(parsed.hasMore).toBe(false);
    expect(parsed.nextOffset).toBeUndefined();
  });

  it('vault_read_binary declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_read_binary');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('img.png', '');
    await adapter.writeBinary('img.png', new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.readBinary({
      path: 'img.png',
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed).toEqual({
      path: 'img.png',
      data: '/9j/',
      encoding: 'base64',
      sizeBytes: 3,
    });
  });

  it('vault_read_binary plain-text rendering still returns the bare base64 string', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('img.png', '');
    await adapter.writeBinary('img.png', new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    // Default responseFormat ('markdown'); no callsite churn for existing
    // callers — the rendered text remains the bare base64 string.
    const result = await handlers.readBinary({ path: 'img.png' });
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('/9j/');
    }
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
          links: [{ link: 'b', displayText: 'Bee' }, { link: 'c' }],
        },
      },
      {
        aspect: 'embeds' as const,
        expected: { aspect: 'embeds', path: 'a.md', embeds: [{ link: 'image.png' }] },
      },
      {
        aspect: 'backlinks' as const,
        expected: { aspect: 'backlinks', path: 'a.md', backlinks: ['b.md'] },
      },
      {
        aspect: 'block_references' as const,
        expected: {
          aspect: 'block_references',
          path: 'a.md',
          blockRefs: [{ id: 'anchor', line: 'A line ^anchor' }],
        },
      },
    ];

    for (const { aspect, expected } of cases) {
      const result = await handlers.getAspect({
        path: 'a.md',
        aspect,
        responseFormat: 'json',
      });
      const parsed = schema.parse(result.structuredContent);
      expect(parsed).toEqual(expected);
    }
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

  it('vault_list_recursive exposes described pagination and responseFormat fields', () => {
    const schema = schemaFor('vault_list_recursive');
    expect(schema.limit.description).toContain('Maximum items');
    expect(schema.offset.description).toContain('skip');
    expect(schema.responseFormat.description).toContain('markdown');
  });

  it('read-only tools expose a described responseFormat field', () => {
    for (const name of ['vault_read', 'vault_get_metadata', 'vault_list']) {
      expect(schemaFor(name).responseFormat.description).toContain('markdown');
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
      embeds: [{ link: 'img.png' }],
    });
    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });

    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const fm = await handlers.getAspect({ path: 'a.md', aspect: 'frontmatter', responseFormat: 'json' });
    expect(fm.structuredContent).toEqual({
      aspect: 'frontmatter',
      path: 'a.md',
      frontmatter: { tag: 'x' },
    });

    const headings = await handlers.getAspect({ path: 'a.md', aspect: 'headings', responseFormat: 'json' });
    expect(headings.structuredContent).toEqual({
      aspect: 'headings',
      path: 'a.md',
      headings: [{ heading: 'H', level: 1 }],
    });

    const out = await handlers.getAspect({ path: 'a.md', aspect: 'outgoing_links', responseFormat: 'json' });
    expect(out.structuredContent).toEqual({
      aspect: 'outgoing_links',
      path: 'a.md',
      links: [{ link: 'b' }],
    });

    const emb = await handlers.getAspect({ path: 'a.md', aspect: 'embeds', responseFormat: 'json' });
    expect(emb.structuredContent).toEqual({
      aspect: 'embeds',
      path: 'a.md',
      embeds: [{ link: 'img.png' }],
    });

    const back = await handlers.getAspect({ path: 'a.md', aspect: 'backlinks', responseFormat: 'json' });
    expect(back.structuredContent).toEqual({
      aspect: 'backlinks',
      path: 'a.md',
      backlinks: ['b.md'],
    });

    const blocks = await handlers.getAspect({ path: 'a.md', aspect: 'block_references', responseFormat: 'json' });
    expect(blocks.structuredContent).toEqual({
      aspect: 'block_references',
      path: 'a.md',
      blockRefs: [{ id: 'anchor', line: 'A line ^anchor' }],
    });
  });

  it('propagates underlying handler errors unchanged (block_references on missing file)', async () => {
    // Of the six underlying searchHandlers methods, only
    // `searchBlockReferences` actually errors on a missing file (it reads
    // the body via `getFileContent`). The other five degrade silently to
    // empty/default payloads — that's the existing contract this PR is
    // explicitly not changing. So this test pins the dispatcher's
    // "errors flow through unchanged" property using the only aspect
    // that produces an error in the first place.
    const adapter = new MockObsidianAdapter();
    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const result = await handlers.getAspect({
      path: 'missing.md',
      aspect: 'block_references',
    });
    expect(result.isError).toBe(true);
    const block = result.content[0];
    if (block.type === 'text') {
      expect(block.text.toLowerCase()).toMatch(/not found|does not exist/);
    }
  });
});
