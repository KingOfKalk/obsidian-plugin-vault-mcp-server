import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { callTool, connectClient, startMcpServer, waitForCache, writeNotes } from '../helpers';

/**
 * Frontmatter-only and inline tags in `search_by_tag` / `search_tags`.
 * The tag tools used to ignore frontmatter tags and the mock adapter had the
 * same gap (#440), so this runs against real Obsidian.
 */
describe('tags: frontmatter and inline', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({
      'tags/Frontmatter.md': '---\ntags: [project]\n---\nNo inline tags.\n',
      'tags/Inline.md': 'Inline #project tag.\n',
      'tags/Other.md': 'Nothing tagged.\n',
    });
    await waitForCache(['tags/Frontmatter.md', 'tags/Inline.md', 'tags/Other.md']);
  });

  after(async function () {
    await client.close();
  });

  it('search_by_tag finds frontmatter-only and inline tags', async function () {
    const page = await callTool<{ items: string[] }>(client, 'search_by_tag', { tag: 'project' });
    expect([...page.items].sort()).toEqual(['tags/Frontmatter.md', 'tags/Inline.md']);
  });

  it('search_tags lists frontmatter-only and inline tags', async function () {
    const result = await callTool<{ tags: Record<string, string[]> }>(client, 'search_tags');
    expect([...(result.tags['#project'] ?? [])].sort()).toEqual([
      'tags/Frontmatter.md',
      'tags/Inline.md',
    ]);
  });
});

/**
 * Tags match like Obsidian's tag search: any case, nested tags included;
 * search_tags merges case variants under the most common spelling (#470).
 */
describe('tags: case and nesting', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({
      'tagcase/Upper.md': 'Inline #Area tag and #Area again.\n',
      'tagcase/Lower.md': '---\ntags: [area]\n---\nFrontmatter only.\n',
      'tagcase/Nested.md': 'Nested #area/North tag.\n',
      'tagcase/Prefix.md': 'Only #areas here.\n',
    });
    await waitForCache([
      'tagcase/Upper.md',
      'tagcase/Lower.md',
      'tagcase/Nested.md',
      'tagcase/Prefix.md',
    ]);
  });

  after(async function () {
    await client.close();
  });

  it('search_by_tag ignores case and includes nested tags', async function () {
    for (const tag of ['area', '#AREA']) {
      const page = await callTool<{ items: string[] }>(client, 'search_by_tag', { tag });
      expect(page.items).toEqual(['tagcase/Lower.md', 'tagcase/Nested.md', 'tagcase/Upper.md']);
    }
    const nested = await callTool<{ items: string[] }>(client, 'search_by_tag', {
      tag: 'Area/north',
    });
    expect(nested.items).toEqual(['tagcase/Nested.md']);
  });

  it('search_tags merges case variants under the most common spelling', async function () {
    const result = await callTool<{
      tags: Record<string, string[]>;
      counts: Record<string, number>;
    }>(client, 'search_tags');
    expect(result.tags['#area']).toBeUndefined();
    expect([...(result.tags['#Area'] ?? [])].sort()).toEqual([
      'tagcase/Lower.md',
      'tagcase/Upper.md',
    ]);
    expect(result.counts['#Area']).toBe(3);
    expect(result.tags['#area/North']).toEqual(['tagcase/Nested.md']);
  });
});
