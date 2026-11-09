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
