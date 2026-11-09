import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { App, TFile } from 'obsidian';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { RealObsidianAdapter } from '../../../src/obsidian/adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import { createVaultModule } from '../../../src/tools/vault/index';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  return item.type === 'text' ? item.text : '';
}

describe('vault_set_frontmatter handler (#407)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  it('sets keys, keeps other keys and the body', async () => {
    adapter.addFile('note.md', '---\ntitle: Note\nstatus: draft\n---\n# Body\n');
    const result = await handlers.setFrontmatter({
      path: 'note.md',
      set: { status: 'done', tags: ['a', 'b'], rating: 4, meta: { x: null } },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      path: 'note.md',
      frontmatter: {
        title: 'Note',
        status: 'done',
        tags: ['a', 'b'],
        rating: 4,
        meta: { x: null },
      },
      modified: expect.any(String) as unknown,
    });
    expect(getText(result)).toBe(
      'Updated frontmatter of note.md (set status, tags, rating, meta)',
    );
    const content = await adapter.readFile('note.md');
    expect(content.startsWith('---\ntitle: Note\nstatus: done\n')).toBe(true);
    expect(content.endsWith('---\n# Body\n')).toBe(true);
    expect(adapter.getFrontmatter('note.md')).toEqual({
      title: 'Note',
      status: 'done',
      tags: ['a', 'b'],
      rating: 4,
      meta: { x: null },
    });
  });

  it('removes keys and ignores keys that are absent', async () => {
    adapter.addFile('note.md', '---\ntitle: Note\ndraft: true\n---\nBody');
    const result = await handlers.setFrontmatter({
      path: 'note.md',
      set: {},
      remove: ['draft', 'missing'],
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      path: 'note.md',
      frontmatter: { title: 'Note' },
      modified: expect.any(String) as unknown,
    });
    expect(getText(result)).toContain('removed draft, missing');
    expect(await adapter.readFile('note.md')).toBe('---\ntitle: Note\n---\nBody');
  });

  it('creates the frontmatter block when the file has none', async () => {
    adapter.addFile('plain.md', '# Plain\n');
    const result = await handlers.setFrontmatter({ path: 'plain.md', set: { status: 'new' } });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      path: 'plain.md',
      frontmatter: { status: 'new' },
      modified: expect.any(String) as unknown,
    });
    expect(await adapter.readFile('plain.md')).toBe('---\nstatus: new\n---\n# Plain\n');
  });

  it('is idempotent: repeating the call gives the same file', async () => {
    adapter.addFile('note.md', '---\na: 1\n---\nBody');
    await handlers.setFrontmatter({ path: 'note.md', set: { b: 2 }, remove: ['a'] });
    const once = await adapter.readFile('note.md');
    await handlers.setFrontmatter({ path: 'note.md', set: { b: 2 }, remove: ['a'] });
    expect(await adapter.readFile('note.md')).toBe(once);
  });

  it('removing the last key drops the block and returns {}', async () => {
    adapter.addFile('note.md', '---\na: 1\n---\nBody');
    const result = await handlers.setFrontmatter({ path: 'note.md', set: {}, remove: ['a'] });
    expect(result.structuredContent).toEqual({
      path: 'note.md',
      frontmatter: {},
      modified: expect.any(String) as unknown,
    });
    expect(await adapter.readFile('note.md')).toBe('Body');
    expect(adapter.getFrontmatter('note.md')).toBeNull();
  });

  it('returns "File not found" for a missing file', async () => {
    const result = await handlers.setFrontmatter({ path: 'missing.md', set: { a: 1 } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('File not found');
  });

  describe('expectedMtime (#429)', () => {
    const MTIME = Date.UTC(2026, 0, 10, 8, 15, 0, 0);
    const MTIME_ISO = new Date(MTIME).toISOString();

    it('writes when expectedMtime matches and returns the new modified', async () => {
      adapter.addFile('note.md', '---\na: 1\n---\nBody', { mtime: MTIME });
      const result = await handlers.setFrontmatter({
        path: 'note.md',
        set: { b: 2 },
        expectedMtime: MTIME_ISO,
      });
      expect(result.isError).toBeUndefined();
      const stat = await adapter.stat('note.md');
      expect(result.structuredContent).toEqual({
        path: 'note.md',
        frontmatter: { a: 1, b: 2 },
        modified: new Date(stat!.mtime).toISOString(),
      });
    });

    it('accepts expectedMtime as epoch milliseconds', async () => {
      adapter.addFile('note.md', 'Body', { mtime: MTIME });
      const result = await handlers.setFrontmatter({
        path: 'note.md',
        set: { a: 1 },
        expectedMtime: String(MTIME),
      });
      expect(result.isError).toBeUndefined();
    });

    it('rejects a stale expectedMtime without writing', async () => {
      const content = '---\na: 1\n---\nBody';
      adapter.addFile('note.md', content, { mtime: MTIME });
      const result = await handlers.setFrontmatter({
        path: 'note.md',
        set: { a: 2 },
        expectedMtime: new Date(MTIME - 1000).toISOString(),
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('changed since');
      expect(getText(result)).toContain(MTIME_ISO);
      expect(await adapter.readFile('note.md')).toBe(content);
      expect((await adapter.stat('note.md'))!.mtime).toBe(MTIME);
    });

    it('reports File not found when expectedMtime is set on a missing file', async () => {
      const result = await handlers.setFrontmatter({
        path: 'missing.md',
        set: { a: 1 },
        expectedMtime: MTIME_ISO,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('File not found');
    });
  });

  it('rejects non-Markdown files', async () => {
    adapter.addFile('data.json', '{}');
    const result = await handlers.setFrontmatter({ path: 'data.json', set: { a: 1 } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Markdown (.md)');
  });

  it('rejects a key that is both set and removed', async () => {
    adapter.addFile('note.md', 'Body');
    const result = await handlers.setFrontmatter({
      path: 'note.md',
      set: { a: 1 },
      remove: ['a'],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Keys cannot be both set and removed: a');
    expect(await adapter.readFile('note.md')).toBe('Body');
  });

  it('rejects an empty change', async () => {
    adapter.addFile('note.md', 'Body');
    const result = await handlers.setFrontmatter({ path: 'note.md', set: {} });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Nothing to change');
  });

  it('rejects prototype keys', async () => {
    adapter.addFile('note.md', 'Body');
    const result = await handlers.setFrontmatter({
      path: 'note.md',
      set: {},
      remove: ['constructor'],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Invalid frontmatter key');
  });

  it('rejects path traversal', async () => {
    const result = await handlers.setFrontmatter({ path: '../x.md', set: { a: 1 } });
    expect(result.isError).toBe(true);
  });

  it('serialises concurrent calls on the same file', async () => {
    adapter.addFile('note.md', 'Body');
    await Promise.all([
      handlers.setFrontmatter({ path: 'note.md', set: { a: 1 } }),
      handlers.setFrontmatter({ path: 'note.md', set: { b: 2 } }),
    ]);
    expect(adapter.getFrontmatter('note.md')).toEqual({ a: 1, b: 2 });
  });
});

describe('MockObsidianAdapter.processFrontMatter', () => {
  it('falls back to metadata frontmatter when the content has no block', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('n.md', 'Body');
    adapter.setMetadata('n.md', { frontmatter: { from: 'metadata' }, tags: ['#t'] });
    await adapter.processFrontMatter('n.md', (fm) => {
      fm.extra = true;
    });
    expect(await adapter.readFile('n.md')).toBe('---\nfrom: metadata\nextra: true\n---\nBody');
    expect(adapter.getTags('n.md')).toEqual(['#t']);
  });

  it('treats an unterminated block as body text', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('n.md', '---\nnot closed');
    await adapter.processFrontMatter('n.md', (fm) => {
      fm.a = 1;
    });
    expect(await adapter.readFile('n.md')).toBe('---\na: 1\n---\n---\nnot closed');
  });

  it('handles an empty block', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('n.md', '---\n---\nBody');
    await adapter.processFrontMatter('n.md', (fm) => {
      fm.a = 'x';
    });
    expect(await adapter.readFile('n.md')).toBe('---\na: x\n---\nBody');
  });

  it('throws when the block is not a YAML mapping', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('n.md', '---\n- a\n- b\n---\nBody');
    await expect(adapter.processFrontMatter('n.md', () => undefined)).rejects.toThrow(
      'not a YAML mapping',
    );
  });

  it('throws for a missing file', async () => {
    const adapter = new MockObsidianAdapter();
    await expect(adapter.processFrontMatter('nope.md', () => undefined)).rejects.toThrow(
      'File not found',
    );
  });
});

describe('RealObsidianAdapter.processFrontMatter', () => {
  it('delegates to app.fileManager.processFrontMatter with the TFile', async () => {
    const file = new TFile();
    file.path = 'note.md';
    const processFrontMatter = vi.fn(
      (_file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> => {
        fn({});
        return Promise.resolve();
      },
    );
    const app = new App();
    (app as unknown as { vault: unknown }).vault = {
      getAbstractFileByPath: (path: string): TFile | null => (path === 'note.md' ? file : null),
    };
    (app as unknown as { fileManager: unknown }).fileManager = { processFrontMatter };
    const adapter = new RealObsidianAdapter(app);
    const fn = vi.fn();
    await adapter.processFrontMatter('note.md', fn);
    expect(processFrontMatter).toHaveBeenCalledWith(file, fn);
    expect(fn).toHaveBeenCalledWith({});
    await expect(adapter.processFrontMatter('missing.md', fn)).rejects.toThrow('File not found');
  });
});

describe('vault_set_frontmatter registration', () => {
  const tool = createVaultModule(new MockObsidianAdapter())
    .tools()
    .find((t) => t.name === 'vault_set_frontmatter');

  it('is registered with write, non-destructive, idempotent, closed-world annotations', () => {
    expect(tool).toBeDefined();
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('structuredContent parses against the declared outputSchema', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', 'Body');
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
    const result = await handlers.setFrontmatter({ path: 'note.md', set: { a: [1] } });
    const shape = tool?.outputSchema as z.ZodRawShape;
    expect(z.object(shape).strict().parse(result.structuredContent)).toEqual({
      path: 'note.md',
      frontmatter: { a: [1] },
      modified: expect.any(String) as unknown,
    });
  });
});
