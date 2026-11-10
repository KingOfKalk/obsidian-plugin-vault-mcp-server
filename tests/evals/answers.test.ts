/**
 * Ground truth for evals/vault.xml (#393, #466).
 *
 * Each test solves one eval question the way an agent would: through the
 * real MCP server on the fixture vault (hand-written notes plus the
 * generated bulk notes), over Streamable HTTP, with the SDK v2 client,
 * using only read tools. Results are paged with limit/offset/nextOffset
 * like an agent has to. The answer is derived from the tool results, never
 * hard-coded, and then compared with the <answer> in the XML. If a server
 * change, a fixture edit or a generator change alters an answer, this fails
 * in CI without needing a model or an API key.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, CallToolResult } from '@modelcontextprotocol/client';
import { connectClient, startHarness, type Harness } from '../../evals/harness';
import { answersMatch, parseEvaluationXml } from '../../evals/lib';
import { jsonOf, windowOf, type ParsedWindow } from '../helpers/result';

const pairs = parseEvaluationXml(
  readFileSync(resolve(process.cwd(), 'evals', 'vault.xml'), 'utf8'),
);

let harness: Harness;
let client: Client;
const readOnlyTools = new Set<string>();
const used = new Set<string>();

beforeAll(async () => {
  harness = await startHarness();
  client = await connectClient(harness);
  for (const t of (await client.listTools()).tools) {
    if (t.annotations?.readOnlyHint === true) readOnlyTools.add(t.name);
  }
});

afterAll(async () => {
  await client.close();
  await harness.close();
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  used.add(name);
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} failed: ${JSON.stringify(result.content)}`).not.toBe(true);
  return result;
}

/** A data tool's result, read from the JSON text the model sees (#467). */
async function data<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await call(name, args);
  const parsed = jsonOf<T>(result);
  expect(parsed).toEqual(result.structuredContent);
  return parsed;
}

/** One vault_read window, read from the plain-text result (#467). */
async function read(path: string, offset = 0): Promise<ParsedWindow> {
  const result = await call('vault_read', { path, offset });
  expect(result.structuredContent).toBeUndefined();
  return windowOf(result);
}

interface PageInfo {
  hasMore: boolean;
  nextOffset?: number;
}

/**
 * Call a paged tool until hasMore is false and return every page. Uses the
 * tool's default page size unless `args.limit` is given.
 */
async function pages<T extends PageInfo>(name: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await data<T>(name, { ...args, offset });
    out.push(page);
    if (!page.hasMore) return out;
    expect(page.nextOffset).toBeGreaterThan(offset);
    offset = page.nextOffset ?? 0;
  }
}

/** Every item of a paged `items` list, with the number of pages it took. */
async function allItems<T = string>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ items: T[]; pageCount: number }> {
  const all = await pages<PageInfo & { items: T[] }>(name, args);
  return { items: all.flatMap((p) => p.items), pageCount: all.length };
}

interface Link {
  link: string;
}

const frontmatter = async (path: string): Promise<Record<string, unknown>> =>
  (await data<{ frontmatter: Record<string, unknown> }>('vault_get_aspect', { path, aspect: 'frontmatter' }))
    .frontmatter;

const aspectLinks = async (path: string, aspect: 'outgoing_links' | 'embeds'): Promise<Link[]> => {
  const r = await data<{ links?: Link[]; embeds?: Link[] }>('vault_get_aspect', { path, aspect });
  return (aspect === 'embeds' ? r.embeds : r.links) ?? [];
};

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

/** Station ID from a visit report's file name, e.g. "visits/2025-03-14 ST-07.md". */
const stationOfVisit = (path: string): string => /(ST-\d+)\.md$/.exec(path)?.[1] ?? '';

/** Every file in the vault, via the recursive listing (several pages). */
let fileCache: string[] | null = null;
async function allFiles(): Promise<string[]> {
  if (fileCache === null) {
    const { items, pageCount } = await allItems('vault_list_recursive', { path: '/', limit: 100 });
    expect(pageCount).toBeGreaterThan(1);
    fileCache = items;
  }
  return fileCache;
}

/** Resolve a wikilink-style note name to its path by file name. */
async function notePath(name: string): Promise<string> {
  const hit = (await allFiles()).find((p) => nameOf(p) === name);
  if (!hit) throw new Error(`no note named ${name}`);
  return hit;
}

const inFolder = async (folder: string): Promise<string[]> =>
  (await allFiles()).filter((p) => p.startsWith(`${folder}/`));

