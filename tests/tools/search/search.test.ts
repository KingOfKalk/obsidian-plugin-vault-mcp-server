import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ToolContext } from '../../../src/registry/tool-context';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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
        response_format: 'json',
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

    it('truncates oversized json responses with a clear footer', async () => {
      const bigMatches = Array.from({ length: 5000 }, (_, i) => `match ${String(i)}`).join(
        '\n',
      );
      adapter.addFile('big.md', bigMatches);
      const result = await handlers.searchFulltext({
        query: 'match',
        response_format: 'json',
        limit: 100,
      });
      expect(getText(result)).toContain('[TRUNCATED:');
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
        response_format: 'json',
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
      const result = await handlers.searchTags({ response_format: 'json' });
      const data = JSON.parse(getText(result)) as { tags: Record<string, string[]> };
      expect(data.tags['#project']).toHaveLength(2);
      expect(data.tags['#work']).toHaveLength(1);
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
        response_format: 'json',
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
        response_format: 'json',
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
        response_format: 'json',
      });
      const data = JSON.parse(getText(result)) as { backlinks: string[] };
      expect(data.backlinks).toContain('source.md');
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
        response_format: 'json',
      });
      const page = JSON.parse(getText(result)) as { items: string[] };
      expect(page.items).toEqual(['a.md']);
    });

    it('should handle tag without # prefix', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      const result = await handlers.searchByTag({
        tag: 'project',
        response_format: 'json',
      });
      const page = JSON.parse(getText(result)) as { items: string[] };
      expect(page.items).toEqual(['a.md']);
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
        response_format: 'json',
      });
      const page = JSON.parse(getText(result)) as { items: string[] };
      expect(page.items).toEqual(['a.md']);
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
  });

  describe('searchBlockReferences', () => {
    it('should find block references (json)', async () => {
      adapter.addFile('test.md', 'Some content ^block-1\nMore text\nAnother block ^ref-2');
      const result = await handlers.searchBlockReferences({
        path: 'test.md',
        response_format: 'json',
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

describe('search tool descriptions document shared args', () => {
  function descriptionFor(name: string): string {
    const adapter = new MockObsidianAdapter();
    const tool = createSearchModule(adapter)
      .tools()
      .find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool.description;
  }

  it('documents pagination and response_format on search_fulltext', () => {
    const desc = descriptionFor('search_fulltext');
    expect(desc).toContain('limit (integer');
    expect(desc).toContain('offset (integer');
    expect(desc).toContain('response_format (enum');
  });

  it('documents pagination and response_format on search_by_tag', () => {
    const desc = descriptionFor('search_by_tag');
    expect(desc).toContain('limit (integer');
    expect(desc).toContain('offset (integer');
    expect(desc).toContain('response_format (enum');
  });

  it('documents pagination and response_format on search_by_frontmatter', () => {
    const desc = descriptionFor('search_by_frontmatter');
    expect(desc).toContain('limit (integer');
    expect(desc).toContain('offset (integer');
    expect(desc).toContain('response_format (enum');
  });

  it('documents response_format on tools that only spread responseFormatField', () => {
    for (const name of [
      'search_tags',
      'search_resolved_links',
      'search_unresolved_links',
    ]) {
      const desc = descriptionFor(name);
      expect(desc).toContain('response_format (enum');
      expect(desc).not.toContain('limit (integer');
      expect(desc).not.toContain('offset (integer');
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

  it('search_fulltext declares outputSchema and parses with has_more=false', async () => {
    const tool = findTool('search_fulltext');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'Hello World');
    adapter.addFile('b.md', 'Goodbye World');
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchFulltext({
      query: 'World',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(2);
    expect(parsed.count).toBe(2);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_offset).toBeUndefined();
    expect(parsed.items).toHaveLength(2);
  });

  it('search_fulltext parses with has_more=true and next_offset', async () => {
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
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_offset).toBe(2);
  });

  it('search_tags declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_tags');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { tags: ['#project'] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchTags({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.tags).toEqual({ '#project': ['a.md'] });
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
      response_format: 'json',
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
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.links).toEqual({ 'a.md': { missing: 1 } });
  });

  it('search_by_tag declares outputSchema and parses with has_more=false', async () => {
    const tool = findTool('search_by_tag');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { tags: ['#project'] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByTag({
      tag: 'project',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_offset).toBeUndefined();
    expect(parsed.items).toEqual(['a.md']);
  });

  it('search_by_tag parses with has_more=true and next_offset', async () => {
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
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_offset).toBe(2);
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
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.has_more).toBe(false);
    expect(parsed.items).toEqual(['a.md']);
  });
});
