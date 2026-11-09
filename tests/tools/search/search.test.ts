import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ToolContext } from '../../../src/registry/tool-context';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import { CHARACTER_LIMIT } from '../../../src/constants';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createSearchHandlers, type SearchHandlers } from '../../../src/tools/search/handlers';
import { createSearchModule } from '../../../src/tools/search/index';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
}

function makeCtx(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    signal: new AbortController().signal,
    progressToken: undefined,
    reportProgress: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('search module', () => {
  it('should have correct metadata', () => {
    const adapter = new MockObsidianAdapter();
    const module = createSearchModule(adapter);
    expect(module.metadata.id).toBe('search');
  });

  it('should register 6 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createSearchModule(adapter);
    expect(module.tools()).toHaveLength(6);
  });

  it('should have all read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createSearchModule(adapter);
    const allReadOnly = module.tools().every((t) => t.annotations.readOnlyHint);
    expect(allReadOnly).toBe(true);
  });
});

describe('search handlers', () => {
  let adapter: MockObsidianAdapter;
  let handlers: SearchHandlers;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createSearchHandlers(adapter);
  });

  describe('searchFulltext', () => {
    it('returns paginated results in json format', async () => {
      adapter.addFile('notes/a.md', 'Hello World');
      adapter.addFile('notes/b.md', 'Goodbye World');
      adapter.addFile('notes/c.md', 'Nothing here');
      const result = await handlers.searchFulltext({
        query: 'World',
        responseFormat: 'json',
      });
      const page = JSON.parse(getText(result)) as {
        total: number;
        count: number;
        items: Array<{ path: string }>;
      };
      expect(page.total).toBe(2);
      expect(page.count).toBe(2);
      expect(page.items).toHaveLength(2);
      expect(result.structuredContent).toMatchObject({ total: 2 });
    });

    it('renders markdown by default and always attaches structuredContent', async () => {
      adapter.addFile('test.md', 'Hello WORLD');
      const result = await handlers.searchFulltext({ query: 'world' });
      expect(getText(result)).toContain('**1 result**');
      expect(getText(result)).toContain('test.md');
      expect(result.structuredContent).toMatchObject({ total: 1 });
    });

    it('returns fewer files instead of cutting the json text (#464)', async () => {
      const bigMatches = Array.from({ length: 200 }, (_, i) => `match ${String(i)}`).join(
        '\n',
      );
      for (let f = 0; f < 50; f++) adapter.addFile(`big-${String(f)}.md`, bigMatches);
      const result = await handlers.searchFulltext({
        query: 'match',
        responseFormat: 'json',
        limit: 100,
        maxMatchesPerFile: 100,
      });
      const text = getText(result);
      expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
      expect(text).not.toContain('[TRUNCATED:');
      const page = JSON.parse(text) as { count: number; hasMore: boolean; nextOffset: number };
      expect(page).toEqual(result.structuredContent);
      expect(page.count).toBeLessThan(50);
      expect(page.hasMore).toBe(true);
      expect(page.nextOffset).toBe(page.count);
    });

    it('caps matches per file at 5 by default and reports the real matchCount (#388)', async () => {
      const lines = Array.from({ length: 2000 }, (_, i) => `hit ${String(i)}`).join('\n');
      adapter.addFile('many.md', lines);
      adapter.addFile('one.md', 'a single hit');
      const result = await handlers.searchFulltext({ query: 'hit' });
      const page = result.structuredContent as {
        items: Array<{ path: string; matches: string[]; matchCount: number }>;
      };
      const many = page.items.find((i) => i.path === 'many.md');
      const one = page.items.find((i) => i.path === 'one.md');
      expect(many?.matches).toEqual(['hit 0', 'hit 1', 'hit 2', 'hit 3', 'hit 4']);
      expect(many?.matchCount).toBe(2000);
      expect(one?.matches).toEqual(['a single hit']);
      expect(one?.matchCount).toBe(1);
      expect(getText(result)).toContain('many.md (2000 matches)');
    });

    it('shows the matching lines with line numbers in markdown (#463)', async () => {
      adapter.addFile('projects/Atlas.md', '# Atlas\nno\nthe atlas launch\r\nother');
      const result = await handlers.searchFulltext({ query: 'atlas' });
      expect(getText(result)).toBe(
        '**1 result**\n\n- projects/Atlas.md (2 matches)\n  - 1: # Atlas\n  - 3: the atlas launch',
      );
      // structuredContent keeps its shape: plain lines, no numbers.
      expect(result.structuredContent).toMatchObject({
        items: [{ path: 'projects/Atlas.md', matches: ['# Atlas', 'the atlas launch\r'], matchCount: 2 }],
      });
    });

    it('says how many matching lines the markdown left out (#463)', async () => {
      const lines = Array.from({ length: 8 }, (_, i) => `hit ${String(i)}`).join('\n');
      adapter.addFile('many.md', lines);
      const text = getText(await handlers.searchFulltext({ query: 'hit', maxMatchesPerFile: 2 }));
      expect(text).toContain('- many.md (8 matches)\n  - 1: hit 0\n  - 2: hit 1\n  - … 6 more');
      expect(text).not.toContain('hit 2');
    });

    it('cuts long matching lines at 200 characters in markdown (#463)', async () => {
      const long = `needle ${'x'.repeat(300)}`;
      adapter.addFile('long.md', long);
      const result = await handlers.searchFulltext({ query: 'needle' });
      expect(getText(result)).toContain(`  - 1: ${long.slice(0, 200)}…`);
      expect(getText(result)).not.toContain(long);
      const page = result.structuredContent as { items: Array<{ matches: string[] }> };
      expect(page.items[0].matches[0]).toBe(long);
    });

    it('honours maxMatchesPerFile', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `hit ${String(i)}`).join('\n');
      adapter.addFile('many.md', lines);
      const result = await handlers.searchFulltext({ query: 'hit', maxMatchesPerFile: 20 });
      const page = result.structuredContent as {
        items: Array<{ matches: string[]; matchCount: number }>;
      };
      expect(page.items[0].matches).toHaveLength(20);
      expect(page.items[0].matchCount).toBe(50);
    });

    it('rejects maxMatchesPerFile outside 1..100 at the schema level', () => {
      const tool = createSearchModule(adapter)
        .tools()
        .find((t) => t.name === 'search_fulltext');
      const schema = z.object(tool!.schema);
      expect(schema.safeParse({ query: 'x', maxMatchesPerFile: 0 }).success).toBe(false);
      expect(schema.safeParse({ query: 'x', maxMatchesPerFile: 101 }).success).toBe(false);
      expect(schema.parse({ query: 'x' })).toMatchObject({ maxMatchesPerFile: 5 });
    });

    it('returns an error envelope when signal is already aborted at invocation', async () => {
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');
      const readSpy = vi.spyOn(adapter, 'readFile');

      const ac = new AbortController();
      ac.abort();
      const ctx = makeCtx({ signal: ac.signal });

      const result = await handlers.searchFulltext({ query: 'x' }, ctx);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Cancelled');
      expect(readSpy).not.toHaveBeenCalled();
    });

    it('stops reading remaining files when signal is aborted mid-run', async () => {
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');
      adapter.addFile('c.md', 'x');
      adapter.addFile('d.md', 'x');
      adapter.addFile('e.md', 'x');

      const ac = new AbortController();
      // Capture the real method BEFORE installing the spy, so the
      // mockImplementation can delegate back to it.
      const realReadFile = adapter.readFile.bind(adapter);
      const readSpy = vi.spyOn(adapter, 'readFile');
      let count = 0;
      readSpy.mockImplementation(async (path: string) => {
        count++;
        if (count === 2) ac.abort();
        return realReadFile(path);
      });

      const ctx = makeCtx({ signal: ac.signal });
      const result = await handlers.searchFulltext({ query: 'x' }, ctx);

      expect(result.isError).toBe(true);
      // Two files read before the abort fires the next iteration's check.
      expect(readSpy).toHaveBeenCalledTimes(2);
    });

    it('emits progress at integer-percent boundaries when progressToken is set', async () => {
      // 4 files → percent boundaries at 25, 50, 75, 100.
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');
      adapter.addFile('c.md', 'x');
      adapter.addFile('d.md', 'x');

      const reportProgress = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({
        progressToken: 'tok',
        reportProgress,
      });

      await handlers.searchFulltext({ query: 'x' }, ctx);

      expect(reportProgress).toHaveBeenCalledTimes(4);
      // Final call should report progress === total.
      const lastCall = reportProgress.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe(4);
      expect(lastCall?.[1]).toBe(4);
    });

    it('still calls reportProgress when progressToken is undefined (the no-op path)', async () => {
      // The handler should not branch on progressToken — that gating lives
      // inside ctx.reportProgress. The handler always invokes it; the
      // no-op behaviour is the wrapper's responsibility (covered in
      // tests/registry/tool-context.test.ts).
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');

      const reportProgress = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({ reportProgress });

      await handlers.searchFulltext({ query: 'x' }, ctx);

      // Two files, both percent-boundaries (50, 100), so two emits.
      // Pinning the count guards against a future regression that
      // branches on progressToken and skips the call entirely.
      expect(reportProgress).toHaveBeenCalledTimes(2);
    });

    it('still works when called with no ctx (backwards-compat path)', async () => {
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'y');
      const result = await handlers.searchFulltext({ query: 'x' });
      expect(result.isError).toBeFalsy();
      expect(getText(result)).toContain('a.md');
    });
  });

  describe('searchFrontmatter', () => {
    it('should return frontmatter for a file (json)', async () => {
      adapter.addFile('test.md', 'content');
      adapter.setMetadata('test.md', { frontmatter: { title: 'My Note', tags: ['project'] } });
      const result = await handlers.searchFrontmatter({
        path: 'test.md',
        responseFormat: 'json',
      });
      const data = JSON.parse(getText(result)) as {
        path: string;
        frontmatter: Record<string, unknown>;
      };
      expect(data.frontmatter.title).toBe('My Note');
      expect(result.structuredContent).toMatchObject({ path: 'test.md' });
    });

    it('renders markdown when no frontmatter', async () => {
      adapter.addFile('test.md', 'content');
      const result = await handlers.searchFrontmatter({ path: 'test.md' });
      expect(getText(result)).toContain('test.md');
    });
  });

  describe('searchTags', () => {
    it('should return all tags with file associations (json)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#work'] });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#project'] });
      const result = await handlers.searchTags({ responseFormat: 'json' });
      const data = JSON.parse(getText(result)) as { tags: Record<string, string[]> };
      expect(data.tags['#project']).toHaveLength(2);
      expect(data.tags['#work']).toHaveLength(1);
    });

    it('lists a file once per tag and counts every occurrence (#431)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#work', '#project'] });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#project'] });
      const result = await handlers.searchTags({ responseFormat: 'json' });
      const data = JSON.parse(getText(result)) as {
        tags: Record<string, string[]>;
        counts: Record<string, number>;
      };
      expect(data.tags['#project']).toEqual(['a.md', 'b.md']);
      expect(data.counts).toEqual({ '#project': 3, '#work': 1 });
    });

    it('search_by_tag lists a file with a repeated tag once (#431)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#project'] });
      const result = await handlers.searchByTag({ tag: 'project', responseFormat: 'json' });
      const data = JSON.parse(getText(result)) as { items: string[]; total: number };
      expect(data.items).toEqual(['a.md']);
      expect(data.total).toBe(1);
    });

    it('includes frontmatter tags and counts every occurrence (#440)', async () => {
      adapter.addFile('fm.md', 'content');
      adapter.setMetadata('fm.md', { frontmatter: { tags: ['Project', 'area/work'] } });
      adapter.addFile('mixed.md', 'content');
      adapter.setMetadata('mixed.md', {
        frontmatter: { tag: '#Project' },
        tags: ['#Project', '#inline'],
      });
      const result = await handlers.searchTags({ responseFormat: 'json' });
      const data = JSON.parse(getText(result)) as {
        tags: Record<string, string[]>;
        counts: Record<string, number>;
      };
      expect(data.tags).toEqual({
        '#Project': ['fm.md', 'mixed.md'],
        '#area/work': ['fm.md'],
        '#inline': ['mixed.md'],
      });
      expect(data.counts).toEqual({ '#Project': 3, '#area/work': 1, '#inline': 1 });
    });
  });

  describe('searchHeadings', () => {
    it('should return headings for a file (json)', async () => {
      adapter.addFile('test.md', '# Title\n## Subtitle');
      adapter.setMetadata('test.md', {
        headings: [
          { heading: 'Title', level: 1 },
          { heading: 'Subtitle', level: 2 },
        ],
      });
      const result = await handlers.searchHeadings({
        path: 'test.md',
        responseFormat: 'json',
      });
      const data = JSON.parse(getText(result)) as {
        headings: Array<{ heading: string; level: number }>;
      };
      expect(data.headings).toHaveLength(2);
      expect(data.headings[0].heading).toBe('Title');
    });
  });

  describe('searchOutgoingLinks', () => {
    it('should return links for a file (json)', async () => {
      adapter.addFile('test.md', 'content');
      adapter.setMetadata('test.md', {
        links: [{ link: 'other.md', displayText: 'Other' }],
      });
      const result = await handlers.searchOutgoingLinks({
        path: 'test.md',
        responseFormat: 'json',
      });
      const data = JSON.parse(getText(result)) as {
        links: Array<{ link: string }>;
      };
      expect(data.links).toHaveLength(1);
      expect(data.links[0].link).toBe('other.md');
    });
  });

  describe('searchBacklinks', () => {
    it('should return files linking to the target (json)', async () => {
      adapter.addFile('source.md', 'links to target');
      adapter.setMetadata('source.md', {
        links: [{ link: 'target.md' }],
      });
      adapter.addFile('target.md', 'target content');
      const result = await handlers.searchBacklinks({
        path: 'target.md',
        responseFormat: 'json',
      });
      const data = JSON.parse(getText(result)) as { backlinks: string[] };
      expect(data.backlinks).toContain('source.md');
    });

    it.each([false, true])(
      'reports "File not found" for a missing path, includeContext=%s (#447)',
      async (includeContext) => {
        adapter.addFile('source.md', 'See [[target]].');
        adapter.setMetadata('source.md', { links: [{ link: 'target' }] });
        const result = await handlers.searchBacklinks({ path: 'target.md', includeContext });
        expect(result.isError).toBe(true);
        expect(getText(result)).toContain('File not found: target.md');
      },
    );

    it('leaves the payload unchanged without includeContext (#408)', async () => {
      adapter.addFile('source.md', 'See [[target]].');
      adapter.setMetadata('source.md', { links: [{ link: 'target' }] });
      adapter.addFile('target.md', 'x');
      const result = await handlers.searchBacklinks({ path: 'target.md' });
      expect(result.structuredContent).toEqual({ path: 'target.md', backlinks: ['source.md'] });
    });

    it('adds line numbers and line text with includeContext (#408)', async () => {
      adapter.addFile(
        'source.md',
        '# Source\n\nFirst [[target]] mention.\nnothing here\n- again ![[target#Part|alias]]\n',
      );
      adapter.setMetadata('source.md', { links: [{ link: 'target' }] });
      adapter.addFile('other.md', 'Only [[target.md|t]]');
      adapter.setMetadata('other.md', { links: [{ link: 'target.md' }] });
      adapter.addFile('target.md', 'x');

      const result = await handlers.searchBacklinks({
        path: 'target.md',
        includeContext: true,
        responseFormat: 'json',
      });
      expect(result.structuredContent).toEqual({
        path: 'target.md',
        backlinks: ['source.md', 'other.md'],
        backlinkContext: [
          {
            path: 'source.md',
            matches: [
              { line: 3, text: 'First [[target]] mention.' },
              { line: 5, text: '- again ![[target#Part|alias]]' },
            ],
          },
          { path: 'other.md', matches: [{ line: 1, text: 'Only [[target.md|t]]' }] },
        ],
      });
    });

    it('renders context lines in markdown (#408)', async () => {
      adapter.addFile('source.md', 'intro\nSee [[target]] here');
      adapter.setMetadata('source.md', { links: [{ link: 'target' }] });
      adapter.addFile('target.md', 'x');
      const result = await handlers.searchBacklinks({ path: 'target.md', includeContext: true });
      const text = getText(result);
      expect(text).toContain('- source.md');
      expect(text).toContain('  - L2: See [[target]] here');
    });

    it('keeps a backlink with no positioned link as an empty match list (#408)', async () => {
      // metadata says source links to target, but the body has no [[...]]
      // (e.g. a frontmatter link, which has no line position).
      adapter.addFile('source.md', 'no wikilink in body');
      adapter.setMetadata('source.md', { links: [{ link: 'target' }] });
      adapter.addFile('target.md', 'x');
      const result = await handlers.searchBacklinks({ path: 'target.md', includeContext: true });
      expect(result.structuredContent).toMatchObject({
        backlinkContext: [{ path: 'source.md', matches: [] }],
      });
      expect(getText(result)).toContain('- source.md');
    });
  });

  describe('searchByTag', () => {
    it('should find files by tag (json)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#personal'] });
      const result = await handlers.searchByTag({
        tag: '#project',
        responseFormat: 'json',
      });
      const page = JSON.parse(getText(result)) as { items: string[] };
      expect(page.items).toEqual(['a.md']);
    });

    it('should handle tag without # prefix', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      const result = await handlers.searchByTag({
        tag: 'project',
        responseFormat: 'json',
      });
      const page = JSON.parse(getText(result)) as { items: string[] };
      expect(page.items).toEqual(['a.md']);
    });

    it('finds notes tagged only in frontmatter (#440)', async () => {
      adapter.addFile('list.md', 'content');
      adapter.setMetadata('list.md', { frontmatter: { tags: ['Project'] } });
      adapter.addFile('string.md', 'content');
      adapter.setMetadata('string.md', { frontmatter: { tags: 'other, #Project' } });
      adapter.addFile('both.md', 'content');
      adapter.setMetadata('both.md', {
        frontmatter: { tags: ['Project'] },
        tags: ['#Project'],
      });
      adapter.addFile('none.md', 'content');
      adapter.setMetadata('none.md', { frontmatter: { title: 'Project' } });
      const result = await handlers.searchByTag({ tag: 'Project', responseFormat: 'json' });
      const page = JSON.parse(getText(result)) as { items: string[]; total: number };
      expect(page.items).toEqual(['list.md', 'string.md', 'both.md']);
      expect(page.total).toBe(3);
    });
  });

  describe('searchByFrontmatter', () => {
    it('should find files by frontmatter value (json)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { frontmatter: { status: 'draft' } });
      const result = await handlers.searchByFrontmatter({
        key: 'status',
        value: 'done',
        responseFormat: 'json',
      });
      const page = JSON.parse(getText(result)) as { items: string[] };
      expect(page.items).toEqual(['a.md']);
    });

    it('matches every file that has the key when value is omitted (#388)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { frontmatter: { status: '' } });
      adapter.addFile('c.md', 'content');
      adapter.setMetadata('c.md', { frontmatter: { title: 'no status' } });
      adapter.addFile('d.md', 'no frontmatter');
      const result = await handlers.searchByFrontmatter({ key: 'status' });
      const page = result.structuredContent as { items: string[] };
      expect(page.items.sort()).toEqual(['a.md', 'b.md']);
      expect(getText(result)).toContain('with status');
    });

    it('still compares the value when it is given, including an empty string', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { frontmatter: { status: '' } });
      const result = await handlers.searchByFrontmatter({ key: 'status', value: '' });
      const page = result.structuredContent as { items: string[] };
      expect(page.items).toEqual(['b.md']);
    });

    it('matches a list property when any element equals the value (#405)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { tags: ['alpha', 'beta'] } });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { frontmatter: { tags: ['beta'] } });
      adapter.addFile('c.md', 'content');
      adapter.setMetadata('c.md', { frontmatter: { tags: 'alpha,beta' } });
      adapter.addFile('d.md', 'content');
      adapter.setMetadata('d.md', { frontmatter: { tags: [1, 'gamma'] } });

      const alpha = await handlers.searchByFrontmatter({ key: 'tags', value: 'alpha' });
      expect((alpha.structuredContent as { items: string[] }).items).toEqual(['a.md']);

      const beta = await handlers.searchByFrontmatter({ key: 'tags', value: 'beta' });
      expect((beta.structuredContent as { items: string[] }).items.sort()).toEqual(['a.md', 'b.md']);

      const joined = await handlers.searchByFrontmatter({ key: 'tags', value: 'alpha,beta' });
      expect((joined.structuredContent as { items: string[] }).items).toEqual(['c.md']);

      const numeric = await handlers.searchByFrontmatter({ key: 'tags', value: '1' });
      expect((numeric.structuredContent as { items: string[] }).items).toEqual(['d.md']);
    });
  });

  describe('markdown rendering (default format)', () => {
    it('searchFrontmatter renders the property list', async () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { frontmatter: { title: 'T', status: 'done' } });
      const result = await handlers.searchFrontmatter({ path: 'a.md' });
      expect(getText(result)).toContain('**a.md** frontmatter');
      expect(getText(result)).toContain('**title**: T');
    });

    it('searchTags renders tag counts', async () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { tags: ['#foo', '#bar'] });
      const result = await handlers.searchTags({});
      expect(getText(result)).toContain('**#foo**');
    });

    it('searchTags renders file and occurrence counts', async () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { tags: ['#foo', '#foo'] });
      adapter.addFile('b.md', 'x');
      adapter.setMetadata('b.md', { tags: ['#foo', '#bar'] });
      const result = await handlers.searchTags({});
      expect(getText(result)).toContain('- **#foo** — 2 files, 3 occurrences');
      expect(getText(result)).toContain('- **#bar** — 1 file, 1 occurrence');
    });

    it('searchHeadings renders as a nested outline', async () => {
      adapter.addFile('a.md', '# h1\n## h2');
      adapter.setMetadata('a.md', {
        headings: [
          { heading: 'h1', level: 1 },
          { heading: 'h2', level: 2 },
        ],
      });
      const result = await handlers.searchHeadings({ path: 'a.md' });
      expect(getText(result)).toContain('# h1');
      expect(getText(result)).toContain('## h2');
    });

    it('searchBacklinks renders a bullet list of sources', async () => {
      adapter.addFile('src.md', 'x');
      adapter.setMetadata('src.md', { links: [{ link: 'target.md' }] });
      adapter.addFile('target.md', 'x');
      const result = await handlers.searchBacklinks({ path: 'target.md' });
      expect(getText(result)).toContain('src.md');
    });

    it('searchByTag renders the paginated envelope in markdown', async () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      const result = await handlers.searchByTag({ tag: 'project' });
      expect(getText(result)).toContain('**1 file tagged #project**');
      expect(getText(result)).toContain('- a.md');
    });

    it('searchByTag pluralises the noun, not the tag (#463)', async () => {
      for (const p of ['a.md', 'b.md', 'c.md']) {
        adapter.addFile(p, 'x');
        adapter.setMetadata(p, { tags: ['#project'] });
      }
      const result = await handlers.searchByTag({ tag: 'project' });
      expect(getText(result)).toContain('**3 files tagged #project**');
      expect(getText(result)).not.toContain('#projects');
    });

    it('searchByTag with no match says "0 files" and keeps the tag', async () => {
      const result = await handlers.searchByTag({ tag: 'project' });
      expect(getText(result)).toContain('**0 files tagged #project**');
    });

    it('searchByFrontmatter keeps key=value verbatim for one result (#463)', async () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { frontmatter: { status: 'active' } });
      const result = await handlers.searchByFrontmatter({ key: 'status', value: 'active' });
      expect(getText(result)).toContain('**1 file with status=active**');
    });

    it('searchByFrontmatter pluralises the noun, not the value (#463)', async () => {
      for (const p of ['a.md', 'b.md']) {
        adapter.addFile(p, 'x');
        adapter.setMetadata(p, { frontmatter: { status: 'active' } });
      }
      const result = await handlers.searchByFrontmatter({ key: 'status', value: 'active' });
      expect(getText(result)).toContain('**2 files with status=active**');
      expect(getText(result)).not.toContain('actives');
    });

    it('searchByFrontmatter without a value pluralises the noun only', async () => {
      for (const p of ['a.md', 'b.md']) {
        adapter.addFile(p, 'x');
        adapter.setMetadata(p, { frontmatter: { status: 'x' } });
      }
      const result = await handlers.searchByFrontmatter({ key: 'status' });
      expect(getText(result)).toContain('**2 files with status**');
    });
  });

  describe('searchBlockReferences', () => {
    it('should find block references (json)', async () => {
      adapter.addFile('test.md', 'Some content ^block-1\nMore text\nAnother block ^ref-2');
      const result = await handlers.searchBlockReferences({
        path: 'test.md',
        responseFormat: 'json',
      });
      const data = JSON.parse(getText(result)) as {
        blockRefs: Array<{ id: string }>;
      };
      expect(data.blockRefs).toHaveLength(2);
      expect(data.blockRefs[0].id).toBe('block-1');
      expect(data.blockRefs[1].id).toBe('ref-2');
    });
  });
});

