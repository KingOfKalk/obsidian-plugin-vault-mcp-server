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

  it('should register 7 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createSearchModule(adapter);
    expect(module.tools()).toHaveLength(7);
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

    it('returns the page as compact JSON text and structuredContent (#467)', async () => {
      adapter.addFile('test.md', 'Hello WORLD');
      const result = await handlers.searchFulltext({ query: 'world' });
      expect(getText(result)).toBe(
        '{"total":1,"count":1,"offset":0,"items":[{"path":"test.md","matches":["Hello WORLD"],"lines":[1],"matchCount":1}],"hasMore":false}',
      );
      expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
    });

    it('returns fewer files instead of cutting the json text (#464)', async () => {
      const bigMatches = Array.from({ length: 200 }, (_, i) => `match ${String(i)}`).join(
        '\n',
      );
      for (let f = 0; f < 50; f++) adapter.addFile(`big-${String(f)}.md`, bigMatches);
      const result = await handlers.searchFulltext({
        query: 'match',
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
    });

    it('returns the matching lines with their 1-based line numbers (#463, #467)', async () => {
      adapter.addFile('projects/Atlas.md', '# Atlas\nno\nthe atlas launch\r\nother');
      const result = await handlers.searchFulltext({ query: 'atlas' });
      expect(result.structuredContent).toMatchObject({
        items: [
          {
            path: 'projects/Atlas.md',
            matches: ['# Atlas', 'the atlas launch'],
            lines: [1, 3],
            matchCount: 2,
          },
        ],
      });
    });

    it('keeps long matching lines whole', async () => {
      const long = `needle ${'x'.repeat(300)}`;
      adapter.addFile('long.md', long);
      const result = await handlers.searchFulltext({ query: 'needle' });
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

    it('returns the last matches with lastMatches, in line order (#504)', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `hit ${String(i)}`).join('\n');
      adapter.addFile('ledger.md', lines);
      const result = await handlers.searchFulltext({
        query: 'hit',
        maxMatchesPerFile: 3,
        lastMatches: true,
      });
      const page = result.structuredContent as {
        items: Array<{ matches: string[]; lines: number[]; matchCount: number }>;
      };
      expect(page.items[0]).toEqual({
        path: 'ledger.md',
        matches: ['hit 47', 'hit 48', 'hit 49'],
        lines: [48, 49, 50],
        matchCount: 50,
      });
    });

    it('returns all matches with lastMatches when there are fewer than the cap (#504)', async () => {
      adapter.addFile('a.md', 'hit one\nno\nhit two');
      const result = await handlers.searchFulltext({ query: 'hit', lastMatches: true });
      expect(result.structuredContent).toMatchObject({
        items: [{ path: 'a.md', matches: ['hit one', 'hit two'], lines: [1, 3], matchCount: 2 }],
      });
    });

    describe('folder (#504)', () => {
      beforeEach(() => {
        adapter.addFile('projects/a.md', 'needle');
        adapter.addFile('projects/sub/b.md', 'needle');
        adapter.addFile('projects-old/c.md', 'needle');
        adapter.addFile('d.md', 'needle');
      });

      async function pathsFor(folder?: string): Promise<string[]> {
        const result = await handlers.searchFulltext({ query: 'needle', folder });
        expect(result.isError, getText(result)).toBeUndefined();
        return (result.structuredContent as { items: Array<{ path: string }> }).items
          .map((i) => i.path)
          .sort();
      }

      it('limits the search to a folder and its subfolders', async () => {
        expect(await pathsFor('projects')).toEqual(['projects/a.md', 'projects/sub/b.md']);
        expect(await pathsFor('projects/sub')).toEqual(['projects/sub/b.md']);
      });

      it('treats "", "/" and "." as the whole vault', async () => {
        for (const folder of ['', '/', '.']) {
          expect(await pathsFor(folder), folder).toHaveLength(4);
        }
      });

      it('fails for a folder that does not exist', async () => {
        const result = await handlers.searchFulltext({ query: 'needle', folder: 'missing' });
        expect(result.isError).toBe(true);
        expect(getText(result)).toContain('missing');
      });

      it('rejects the config folder and paths outside the vault', async () => {
        for (const folder of ['.obsidian', '../outside']) {
          const result = await handlers.searchFulltext({ query: 'needle', folder });
          expect(result.isError, folder).toBe(true);
        }
      });
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
    interface TagsPage {
      tags: Record<string, { files: number; occurrences: number }>;
      total: number;
      count: number;
      offset: number;
      hasMore: boolean;
      nextOffset?: number;
    }

    function tagsOf(result: CallToolResult): TagsPage {
      const data = JSON.parse(getText(result)) as TagsPage;
      expect(data).toEqual(result.structuredContent);
      return data;
    }

    it('returns the number of files and occurrences per tag, no file list (#468)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#work'] });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#project'] });
      const data = tagsOf(await handlers.searchTags({}));
      expect(data).toEqual({
        tags: {
          '#project': { files: 2, occurrences: 2 },
          '#work': { files: 1, occurrences: 1 },
        },
        total: 2,
        count: 2,
        offset: 0,
        hasMore: false,
      });
      expect(getText(await handlers.searchTags({}))).not.toContain('a.md');
    });

    it('counts a file once per tag and every occurrence (#431)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#work', '#project'] });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#project'] });
      const data = tagsOf(await handlers.searchTags({}));
      expect(data.tags).toEqual({
        '#project': { files: 2, occurrences: 3 },
        '#work': { files: 1, occurrences: 1 },
      });
    });

    it('search_by_tag lists a file with a repeated tag once (#431)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#project'] });
      const result = await handlers.searchByTag({ tag: 'project' });
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
      const data = tagsOf(await handlers.searchTags({}));
      expect(data.tags).toEqual({
        '#area/work': { files: 1, occurrences: 1 },
        '#inline': { files: 1, occurrences: 1 },
        '#Project': { files: 2, occurrences: 3 },
      });
    });

    it('groups tags that differ only in case under the most common spelling (#470)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', {
        frontmatter: { tags: ['project'] },
        tags: ['#Project', '#Project/Alpha'],
      });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#Project', '#PROJECT', '#project/alpha'] });
      const data = tagsOf(await handlers.searchTags({}));
      // #Project: 2 occurrences, #project: 1, #PROJECT: 1. Nested tags
      // keep their own entry; #Project/Alpha and #project/alpha tie, so
      // the first seen spelling wins.
      expect(data.tags).toEqual({
        '#Project': { files: 2, occurrences: 4 },
        '#Project/Alpha': { files: 2, occurrences: 2 },
      });
    });

    it('sorts tags by name, ignoring case, so nested tags follow their parent', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#zeta', '#Beta', '#alpha/two', '#alpha', '#alpha-x'] });
      const data = tagsOf(await handlers.searchTags({}));
      expect(Object.keys(data.tags)).toEqual(['#alpha', '#alpha/two', '#alpha-x', '#Beta', '#zeta']);
    });

    it('pages with limit/offset and walks every tag once', async () => {
      adapter.addFile('a.md', 'content');
      const all = Array.from({ length: 25 }, (_, i) => `#t${String(i).padStart(2, '0')}`);
      adapter.setMetadata('a.md', { tags: all });

      const first = tagsOf(await handlers.searchTags({ limit: 10, offset: 0 }));
      expect(first).toMatchObject({ total: 25, count: 10, offset: 0, hasMore: true, nextOffset: 10 });
      expect(Object.keys(first.tags)).toEqual(all.slice(0, 10));

      const seen: string[] = [];
      let offset = 0;
      for (;;) {
        const page = tagsOf(await handlers.searchTags({ limit: 10, offset }));
        seen.push(...Object.keys(page.tags));
        if (!page.hasMore) break;
        offset = page.nextOffset ?? 0;
      }
      expect(seen).toEqual(all);
    });

    it('defaults to pages of 50 tags (#490)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: Array.from({ length: 150 }, (_, i) => `#t${String(i)}`) });
      const data = tagsOf(await handlers.searchTags({}));
      expect(data).toMatchObject({ total: 150, count: 50, hasMore: true, nextOffset: 50 });
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
      expect(result.structuredContent).toEqual({
        path: 'target.md',
        backlinks: ['source.md'],
        total: 1,
        hasMore: false,
      });
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
        total: 2,
        hasMore: false,
      });
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
      expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
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
      });
      const page = JSON.parse(getText(result)) as { items: string[] };
      expect(page.items).toEqual(['a.md']);
    });

    it('should handle tag without # prefix', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      const result = await handlers.searchByTag({
        tag: 'project',
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
      const result = await handlers.searchByTag({ tag: 'Project' });
      const page = JSON.parse(getText(result)) as { items: string[]; total: number };
      expect(page.items).toEqual(['both.md', 'list.md', 'string.md']);
      expect(page.total).toBe(3);
    });

    it('matches tags case-insensitively (#470)', async () => {
      adapter.addFile('upper.md', 'content');
      adapter.setMetadata('upper.md', { tags: ['#Project'] });
      adapter.addFile('fm.md', 'content');
      adapter.setMetadata('fm.md', { frontmatter: { tags: ['PROJECT'] } });
      adapter.addFile('lower.md', 'content');
      adapter.setMetadata('lower.md', { tags: ['#project'] });
      for (const tag of ['project', '#PROJECT', 'Project']) {
        const result = await handlers.searchByTag({ tag });
        const page = JSON.parse(getText(result)) as { items: string[] };
        expect(page.items).toEqual(['fm.md', 'lower.md', 'upper.md']);
      }
    });

    it('includes nested tags but not tags that only share a prefix (#470)', async () => {
      adapter.addFile('parent.md', 'content');
      adapter.setMetadata('parent.md', { tags: ['#project'] });
      adapter.addFile('child.md', 'content');
      adapter.setMetadata('child.md', { tags: ['#Project/Alpha'] });
      adapter.addFile('deep.md', 'content');
      adapter.setMetadata('deep.md', { frontmatter: { tags: 'project/alpha/beta' } });
      adapter.addFile('prefix.md', 'content');
      adapter.setMetadata('prefix.md', { tags: ['#projects', '#myproject/alpha'] });
      const all = await handlers.searchByTag({ tag: 'project' });
      expect((JSON.parse(getText(all)) as { items: string[] }).items).toEqual([
        'child.md',
        'deep.md',
        'parent.md',
      ]);
      const nested = await handlers.searchByTag({ tag: '#project/ALPHA/' });
      expect((JSON.parse(getText(nested)) as { items: string[] }).items).toEqual([
        'child.md',
        'deep.md',
      ]);
    });

    it('lists a file carrying the tag and a nested tag once (#470)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#project/alpha'] });
      const result = await handlers.searchByTag({ tag: 'project' });
      expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
      expect(result.structuredContent).toMatchObject({ items: ['a.md'], total: 1 });
    });

    it('finds nothing for a bare #', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      const result = await handlers.searchByTag({ tag: '#' });
      expect((JSON.parse(getText(result)) as { total: number }).total).toBe(0);
    });
  });

  describe('searchByFrontmatter', () => {
    type Hit = { path: string; value: unknown; valueTruncated?: boolean };
    const hitsOf = (result: CallToolResult): Hit[] =>
      (result.structuredContent as { items: Hit[] }).items;
    const pathsOf = (result: CallToolResult): string[] => hitsOf(result).map((h) => h.path);

    it('should find files by frontmatter value (json)', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { frontmatter: { status: 'draft' } });
      const result = await handlers.searchByFrontmatter({
        key: 'status',
        value: 'done',
      });
      const page = JSON.parse(getText(result)) as { items: Hit[] };
      expect(page.items).toEqual([{ path: 'a.md', value: 'done' }]);
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
      expect(pathsOf(result).sort()).toEqual(['a.md', 'b.md']);
    });

    it('still compares the value when it is given, including an empty string', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { frontmatter: { status: '' } });
      const result = await handlers.searchByFrontmatter({ key: 'status', value: '' });
      expect(pathsOf(result)).toEqual(['b.md']);
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
      expect(pathsOf(alpha)).toEqual(['a.md']);

      const beta = await handlers.searchByFrontmatter({ key: 'tags', value: 'beta' });
      expect(pathsOf(beta).sort()).toEqual(['a.md', 'b.md']);

      const joined = await handlers.searchByFrontmatter({ key: 'tags', value: 'alpha,beta' });
      expect(pathsOf(joined)).toEqual(['c.md']);

      const numeric = await handlers.searchByFrontmatter({ key: 'tags', value: '1' });
      expect(pathsOf(numeric)).toEqual(['d.md']);
    });

    it('exact match stays case-sensitive', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { status: 'Done' } });
      const result = await handlers.searchByFrontmatter({ key: 'status', value: 'done' });
      expect(pathsOf(result)).toEqual([]);
    });

    describe('value of each hit (#503)', () => {
      it('returns the raw value as parsed, whatever its type', async () => {
        const values: Record<string, unknown> = {
          's.md': 'retired',
          'n.md': 5,
          'b.md': true,
          'z.md': null,
          'l.md': ['a', 2],
          'o.md': { lat: 1, lon: 2 },
        };
        for (const [path, value] of Object.entries(values)) {
          adapter.addFile(path, 'x');
          adapter.setMetadata(path, { frontmatter: { k: value } });
        }
        const result = await handlers.searchByFrontmatter({ key: 'k' });
        const hits = hitsOf(result);
        expect(hits).toHaveLength(6);
        for (const hit of hits) {
          expect(hit.value).toEqual(values[hit.path]);
          expect(hit.valueTruncated).toBeUndefined();
        }
        expect(getText(result)).toBe(JSON.stringify(result.structuredContent));
      });

      it('returns the whole list when one element matched', async () => {
        adapter.addFile('a.md', 'x');
        adapter.setMetadata('a.md', { frontmatter: { tags: ['alpha', 'beta'] } });
        const result = await handlers.searchByFrontmatter({ key: 'tags', value: 'beta' });
        expect(hitsOf(result)).toEqual([{ path: 'a.md', value: ['alpha', 'beta'] }]);
      });

      it('leaves out notes without the key or without frontmatter', async () => {
        adapter.addFile('a.md', 'x');
        adapter.setMetadata('a.md', { frontmatter: { other: 1 } });
        adapter.addFile('b.md', 'x');
        const result = await handlers.searchByFrontmatter({ key: 'status' });
        expect(result.structuredContent).toEqual({
          total: 0,
          count: 0,
          offset: 0,
          items: [],
          hasMore: false,
        });
      });

      it('shortens a value over 1000 characters and flags it', async () => {
        adapter.addFile('long.md', 'x');
        adapter.setMetadata('long.md', { frontmatter: { summary: 'y'.repeat(5000) } });
        adapter.addFile('list.md', 'x');
        adapter.setMetadata('list.md', { frontmatter: { summary: ['z'.repeat(3000)] } });
        const hits = hitsOf(await handlers.searchByFrontmatter({ key: 'summary' }));
        const long = hits.find((h) => h.path === 'long.md');
        expect(long).toEqual({ path: 'long.md', value: 'y'.repeat(1000), valueTruncated: true });
        const list = hits.find((h) => h.path === 'list.md');
        expect(list?.valueTruncated).toBe(true);
        expect(list?.value).toBe(JSON.stringify(['z'.repeat(3000)]).slice(0, 1000));
      });

      it('keeps a page under CHARACTER_LIMIT and continues at nextOffset', async () => {
        for (let i = 0; i < 100; i++) {
          const path = `n-${String(i).padStart(3, '0')}.md`;
          adapter.addFile(path, 'x');
          adapter.setMetadata(path, { frontmatter: { summary: 'w'.repeat(900) } });
        }
        const first = await handlers.searchByFrontmatter({ key: 'summary', limit: 100 });
        expect(getText(first).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
        expect(getText(first)).toBe(JSON.stringify(first.structuredContent));
        const page = first.structuredContent as {
          count: number;
          hasMore: boolean;
          nextOffset?: number;
          total: number;
        };
        expect(page.total).toBe(100);
        expect(page.count).toBeLessThan(100);
        expect(page.hasMore).toBe(true);
        expect(page.nextOffset).toBe(page.count);

        const second = await handlers.searchByFrontmatter({
          key: 'summary',
          limit: 100,
          offset: page.nextOffset,
        });
        expect(hitsOf(second)[0].path).toBe(`n-${String(page.count).padStart(3, '0')}.md`);
      });

      it('pages with limit and offset', async () => {
        for (let i = 0; i < 5; i++) {
          adapter.addFile(`p${String(i)}.md`, 'x');
          adapter.setMetadata(`p${String(i)}.md`, { frontmatter: { n: i } });
        }
        const result = await handlers.searchByFrontmatter({ key: 'n', limit: 2, offset: 2 });
        expect(result.structuredContent).toEqual({
          total: 5,
          count: 2,
          offset: 2,
          items: [
            { path: 'p2.md', value: 2 },
            { path: 'p3.md', value: 3 },
          ],
          hasMore: true,
          nextOffset: 4,
        });
      });
    });

    describe('match: "prefix" (#503)', () => {
      beforeEach(() => {
        const notes: Record<string, unknown> = {
          'v1.md': '2025-07-03',
          'v2.md': '2025-07-28',
          'v3.md': '2025-08-01',
          'v4.md': ['2024-01-01', '2025-07-15'],
          'v5.md': 20250712,
          'v6.md': { start: '2025-07-01' },
          'v7.md': null,
          'v8.md': 'Done',
        };
        for (const [path, date] of Object.entries(notes)) {
          adapter.addFile(path, 'x');
          adapter.setMetadata(path, { frontmatter: { date } });
        }
      });

      it('matches strings, numbers and list elements that start with value', async () => {
        const result = await handlers.searchByFrontmatter({
          key: 'date',
          value: '2025-07',
          match: 'prefix',
        });
        expect(hitsOf(result)).toEqual([
          { path: 'v1.md', value: '2025-07-03' },
          { path: 'v2.md', value: '2025-07-28' },
          { path: 'v4.md', value: ['2024-01-01', '2025-07-15'] },
        ]);
        const numeric = await handlers.searchByFrontmatter({
          key: 'date',
          value: '202507',
          match: 'prefix',
        });
        expect(pathsOf(numeric)).toEqual(['v5.md']);
      });

      it('never matches an object or null', async () => {
        const object = await handlers.searchByFrontmatter({ key: 'date', value: '[object', match: 'prefix' });
        expect(pathsOf(object)).toEqual([]);
        const nul = await handlers.searchByFrontmatter({ key: 'date', value: 'nu', match: 'prefix' });
        expect(pathsOf(nul)).toEqual([]);
      });

      it('is case-sensitive like the exact match', async () => {
        const lower = await handlers.searchByFrontmatter({ key: 'date', value: 'do', match: 'prefix' });
        expect(pathsOf(lower)).toEqual([]);
        const upper = await handlers.searchByFrontmatter({ key: 'date', value: 'Do', match: 'prefix' });
        expect(pathsOf(upper)).toEqual(['v8.md']);
      });

      it('match: "exact" is the default', async () => {
        const result = await handlers.searchByFrontmatter({ key: 'date', value: '2025-07' });
        expect(pathsOf(result)).toEqual([]);
        const exact = await handlers.searchByFrontmatter({
          key: 'date',
          value: '2025-07-03',
          match: 'exact',
        });
        expect(pathsOf(exact)).toEqual(['v1.md']);
      });

      it('is ignored without value', async () => {
        const result = await handlers.searchByFrontmatter({ key: 'date', match: 'prefix' });
        expect(pathsOf(result)).toHaveLength(8);
      });
    });
  });

  describe('searchByName (#491)', () => {
    beforeEach(() => {
      adapter.addFile('Atlas/World Atlas.md', 'x');
      adapter.addFile('notes/atlas-notes.md', 'x');
      adapter.addFile('notes/daily/2026-11-10.md', 'x');
      adapter.addFile('notes/map.png', 'x');
      adapter.addFile('readme.md', 'x');
    });

    async function itemsFor(params: { query: string; folder?: string }): Promise<string[]> {
      const result = await handlers.searchByName(params);
      expect(result.isError, getText(result)).toBeUndefined();
      return (result.structuredContent as { items: string[] }).items;
    }

    it('matches a substring of the path, case-insensitively, sorted by path', async () => {
      expect(await itemsFor({ query: 'ATLAS' })).toEqual([
        'Atlas/World Atlas.md',
        'notes/atlas-notes.md',
      ]);
    });

    it('matches folder names in the path', async () => {
      expect(await itemsFor({ query: 'daily/' })).toEqual(['notes/daily/2026-11-10.md']);
    });

    it('finds files of any type', async () => {
      expect(await itemsFor({ query: '.png' })).toEqual(['notes/map.png']);
    });

    it('matches a glob without a slash against the file name', async () => {
      expect(await itemsFor({ query: '*atlas*.md' })).toEqual([
        'Atlas/World Atlas.md',
        'notes/atlas-notes.md',
      ]);
      expect(await itemsFor({ query: '2026-??-??.md' })).toEqual(['notes/daily/2026-11-10.md']);
      expect(await itemsFor({ query: 'atlas*' })).toEqual(['notes/atlas-notes.md']);
    });

    it('matches a glob with a slash against the whole path', async () => {
      expect(await itemsFor({ query: 'notes/*.md' })).toEqual(['notes/atlas-notes.md']);
      expect(await itemsFor({ query: 'notes/**/*.md' })).toEqual([
        'notes/atlas-notes.md',
        'notes/daily/2026-11-10.md',
      ]);
      expect(await itemsFor({ query: '**/*.md' })).toHaveLength(4);
    });

    it('treats regex characters in the query literally', async () => {
      adapter.addFile('a (1).md', 'x');
      adapter.addFile('a+b.md', 'x');
      expect(await itemsFor({ query: '(1)' })).toEqual(['a (1).md']);
      expect(await itemsFor({ query: 'a+b*' })).toEqual(['a+b.md']);
    });

    it('limits the search to a folder', async () => {
      expect(await itemsFor({ query: '.md', folder: 'notes' })).toEqual([
        'notes/atlas-notes.md',
        'notes/daily/2026-11-10.md',
      ]);
      expect(await itemsFor({ query: '.md', folder: '/' })).toHaveLength(4);
    });

    it('fails for a folder that does not exist', async () => {
      const result = await handlers.searchByName({ query: 'x', folder: 'missing' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('missing');
    });

    it('never returns files in the config folder', async () => {
      adapter.addFile('.obsidian/plugins/atlas/data.json', '{}');
      expect(await itemsFor({ query: 'atlas' })).not.toContain('.obsidian/plugins/atlas/data.json');
      expect(await itemsFor({ query: '**/*.json' })).toEqual([]);
    });

    it('rejects the config folder and paths outside the vault as folder', async () => {
      for (const folder of ['.obsidian', '../outside']) {
        const result = await handlers.searchByName({ query: 'x', folder });
        expect(result.isError, folder).toBe(true);
      }
    });

    it('pages with limit/offset', async () => {
      const result = await handlers.searchByName({ query: '.md', limit: 2, offset: 1 });
      expect(result.structuredContent).toEqual({
        total: 4,
        count: 2,
        offset: 1,
        items: ['notes/atlas-notes.md', 'notes/daily/2026-11-10.md'],
        hasMore: true,
        nextOffset: 3,
      });
    });
  });

  describe('JSON text of every search tool (#467)', () => {
    it('mirrors structuredContent exactly', async () => {
      adapter.addFile('a.md', '# h1\nsee [[b]] ^blk');
      adapter.setMetadata('a.md', {
        frontmatter: { status: 'active' },
        tags: ['#project'],
        headings: [{ heading: 'h1', level: 1 }],
        links: [{ link: 'b' }],
      });
      adapter.addFile('b.md', 'x');
      const results = [
        await handlers.searchFulltext({ query: 'see' }),
        await handlers.searchFrontmatter({ path: 'a.md' }),
        await handlers.searchTags({}),
        await handlers.searchHeadings({ path: 'a.md' }),
        await handlers.searchOutgoingLinks({ path: 'a.md' }),
        await handlers.searchEmbeds({ path: 'a.md' }),
        await handlers.searchBacklinks({ path: 'b.md' }),
        await handlers.searchBacklinks({ path: 'b.md', includeContext: true }),
        await handlers.searchResolvedLinks({}),
        await handlers.searchUnresolvedLinks({}),
        await handlers.searchBlockReferences({ path: 'a.md' }),
        await handlers.searchByTag({ tag: 'project' }),
        await handlers.searchByFrontmatter({ key: 'status', value: 'active' }),
        await handlers.searchByName({ query: 'a' }),
      ];
      for (const result of results) {
        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(getText(result)).toBe(JSON.stringify(result.structuredContent));
      }
    });

    it('echoes no tag or value back, so nothing can be mangled (#463)', async () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      const result = await handlers.searchByTag({ tag: 'project' });
      expect(result.structuredContent).toEqual({
        total: 1,
        count: 1,
        offset: 0,
        items: ['a.md'],
        hasMore: false,
      });
    });
  });

  describe('searchBlockReferences', () => {
    it('should find block references (json)', async () => {
      adapter.addFile('test.md', 'Some content ^block-1\nMore text\nAnother block ^ref-2');
      const result = await handlers.searchBlockReferences({
        path: 'test.md',
      });
      const data = JSON.parse(getText(result)) as {
        blockRefs: Array<{ id: string }>;
      };
      expect(data.blockRefs).toHaveLength(2);
      expect(data.blockRefs[0].id).toBe('block-1');
      expect(data.blockRefs[1].id).toBe('ref-2');
    });

    it('returns the text of the line as text, not line (#468)', async () => {
      adapter.addFile('test.md', 'Intro\n  Indented block ^b1  \n');
      const result = await handlers.searchBlockReferences({ path: 'test.md' });
      expect(result.structuredContent).toEqual({
        path: 'test.md',
        blockRefs: [{ id: 'b1', text: 'Indented block ^b1' }],
      });
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

  it('paginated search tools expose described limit and offset', () => {
    for (const name of ['search_fulltext', 'search_by_tag', 'search_by_frontmatter', 'search_by_name']) {
      const schema = schemaFor(name);
      expect(schema.limit.description, name).toContain('Maximum items');
      expect(schema.offset.description, name).toContain('skip');
      expect(schema, name).not.toHaveProperty('responseFormat');
    }
  });

  it('search_tags takes only limit and offset (#468)', () => {
    expect(Object.keys(schemaFor('search_tags'))).toEqual(['limit', 'offset']);
  });

  it('link maps take path, limit and offset (#464); unresolved adds groupBy (#505)', () => {
    expect(Object.keys(schemaFor('search_resolved_links'))).toEqual(['path', 'limit', 'offset']);
    expect(Object.keys(schemaFor('search_unresolved_links'))).toEqual([
      'path',
      'groupBy',
      'limit',
      'offset',
    ]);
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

    const result = await handlers.searchTags({});
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.tags).toEqual({ '#project': { files: 1, occurrences: 1 } });
    expect(parsed.total).toBe(1);
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
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextOffset).toBe(2);
  });

  it('search_by_name declares outputSchema and parses with hasMore=true and nextOffset', async () => {
    const tool = findTool('search_by_name');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    for (let i = 0; i < 5; i++) adapter.addFile(`f-${String(i)}.md`, '');
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByName({ query: 'f-', limit: 2 });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.items).toEqual(['f-0.md', 'f-1.md']);
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
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.items).toEqual([{ path: 'a.md', value: 'done' }]);

    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { frontmatter: { status: 'x'.repeat(2000) } });
    const truncated = await handlers.searchByFrontmatter({ key: 'status', value: 'x', match: 'prefix' });
    expect(schema.parse(truncated.structuredContent).items).toEqual([
      { path: 'b.md', value: 'x'.repeat(1000), valueTruncated: true },
    ]);
  });
});

