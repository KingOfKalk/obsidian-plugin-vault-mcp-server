/**
 * Response size limits on a large vault (#464), through a real MCP SDK
 * client, so `structuredContent` is also checked against each tool's
 * advertised `outputSchema`.
 *
 * Every response must stay within CHARACTER_LIMIT by returning fewer items,
 * never by cutting text: a JSON response parses and equals
 * `structuredContent`, and walking `nextOffset` returns every item once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { CHARACTER_LIMIT } from '../../src/constants';
import { connectSeededServer, type Harness } from '../../scripts/tool-examples';

const NOTES = 3000;
const FLAT_FILES = 1500;
const DEEP_FOLDERS = 1500;
const EDITOR_LINES = 4000;
const TABLE_ROWS = 3000;
const LEAVES = 1500;

function textOf(result: CallToolResult): string {
  return result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

function notePath(i: number): string {
  return `notes/area-${String(i % 10)}/note-${String(i).padStart(5, '0')} with a longish title.md`;
}

const editorText = Array.from(
  { length: EDITOR_LINES },
  (_, i) => `line ${String(i)} lorem ipsum "quoted" dolor\tsit amet`,
).join('\n');

let h: Harness;
/** Backlinks of projects/alpha.md: the seeded vault's plus one per note. */
let alphaBacklinks = 0;

beforeAll(async () => {
  h = await connectSeededServer();
  alphaBacklinks = h.adapter.getBacklinks('projects/alpha.md').length + NOTES;
  for (let i = 0; i < NOTES; i++) {
    const path = notePath(i);
    h.adapter.addFile(
      path,
      `# Note ${String(i)}\nSee [[projects/alpha]] and [[missing-${String(i)}]].\n`,
    );
    h.adapter.setMetadata(path, {
      links: [{ link: 'projects/alpha' }, { link: `missing-${String(i)}` }],
    });
  }
  for (let i = 0; i < FLAT_FILES; i++) {
    h.adapter.addFile(`flat/f-${String(i).padStart(5, '0')}.md`, 'x');
  }
  for (let i = 0; i < DEEP_FOLDERS; i++) {
    h.adapter.addFolder(`deep/folder-${String(i).padStart(5, '0')} with a long name`);
  }
  h.adapter.setActiveEditor('projects/alpha.md', editorText);
  for (let i = 0; i < LEAVES; i++) {
    h.adapter.addOpenLeaf(`notes/n-${String(i)}.md`, `leaf-${String(i).padStart(6, '0')}`);
  }
  h.adapter.addInstalledPlugin('dataview', 'Dataview', true);
  const table = [
    '| File | Status |',
    '| --- | --- |',
    ...Array.from({ length: TABLE_ROWS }, (_, i) => `| [[note-${String(i)}]] | active |`),
  ].join('\n');
  h.adapter.setDataviewApi({
    queryMarkdown: () => Promise.resolve({ successful: true, value: table }),
  });
}, 60_000);

afterAll(async () => {
  await h.close();
});

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const result = await h.client.callTool({ name, arguments: args });
  expect(result.isError, textOf(result)).not.toBe(true);
  expect(textOf(result).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
  expect(textOf(result)).not.toContain('[TRUNCATED: Response exceeded');
  return result;
}

/** A JSON-mode call: the text parses and matches structuredContent. */
async function callJson(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await call(name, { ...args, responseFormat: 'json' });
  const parsed = JSON.parse(textOf(result)) as Record<string, unknown>;
  expect(parsed).toEqual(result.structuredContent);
  return parsed;
}

interface Paged {
  hasMore: boolean;
  nextOffset?: number;
}

/** Walk every page via nextOffset and collect `pick(page)`. */
async function walk<P extends Paged, T>(
  name: string,
  args: Record<string, unknown>,
  pick: (page: P) => T[],
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let offset = 0;
  let pages = 0;
  for (;;) {
    const page = (await callJson(name, { ...args, offset })) as unknown as P;
    items.push(...pick(page));
    pages++;
    if (!page.hasMore) break;
    expect(page.nextOffset).toBeGreaterThan(offset);
    offset = page.nextOffset ?? 0;
  }
  return { items, pages };
}

describe('large vault: link maps (#464)', () => {
  it('search_unresolved_links pages over sources and returns each once', async () => {
    const { items, pages } = await walk<Paged & { links: Record<string, unknown> }, string>(
      'search_unresolved_links',
      { limit: 100 },
      (p) => Object.keys(p.links),
    );
    expect(pages).toBe(NOTES / 100);
    expect(items).toHaveLength(NOTES);
    expect(new Set(items).size).toBe(NOTES);
  });

  it('search_unresolved_links leaves out notes without broken links', async () => {
    const page = await callJson('search_unresolved_links', { limit: 100 });
    expect(Object.values(page.links as Record<string, object>).every((t) => Object.keys(t).length > 0)).toBe(true);
    expect(page.total).toBe(NOTES);
  });

  it('search_resolved_links defaults to 50 sources per page', async () => {
    const page = await callJson('search_resolved_links', {});
    expect(page.count).toBe(50);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(50);
  });

  it('path narrows a link map to one note', async () => {
    const path = notePath(7);
    const page = await callJson('search_unresolved_links', { path });
    expect(page.links).toEqual({ [path]: { 'missing-7': 1 } });
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });
});

