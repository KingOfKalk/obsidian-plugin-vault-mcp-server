import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { callTool, connectClient, startMcpServer, waitForLinks, writeNotes } from '../helpers';

/**
 * Paging of the link maps, backlinks and vault_list against Obsidian's real
 * metadata cache (#464). Walking nextOffset returns every item once, and
 * search_unresolved_links leaves out notes without broken links: the real
 * `unresolvedLinks` has an (empty) entry for every note.
 */
const NOTES = 120;

interface Page {
  total: number;
  hasMore: boolean;
  nextOffset?: number;
}

function note(i: number): string {
  return `paging/Note ${String(i).padStart(3, '0')}.md`;
}

describe('paged link maps, backlinks and folder listing', function () {
  let client: Client;

  /** Every page of a tool, following nextOffset. */
  async function walk<P extends Page>(name: string, args: Record<string, unknown>): Promise<P[]> {
    const pages: P[] = [];
    let offset = 0;
    for (;;) {
      const page = await callTool<P>(client, name, { ...args, offset });
      pages.push(page);
      if (!page.hasMore) return pages;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset ?? 0;
    }
  }

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    const notes: Record<string, string> = {
      'paging/Hub.md': '# Hub\n',
      'paging/Clean.md': 'Only [[Hub]].\n',
    };
    for (let i = 0; i < NOTES; i++) {
      notes[note(i)] = `# ${String(i)}\nSee [[Hub]].\nBroken [[Gone ${String(i)}]].\n`;
    }
    await writeNotes(notes);
    const expected: Record<string, Record<string, number>> = {
      'paging/Clean.md': { 'paging/Hub.md': 1 },
    };
    for (let i = 0; i < NOTES; i++) expected[note(i)] = { 'paging/Hub.md': 1 };
    await waitForLinks(expected);
  });

  after(async function () {
    await client.close();
  });

  it('search_unresolved_links pages every broken source once and skips clean notes', async function () {
    const pages = await walk<Page & { links: Record<string, Record<string, number>> }>(
      'search_unresolved_links',
      { limit: 25 },
    );
    const sources = pages.flatMap((p) => Object.keys(p.links));
    expect(new Set(sources).size).toBe(sources.length);
    const paging = sources.filter((s) => s.startsWith('paging/'));
    expect(paging).toHaveLength(NOTES);
    expect(sources).not.toContain('paging/Clean.md');
    expect(sources).not.toContain('paging/Hub.md');
    expect(pages.every((p) => Object.values(p.links).every((t) => Object.keys(t).length > 0))).toBe(true);
  });

  it('path narrows the link maps to one note', async function () {
    const broken = await callTool<Page & { links: object }>(client, 'search_unresolved_links', {
      path: note(7),
    });
    expect(broken.links).toEqual({ [note(7)]: { 'Gone 7': 1 } });
    const clean = await callTool<Page & { links: object }>(client, 'search_unresolved_links', {
      path: 'paging/Clean.md',
    });
    expect(clean).toMatchObject({ links: {}, total: 0, hasMore: false });
    const resolved = await callTool<Page & { links: object }>(client, 'search_resolved_links', {
      path: 'paging/Clean.md',
    });
    expect(resolved.links).toEqual({ 'paging/Clean.md': { 'paging/Hub.md': 1 } });
  });

  it('vault_get_aspect pages the backlinks with their context', async function () {
    const pages = await walk<Page & { backlinks: string[]; backlinkContext: unknown[] }>(
      'vault_get_aspect',
      { path: 'paging/Hub.md', aspect: 'backlinks', includeContext: true, limit: 50 },
    );
    expect(pages.map((p) => p.backlinks.length)).toEqual([50, 50, 21]);
    const backlinks = pages.flatMap((p) => p.backlinks);
    expect(new Set(backlinks).size).toBe(NOTES + 1);
    expect(pages.every((p) => p.backlinkContext.length === p.backlinks.length)).toBe(true);
  });

  it('vault_list pages a folder', async function () {
    const pages = await walk<Page & { files: string[] }>('vault_list', {
      path: 'paging',
      limit: 50,
    });
    const files = pages.flatMap((p) => p.files);
    expect(pages).toHaveLength(3);
    expect(new Set(files).size).toBe(NOTES + 2);
  });
});