describe('link maps: paging and path (#464)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: SearchHandlers;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createSearchHandlers(adapter);
    adapter.addFile('target.md', 'x');
    for (const name of ['a', 'b', 'c']) {
      adapter.addFile(`${name}.md`, `[[target]] [[gone-${name}]]`);
      adapter.setMetadata(`${name}.md`, {
        links: [{ link: 'target' }, { link: `gone-${name}` }],
      });
    }
    adapter.addFile('clean.md', '[[target]]');
    adapter.setMetadata('clean.md', { links: [{ link: 'target' }] });
  });

  it('pages over sources with limit/offset', async () => {
    const first = await handlers.searchResolvedLinks({ limit: 2, offset: 0 });
    expect(first.structuredContent).toEqual({
      links: { 'a.md': { 'target.md': 1 }, 'b.md': { 'target.md': 1 } },
      total: 4,
      count: 2,
      offset: 0,
      hasMore: true,
      nextOffset: 2,
    });
    const last = await handlers.searchResolvedLinks({ limit: 2, offset: 2 });
    expect(Object.keys((last.structuredContent as { links: object }).links)).toEqual([
      'c.md',
      'clean.md',
    ]);
    expect((last.structuredContent as { hasMore: boolean }).hasMore).toBe(false);
  });

  it('leaves out sources without unresolved links', async () => {
    adapter.setMetadata('clean.md', { links: [] });
    const result = await handlers.searchUnresolvedLinks({});
    const page = result.structuredContent as { links: Record<string, unknown>; total: number };
    expect(Object.keys(page.links)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(page.total).toBe(3);
  });

  it('narrows to one note with path', async () => {
    const result = await handlers.searchUnresolvedLinks({ path: 'b.md' });
    expect((result.structuredContent as { links: object }).links).toEqual({
      'b.md': { 'gone-b': 1 },
    });
    const clean = await handlers.searchUnresolvedLinks({ path: 'clean.md' });
    expect((clean.structuredContent as { total: number }).total).toBe(0);
    expect(JSON.parse(getText(clean))).toMatchObject({ links: {}, total: 0 });
  });

  it('reports a missing path as "File not found"', async () => {
    const result = await handlers.searchResolvedLinks({ path: 'nope.md' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('File not found: nope.md');
  });

  it('returns an empty page when the offset is past the last source', async () => {
    const result = await handlers.searchResolvedLinks({ offset: 10 });
    expect(result.structuredContent).toMatchObject({ links: {}, total: 4, count: 0, hasMore: false });
  });

  it('keeps a source without resolved targets as an empty map', async () => {
    adapter.setMetadata('clean.md', { links: [{ link: 'missing' }] });
    const result = await handlers.searchResolvedLinks({ path: 'clean.md' });
    expect(result.structuredContent).toMatchObject({ links: { 'clean.md': {} } });
  });
});

describe('search_unresolved_links groupBy target (#505)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: SearchHandlers;

  function addNote(path: string, links: string[]): void {
    adapter.addFile(path, '');
    adapter.setMetadata(path, { links: links.map((link) => ({ link })) });
  }

  interface TargetItem {
    target: string;
    count: number;
    sourceCount: number;
    sources: string[];
  }

  function targetsOf(result: CallToolResult): TargetItem[] {
    return (result.structuredContent as { targets: TargetItem[] }).targets;
  }

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createSearchHandlers(adapter);
    addNote('c.md', ['Antenna', 'Antenna', 'Bolt']);
    addNote('a.md', ['Antenna', 'Cable']);
    addNote('b.md', ['Bolt', 'Cable', 'Cable']);
    addNote('clean.md', []);
  });

  it('defaults to groupBy source', async () => {
    const result = await handlers.searchUnresolvedLinks({});
    expect(result.structuredContent).toHaveProperty('links');
    expect(result.structuredContent).not.toHaveProperty('targets');
  });

  it('sums counts per target, sorted by count desc then target', async () => {
    const result = await handlers.searchUnresolvedLinks({ groupBy: 'target' });
    expect(result.structuredContent).toEqual({
      targets: [
        { target: 'Antenna', count: 3, sourceCount: 2, sources: ['a.md', 'c.md'] },
        { target: 'Cable', count: 3, sourceCount: 2, sources: ['a.md', 'b.md'] },
        { target: 'Bolt', count: 2, sourceCount: 2, sources: ['b.md', 'c.md'] },
      ],
      total: 3,
      count: 3,
      offset: 0,
      hasMore: false,
    });
    expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
  });

  it('pages over targets', async () => {
    const first = await handlers.searchUnresolvedLinks({ groupBy: 'target', limit: 2 });
    expect(targetsOf(first).map((t) => t.target)).toEqual(['Antenna', 'Cable']);
    expect(first.structuredContent).toMatchObject({ total: 3, count: 2, hasMore: true, nextOffset: 2 });
    const next = await handlers.searchUnresolvedLinks({ groupBy: 'target', limit: 2, offset: 2 });
    expect(targetsOf(next).map((t) => t.target)).toEqual(['Bolt']);
    expect(next.structuredContent).toMatchObject({ hasMore: false });
  });

  it('narrows to one source note with path', async () => {
    const result = await handlers.searchUnresolvedLinks({ groupBy: 'target', path: 'b.md' });
    expect(targetsOf(result)).toEqual([
      { target: 'Cable', count: 2, sourceCount: 1, sources: ['b.md'] },
      { target: 'Bolt', count: 1, sourceCount: 1, sources: ['b.md'] },
    ]);
  });

  it('lists at most 10 sources per target, sorted, with the full sourceCount', async () => {
    for (let i = 0; i < 15; i++) addNote(`many/n${String(i).padStart(2, '0')}.md`, ['Popular']);
    const result = await handlers.searchUnresolvedLinks({ groupBy: 'target', limit: 1 });
    const [top] = targetsOf(result);
    expect(top.target).toBe('Popular');
    expect(top.count).toBe(15);
    expect(top.sourceCount).toBe(15);
    expect(top.sources).toEqual(
      Array.from({ length: 10 }, (_, i) => `many/n${String(i).padStart(2, '0')}.md`),
    );
  });

  it('keeps a page under CHARACTER_LIMIT by returning fewer targets', async () => {
    for (let i = 0; i < 100; i++) {
      addNote(`long/${'x'.repeat(200)}-${String(i)}.md`, [`${'t'.repeat(200)}-${String(i)}`]);
    }
    const result = await handlers.searchUnresolvedLinks({ groupBy: 'target', limit: 100 });
    expect(getText(result).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const page = result.structuredContent as { count: number; hasMore: boolean; nextOffset: number };
    expect(page.count).toBeLessThan(100);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(page.count);
  });

  it('output parses against the declared outputSchema in both groupings', async () => {
    const tool = createSearchModule(adapter).tools().find((t) => t.name === 'search_unresolved_links');
    const schema = z.object(tool?.outputSchema as z.ZodRawShape).strict();
    const byTarget = await handlers.searchUnresolvedLinks({ groupBy: 'target' });
    expect(schema.parse(byTarget.structuredContent).targets).toHaveLength(3);
    const bySource = await handlers.searchUnresolvedLinks({ groupBy: 'source' });
    expect(Object.keys(schema.parse(bySource.structuredContent).links ?? {})).toEqual([
      'c.md',
      'a.md',
      'b.md',
    ]);
  });
});