describe('search tools document shared args in inputSchema', () => {
  // Parameters are documented by each field's .describe() in inputSchema,
  // not by an Args section in the description (#388).
  function schemaFor(name: string): Record<string, { description?: string }> {
    const adapter = new MockObsidianAdapter();
    const tool = createSearchModule(adapter)
      .tools()
      .find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.schema as unknown as Record<string, { description?: string }>;
  }

  it('paginated search tools expose described limit, offset and responseFormat', () => {
    for (const name of ['search_fulltext', 'search_by_tag', 'search_by_frontmatter']) {
      const schema = schemaFor(name);
      expect(schema.limit.description, name).toContain('Maximum items');
      expect(schema.offset.description, name).toContain('skip');
      expect(schema.responseFormat.description, name).toContain('json');
    }
  });

  it('map-style search tools expose only responseFormat', () => {
    for (const name of [
      'search_tags',
      'search_resolved_links',
      'search_unresolved_links',
    ]) {
      const schema = schemaFor(name);
      expect(Object.keys(schema)).toEqual(['responseFormat']);
    }
  });
});

/**
 * Batch B of #248: every search tool that emits `structuredContent` must
 * declare an `outputSchema`, and that schema must accurately describe the
 * payload the handler produces. Strict-mode parsing catches drift between
 * the markdown renderer and the structured payload.
 */