async function personWith(key: string, value: string): Promise<string> {
  const { items: people, pageCount } = await allItems('search_by_tag', { tag: 'person' });
  expect(pageCount).toBeGreaterThan(1);
  for (const p of people) {
    if ((await frontmatter(p))[key] === value) return p;
  }
  throw new Error(`no person with ${key}=${value}`);
}

/** Station IDs whose frontmatter has `key: value`. */
async function stationsWhere(key: string, value: string): Promise<Set<string>> {
  const { items } = await allItems('search_by_frontmatter', { key, value });
  return new Set(items.filter((p) => p.startsWith('stations/')).map(nameOf));
}

/** The single key with the highest count; fails on a tie for first place. */
function uniqueMax(counts: Map<string, number>): string {
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  expect(sorted.length).toBeGreaterThan(0);
  if (sorted.length > 1) expect(sorted[0][1], 'tie for first place').toBeGreaterThan(sorted[1][1]);
  return sorted[0][0];
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const solutions: Array<() => Promise<string>> = [
  // Q1: active projects -> the one with no outgoing links -> owner -> role
  async (): Promise<string> => {
    const { items: active } = await allItems('search_by_frontmatter', { key: 'status', value: 'active' });
    const unlinked: string[] = [];
    for (const p of active) if ((await aspectLinks(p, 'outgoing_links')).length === 0) unlinked.push(p);
    expect(unlinked).toHaveLength(1);
    const owner = String((await frontmatter(unlinked[0])).owner);
    return String((await frontmatter(await notePath(owner))).role);
  },
  // Q2: Lead Researcher (people span several pages) -> their active project -> distinct backlinks
  async (): Promise<string> => {
    const lead = nameOf(await personWith('role', 'Lead Researcher'));
    const { items: owned } = await allItems('search_by_frontmatter', { key: 'owner', value: lead });
    const active: string[] = [];
    for (const p of owned) if ((await frontmatter(p)).status === 'active') active.push(p);
    expect(active).toHaveLength(1);
    const all = await pages<PageInfo & { backlinks: string[] }>('vault_get_aspect', {
      path: active[0],
      aspect: 'backlinks',
    });
    return String(new Set(all.flatMap((p) => p.backlinks)).size);
  },
  // Q3: kickoff meeting -> block embed -> block text -> amount
  async (): Promise<string> => {
    const meetings = await inFolder('meetings');
    const kickoff = meetings.find((m) => /kickoff/i.test(m));
    expect(kickoff).toBeDefined();
    const blockEmbeds = (await aspectLinks(kickoff ?? '', 'embeds')).filter((e) => e.link.includes('#^'));
    expect(blockEmbeds).toHaveLength(1);
    const [note, block] = blockEmbeds[0].link.split('#^');
    const { blockRefs } = await data<{ blockRefs: Array<{ id: string; text: string }> }>('vault_get_aspect', {
      path: await notePath(note),
      aspect: 'block_references',
    });
    const line = blockRefs.find((b) => b.id === block)?.text ?? '';
    const amount = /([\d,]+)\s*EUR/.exec(line);
    return (amount?.[1] ?? '').replace(/,/g, '');
  },
  // Q4: groundwater project -> embedded section of Field Protocol -> first nested heading
  async (): Promise<string> => {
    const { items } = await allItems<{ path: string }>('search_fulltext', { query: 'groundwater' });
    const pilot = items.map((i) => i.path).find((p) => p.startsWith('projects/'));
    const embeds = await aspectLinks(pilot ?? '', 'embeds');
    expect(embeds).toHaveLength(1);
    const [note, section] = embeds[0].link.split('#');
    const { headings } = await data<{ headings: Array<{ heading: string; level: number }> }>(
      'vault_get_aspect',
      { path: await notePath(note), aspect: 'headings' },
    );
    const i = headings.findIndex((h) => h.heading === section);
    const next = headings[i + 1];
    expect(next.level).toBeGreaterThan(headings[i].level);
    return next.heading;
  },
  // Q5: Lena's backlinks (several pages) x stations on the Birke -> count
  async (): Promise<string> => {
    const lena = await notePath('Lena Fischer');
    const all = await pages<PageInfo & { backlinks: string[] }>('vault_get_aspect', {
      path: lena,
      aspect: 'backlinks',
    });
    expect(all.length).toBeGreaterThan(1);
    const visits = all.flatMap((p) => p.backlinks).filter((p) => p.startsWith('visits/'));
    const birke = await stationsWhere('river', 'Birke');
    expect(birke.size).toBeGreaterThan(0);
    return String(visits.filter((v) => birke.has(stationOfVisit(v))).length);
  },
  // Q6: unresolved link map (several pages) -> spare parts without a note -> most distinct reports
  async (): Promise<string> => {
    const all = await pages<PageInfo & { links: Record<string, Record<string, number>> }>(
      'search_unresolved_links',
    );
    expect(all.length).toBeGreaterThan(1);
    const reports = new Map<string, number>();
    for (const page of all) {
      for (const [source, targets] of Object.entries(page.links)) {
        if (!source.startsWith('visits/')) continue;
        for (const target of Object.keys(targets)) count(reports, target);
      }
    }
    return uniqueMax(reports);
  },
  // Q7: list the visits folder (several pages) -> count reports per month
  async (): Promise<string> => {
    const all = await pages<PageInfo & { files: string[] }>('vault_list', { path: 'visits' });
    expect(all.length).toBeGreaterThan(1);
    const months = new Map<string, number>();
    for (const file of all.flatMap((p) => p.files)) count(months, nameOf(file).slice(0, 7));
    return uniqueMax(months);
  },
  // Q8: stations on the Corra -> each #issue/<kind> tag (paged) -> most frequent kind
  async (): Promise<string> => {
    const corra = await stationsWhere('river', 'Corra');
    const { tags } = await data<{ tags: Record<string, string[]> }>('search_tags');
    const kinds = Object.keys(tags)
      .filter((t) => t.startsWith('#issue/'))
      .map((t) => t.slice('#issue/'.length));
    expect(kinds.length).toBeGreaterThan(1);
    const counts = new Map<string, number>();
    for (const kind of kinds) {
      const { items } = await allItems('search_by_tag', { tag: `issue/${kind}` });
      counts.set(kind, items.filter((p) => corra.has(stationOfVisit(p))).length);
    }
    return uniqueMax(counts);
  },
  // Q9: retired stations -> latest retirement -> page through the ledger -> its last offset
  async (): Promise<string> => {
    const retired = [...(await stationsWhere('status', 'retired'))];
    expect(retired).toHaveLength(6);
    const dated = await Promise.all(
      retired.map(async (id) => ({ id, retired: String((await frontmatter(`stations/${id}.md`)).retired) })),
    );
    dated.sort((a, b) => b.retired.localeCompare(a.retired));
    expect(dated[0].retired).not.toBe(dated[1].retired);
    const ledger = await notePath('Calibration Ledger');
    let content = '';
    let offset = 0;
    let readPages = 0;
    for (;;) {
      const r = await read(ledger, offset);
      content += r.content;
      readPages++;
      if (!r.hasMore) break;
      offset = r.nextOffset ?? 0;
    }
    expect(readPages).toBeGreaterThan(2);
    const rows = content.split('\n').filter((l) => l.includes(`| ${dated[0].id} |`));
    const cells = rows[rows.length - 1].split('|').map((c) => c.trim());
    return cells[4];
  },
  // Q10: full-text search (several pages) for the intake -> the "choked" remark -> earliest -> technician -> team
  async (): Promise<string> => {
    const { items, pageCount } = await allItems<{ path: string; matches: string[] }>('search_fulltext', {
      query: 'intake',
    });
    expect(pageCount).toBeGreaterThan(1);
    const blocked = items
      .filter((i) => i.path.startsWith('visits/') && i.matches.some((m) => /choked/.test(m)))
      .map((i) => i.path)
      .sort();
    expect(blocked.length).toBeGreaterThan(1);
    expect(nameOf(blocked[0]).slice(0, 10)).not.toBe(nameOf(blocked[1]).slice(0, 10));
    const { content } = await read(blocked[0]);
    const technician = /^Technician: \[\[([^\]|]+)/m.exec(content)?.[1] ?? '';
    return String((await frontmatter(await notePath(technician))).team);
  },
];

describe('eval answers (evals/vault.xml)', () => {
  it('has one scripted solution per question', () => {
    expect(pairs).toHaveLength(10);
    expect(solutions).toHaveLength(pairs.length);
  });

  pairs.forEach((qa, i) => {
    it(`Q${String(i + 1)}: ${qa.answer}`, async () => {
      const derived = await solutions[i]();
      expect(answersMatch(derived, qa.answer), `derived "${derived}"`).toBe(true);
    });
  });

  it('solves every question with read-only tools only', () => {
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(readOnlyTools.has(name), name).toBe(true);
  });
});
