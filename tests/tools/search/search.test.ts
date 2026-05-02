import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createSearchHandlers, type SearchHandlers } from '../../../src/tools/search/handlers';
import { createSearchModule } from '../../../src/tools/search/index';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
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