describe('search read tools — outputSchema declarations', () => {
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
    const module = createSearchModule(adapter);
    const tool = module.tools().find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not found`);
    return tool;
  }

  it('search_fulltext declares outputSchema and parses with hasMore=false', async () => {
    const tool = findTool('search_fulltext');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'Hello World');
    adapter.addFile('b.md', 'Goodbye World');
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchFulltext({
      query: 'World',
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(2);
    expect(parsed.count).toBe(2);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.nextOffset).toBeUndefined();
    expect(parsed.items).toHaveLength(2);
  });

  it('search_fulltext parses with hasMore=true and nextOffset', async () => {
    const tool = findTool('search_fulltext');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    for (let i = 0; i < 5; i++) {
      adapter.addFile(`f-${String(i)}.md`, 'World');
    }
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchFulltext({
      query: 'World',
      limit: 2,
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextOffset).toBe(2);
  });

  it('search_tags declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_tags');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { tags: ['#project'] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchTags({ responseFormat: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.tags).toEqual({ '#project': ['a.md'] });
    expect(parsed.counts).toEqual({ '#project': 1 });
  });

  it('search_resolved_links declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_resolved_links');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.addFile('b.md', '');
    adapter.setMetadata('a.md', { links: [{ link: 'b' }] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchResolvedLinks({
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.links).toEqual({ 'a.md': { 'b.md': 1 } });
  });

  it('search_unresolved_links declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_unresolved_links');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { links: [{ link: 'missing' }] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchUnresolvedLinks({
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.links).toEqual({ 'a.md': { missing: 1 } });
  });

  it('search_by_tag declares outputSchema and parses with hasMore=false', async () => {
    const tool = findTool('search_by_tag');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { tags: ['#project'] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByTag({
      tag: 'project',
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.nextOffset).toBeUndefined();
    expect(parsed.items).toEqual(['a.md']);
  });

  it('search_by_tag parses with hasMore=true and nextOffset', async () => {
    const tool = findTool('search_by_tag');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    for (let i = 0; i < 5; i++) {
      adapter.addFile(`f-${String(i)}.md`, '');
      adapter.setMetadata(`f-${String(i)}.md`, { tags: ['#project'] });
    }
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByTag({
      tag: 'project',
      limit: 2,
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextOffset).toBe(2);
  });

  it('search_by_frontmatter declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_by_frontmatter');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByFrontmatter({
      key: 'status',
      value: 'done',
      responseFormat: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.items).toEqual(['a.md']);
  });
});
