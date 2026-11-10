import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createAspectHandlers, type AspectHandlers } from '../../../src/tools/vault/aspect';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
}

/** The vault_get_aspect handlers, one per aspect (moved from search, #532). */
describe('aspect handlers', () => {
  let adapter: MockObsidianAdapter;
  let handlers: AspectHandlers;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createAspectHandlers(adapter);
  });

  describe('frontmatter', () => {
    it('should return frontmatter for a file (json)', async () => {
      adapter.addFile('test.md', 'content');
      adapter.setMetadata('test.md', { frontmatter: { title: 'My Note', tags: ['project'] } });
      const result = await handlers.frontmatter({
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
      const result = await handlers.frontmatter({ path: 'test.md' });
      expect(getText(result)).toContain('test.md');
    });
  });

  describe('headings', () => {
    it('should return headings for a file (json)', async () => {
      adapter.addFile('test.md', '# Title\n## Subtitle');
      adapter.setMetadata('test.md', {
        headings: [
          { heading: 'Title', level: 1 },
          { heading: 'Subtitle', level: 2 },
        ],
      });
      const result = await handlers.headings({
        path: 'test.md',
      });
      const data = JSON.parse(getText(result)) as {
        headings: Array<{ heading: string; level: number }>;
      };
      expect(data.headings).toHaveLength(2);
      expect(data.headings[0].heading).toBe('Title');
    });
  });

  describe('outgoing_links', () => {
    it('should return links for a file (json)', async () => {
      adapter.addFile('test.md', 'content');
      adapter.setMetadata('test.md', {
        links: [{ link: 'other.md', displayText: 'Other' }],
      });
      const result = await handlers.outgoing_links({
        path: 'test.md',
      });
      const data = JSON.parse(getText(result)) as {
        links: Array<{ link: string }>;
      };
      expect(data.links).toHaveLength(1);
      expect(data.links[0].link).toBe('other.md');
    });
  });

  describe('backlinks', () => {
    it('should return files linking to the target (json)', async () => {
      adapter.addFile('source.md', 'links to target');
      adapter.setMetadata('source.md', {
        links: [{ link: 'target.md' }],
      });
      adapter.addFile('target.md', 'target content');
      const result = await handlers.backlinks({
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
        const result = await handlers.backlinks({ path: 'target.md', includeContext });
        expect(result.isError).toBe(true);
        expect(getText(result)).toContain('File not found: target.md');
      },
    );

    it('leaves the payload unchanged without includeContext (#408)', async () => {
      adapter.addFile('source.md', 'See [[target]].');
      adapter.setMetadata('source.md', { links: [{ link: 'target' }] });
      adapter.addFile('target.md', 'x');
      const result = await handlers.backlinks({ path: 'target.md' });
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

      const result = await handlers.backlinks({
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
      const result = await handlers.backlinks({ path: 'target.md', includeContext: true });
      expect(result.structuredContent).toMatchObject({
        backlinkContext: [{ path: 'source.md', matches: [] }],
      });
      expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
    });
  });

  describe('block_references', () => {
    it('should find block references (json)', async () => {
      adapter.addFile('test.md', 'Some content ^block-1\nMore text\nAnother block ^ref-2');
      const result = await handlers.block_references({
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
      const result = await handlers.block_references({ path: 'test.md' });
      expect(result.structuredContent).toEqual({
        path: 'test.md',
        blockRefs: [{ id: 'b1', text: 'Indented block ^b1' }],
      });
    });
  });
  it('mirrors structuredContent in the JSON text (#467)', async () => {
    adapter.addFile('a.md', '# h1\nsee [[b]] ^blk');
    adapter.setMetadata('a.md', {
      frontmatter: { status: 'active' },
      headings: [{ heading: 'h1', level: 1 }],
      links: [{ link: 'b' }],
    });
    adapter.addFile('b.md', 'x');
    const results = [
      await handlers.frontmatter({ path: 'a.md' }),
      await handlers.headings({ path: 'a.md' }),
      await handlers.outgoing_links({ path: 'a.md' }),
      await handlers.embeds({ path: 'a.md' }),
      await handlers.backlinks({ path: 'b.md' }),
      await handlers.backlinks({ path: 'b.md', includeContext: true }),
      await handlers.block_references({ path: 'a.md' }),
    ];
    for (const result of results) {
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(getText(result)).toBe(JSON.stringify(result.structuredContent));
    }
  });
});
