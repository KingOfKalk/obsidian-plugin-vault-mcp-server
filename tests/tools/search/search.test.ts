import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
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
    expect(module.metadata.supportsReadOnly).toBe(false);
  });

  it('should register 12 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createSearchModule(adapter);
    expect(module.tools()).toHaveLength(12);
  });

  it('should have all read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createSearchModule(adapter);
    const allReadOnly = module.tools().every((t) => t.isReadOnly);
    expect(allReadOnly).toBe(true);
  });
});

describe('search handlers', () => {
  let adapter: MockObsidianAdapter;
  let handlers: Record<string, (params: Record<string, unknown>) => Promise<CallToolResult>>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createSearchHandlers(adapter);
  });

  describe('searchFulltext', () => {
    it('should find files containing query', async () => {
      adapter.addFile('notes/a.md', 'Hello World');
      adapter.addFile('notes/b.md', 'Goodbye World');
      adapter.addFile('notes/c.md', 'Nothing here');
      const result = await handlers.searchFulltext({ query: 'World' });
      const data = JSON.parse(getText(result)) as Array<{ path: string }>;
      expect(data).toHaveLength(2);
    });

    it('should be case-insensitive', async () => {
      adapter.addFile('test.md', 'Hello WORLD');
      const result = await handlers.searchFulltext({ query: 'world' });
      const data = JSON.parse(getText(result)) as Array<{ path: string }>;
      expect(data).toHaveLength(1);
    });
  });

  describe('searchFrontmatter', () => {
    it('should return frontmatter for a file', async () => {
      adapter.addFile('test.md', 'content');
      adapter.setMetadata('test.md', { frontmatter: { title: 'My Note', tags: ['project'] } });
      const result = await handlers.searchFrontmatter({ path: 'test.md' });
      const data = JSON.parse(getText(result)) as Record<string, unknown>;
      expect(data.title).toBe('My Note');
    });

    it('should return empty object when no frontmatter', async () => {
      adapter.addFile('test.md', 'content');
      const result = await handlers.searchFrontmatter({ path: 'test.md' });
      expect(getText(result)).toBe('{}');
    });
  });

  describe('searchTags', () => {
    it('should return all tags with file associations', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project', '#work'] });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#project'] });
      const result = await handlers.searchTags({});
      const data = JSON.parse(getText(result)) as Record<string, string[]>;
      expect(data['#project']).toHaveLength(2);
      expect(data['#work']).toHaveLength(1);
    });
  });

  describe('searchHeadings', () => {
    it('should return headings for a file', async () => {
      adapter.addFile('test.md', '# Title\n## Subtitle');
      adapter.setMetadata('test.md', {
        headings: [
          { heading: 'Title', level: 1 },
          { heading: 'Subtitle', level: 2 },
        ],
      });
      const result = await handlers.searchHeadings({ path: 'test.md' });
      const data = JSON.parse(getText(result)) as Array<{ heading: string; level: number }>;
      expect(data).toHaveLength(2);
      expect(data[0].heading).toBe('Title');
    });
  });

  describe('searchOutgoingLinks', () => {
    it('should return links for a file', async () => {
      adapter.addFile('test.md', 'content');
      adapter.setMetadata('test.md', {
        links: [{ link: 'other.md', displayText: 'Other' }],
      });
      const result = await handlers.searchOutgoingLinks({ path: 'test.md' });
      const data = JSON.parse(getText(result)) as Array<{ link: string }>;
      expect(data).toHaveLength(1);
      expect(data[0].link).toBe('other.md');
    });
  });

  describe('searchBacklinks', () => {
    it('should return files linking to the target', async () => {
      adapter.addFile('source.md', 'links to target');
      adapter.setMetadata('source.md', {
        links: [{ link: 'target.md' }],
      });
      adapter.addFile('target.md', 'target content');
      const result = await handlers.searchBacklinks({ path: 'target.md' });
      const data = JSON.parse(getText(result)) as string[];
      expect(data).toContain('source.md');
    });
  });

  describe('searchByTag', () => {
    it('should find files by tag', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { tags: ['#personal'] });
      const result = await handlers.searchByTag({ tag: '#project' });
      const data = JSON.parse(getText(result)) as string[];
      expect(data).toEqual(['a.md']);
    });

    it('should handle tag without # prefix', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { tags: ['#project'] });
      const result = await handlers.searchByTag({ tag: 'project' });
      const data = JSON.parse(getText(result)) as string[];
      expect(data).toEqual(['a.md']);
    });
  });

  describe('searchByFrontmatter', () => {
    it('should find files by frontmatter value', async () => {
      adapter.addFile('a.md', 'content');
      adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
      adapter.addFile('b.md', 'content');
      adapter.setMetadata('b.md', { frontmatter: { status: 'draft' } });
      const result = await handlers.searchByFrontmatter({ key: 'status', value: 'done' });
      const data = JSON.parse(getText(result)) as string[];
      expect(data).toEqual(['a.md']);
    });
  });

  describe('searchBlockReferences', () => {
    it('should find block references', async () => {
      adapter.addFile('test.md', 'Some content ^block-1\nMore text\nAnother block ^ref-2');
      const result = await handlers.searchBlockReferences({ path: 'test.md' });
      const data = JSON.parse(getText(result)) as Array<{ id: string }>;
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe('block-1');
      expect(data[1].id).toBe('ref-2');
    });
  });
});