describe('large vault: backlinks (#464)', () => {
  it.each([false, true])('pages every linking file, includeContext=%s', async (includeContext) => {
    const { items } = await walk<Paged & { backlinks: string[] }, string>(
      'vault_get_aspect',
      { path: 'projects/alpha.md', aspect: 'backlinks', includeContext, limit: 100 },
      (p) => p.backlinks,
    );
    expect(items).toHaveLength(alphaBacklinks);
    expect(new Set(items).size).toBe(alphaBacklinks);
  });

  it('defaults to 50 linking files and shows the next offset in markdown', async () => {
    const result = await call('vault_get_aspect', { path: 'projects/alpha.md', aspect: 'backlinks' });
    expect((result.structuredContent as { backlinks: string[] }).backlinks).toHaveLength(50);
    expect(textOf(result)).toContain(`_Showing 50 of ${String(alphaBacklinks)} — next offset: 50_`);
  });
});

describe('large vault: folder listings (#464)', () => {
  it('vault_list pages a large folder', async () => {
    const { items, pages } = await walk<Paged & { files: string[] }, string>(
      'vault_list',
      { path: 'flat' },
      (p) => p.files,
    );
    expect(pages).toBe(FLAT_FILES / 100);
    expect(new Set(items).size).toBe(FLAT_FILES);
  });

  it('vault_list_recursive pages folders with the files', async () => {
    const { items } = await walk<Paged & { folders: string[] }, string>(
      'vault_list_recursive',
      { path: '', limit: 100 },
      (p) => p.folders,
    );
    const first = await callJson('vault_list_recursive', { path: '', limit: 100 });
    expect(items).toHaveLength(first.folderTotal as number);
    expect(new Set(items).size).toBe(items.length);
    expect(items.length).toBeGreaterThan(DEEP_FOLDERS);
  });
});

describe('large vault: windows and caps (#464)', () => {
  it.each(['markdown', 'json'])('editor_get_content windows reassemble the text (%s)', async (format) => {
    let offset = 0;
    let text = '';
    for (;;) {
      const result = await call('editor_get_content', { offset, responseFormat: format });
      const page = result.structuredContent as {
        content: string;
        totalLength: number;
        hasMore: boolean;
        nextOffset?: number;
      };
      if (format === 'json') expect(JSON.parse(textOf(result))).toEqual(page);
      expect(page.totalLength).toBe(editorText.length);
      text += page.content;
      if (!page.hasMore) break;
      if (format === 'markdown') {
        expect(textOf(result)).toContain(`Call editor_get_content again with offset=${String(page.nextOffset)}`);
      }
      offset = page.nextOffset ?? 0;
    }
    expect(text).toBe(editorText);
  });

  it('plugin_dataview_query returns whole rows and flags the cut', async () => {
    const result = await call('plugin_dataview_query', { query: 'TABLE status FROM ""' });
    const data = result.structuredContent as { markdown: string; truncated?: boolean };
    expect(data.truncated).toBe(true);
    expect(data.markdown.startsWith('| File | Status |\n| --- | --- |\n')).toBe(true);
    expect(data.markdown.split('\n').every((line) => /^\|.*\|$/.test(line))).toBe(true);
    expect(textOf(result)).toMatch(/\[TRUNCATED: Showing \d+ of 3002 lines\. Narrow the query/);
    const json = await callJson('plugin_dataview_query', { query: 'TABLE status FROM ""' });
    expect(json.truncated).toBe(true);
  });

  it('workspace_get_layout shortens its longest list', async () => {
    const layout = await callJson('workspace_get_layout', {});
    expect(layout.truncated).toBe(true);
    const children = (layout.main as { children: unknown[] }).children;
    expect(children.length).toBeGreaterThan(0);
    expect(children.length).toBeLessThan(LEAVES);
    const markdown = await call('workspace_get_layout', {});
    expect(textOf(markdown)).toContain('[TRUNCATED: The longest lists were shortened');
  });

  it('search_fulltext stays valid JSON with long match lists', async () => {
    const page = await callJson('search_fulltext', {
      query: 'see',
      limit: 100,
      maxMatchesPerFile: 100,
    });
    expect(page.hasMore).toBe(true);
  });
});
