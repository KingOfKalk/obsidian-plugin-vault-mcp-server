/**
 * Ground truth for evals/vault.xml (#393).
 *
 * Each test solves one eval question the way an agent would: through the
 * real MCP server on the fixture vault, over Streamable HTTP, with the SDK
 * v2 client, using only read tools. The answer is derived from the tool
 * results, never hard-coded, and then compared with the <answer> in the
 * XML. If a server change or a fixture edit changes an answer, this fails
 * in CI without needing a model or an API key.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, CallToolResult } from '@modelcontextprotocol/client';
import { connectClient, startHarness, type Harness } from '../../evals/harness';
import { answersMatch, parseEvaluationXml } from '../../evals/lib';

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
  const result = await client.callTool({ name, arguments: { ...args, response_format: 'json' } });
  expect(result.isError, `${name} failed: ${JSON.stringify(result.content)}`).not.toBe(true);
  return result;
}

async function data<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await call(name, args);
  return result.structuredContent as T;
}

interface Page {
  items: string[];
}
interface Link {
  link: string;
}
type LinkMap = Record<string, Record<string, number>>;

const frontmatter = async (path: string): Promise<Record<string, unknown>> =>
  (await data<{ frontmatter: Record<string, unknown> }>('vault_get_aspect', { path, aspect: 'frontmatter' }))
    .frontmatter;

const aspectLinks = async (path: string, aspect: 'outgoing_links' | 'embeds'): Promise<Link[]> => {
  const r = await data<{ links?: Link[]; embeds?: Link[] }>('vault_get_aspect', { path, aspect });
  return (aspect === 'embeds' ? r.embeds : r.links) ?? [];
};

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

/** Every file in the vault, via the recursive listing. */
async function allFiles(): Promise<string[]> {
  return (await data<Page>('vault_list_recursive', { path: '/', limit: 100 })).items;
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
  const people = (await data<Page>('search_by_tag', { tag: 'person' })).items;
  for (const p of people) {
    if ((await frontmatter(p))[key] === value) return p;
  }
  throw new Error(`no person with ${key}=${value}`);
}

const solutions: Array<() => Promise<string>> = [
  // Q1: active projects -> the one with no outgoing links -> owner -> role
  async (): Promise<string> => {
    const active = (await data<Page>('search_by_frontmatter', { key: 'status', value: 'active' })).items;
    const unlinked: string[] = [];
    for (const p of active) if ((await aspectLinks(p, 'outgoing_links')).length === 0) unlinked.push(p);
    expect(unlinked).toHaveLength(1);
    const owner = String((await frontmatter(unlinked[0])).owner);
    return String((await frontmatter(await notePath(owner))).role);
  },
  // Q2: unresolved links whose source is a person note
  async (): Promise<string> => {
    const people = new Set((await data<Page>('search_by_tag', { tag: 'person' })).items);
    const { links } = await data<{ links: LinkMap }>('search_unresolved_links');
    const missing = Object.entries(links)
      .filter(([src]) => people.has(src))
      .flatMap(([, targets]) => Object.keys(targets));
    expect(missing).toHaveLength(1);
    return missing[0];
  },
  // Q3: Lead Researcher -> their active project -> distinct backlinks
  async (): Promise<string> => {
    const lead = nameOf(await personWith('role', 'Lead Researcher'));
    const owned = (await data<Page>('search_by_frontmatter', { key: 'owner', value: lead })).items;
    const active: string[] = [];
    for (const p of owned) if ((await frontmatter(p)).status === 'active') active.push(p);
    expect(active).toHaveLength(1);
    const { backlinks } = await data<{ backlinks: string[] }>('vault_get_aspect', {
      path: active[0],
      aspect: 'backlinks',
    });
    return String(new Set(backlinks).size);
  },
  // Q4: kickoff meeting -> block embed -> block text -> amount
  async (): Promise<string> => {
    const meetings = await inFolder('meetings');
    const kickoff = meetings.find((m) => /kickoff/i.test(m));
    expect(kickoff).toBeDefined();
    const blockEmbeds = (await aspectLinks(kickoff ?? '', 'embeds')).filter((e) => e.link.includes('#^'));
    expect(blockEmbeds).toHaveLength(1);
    const [note, block] = blockEmbeds[0].link.split('#^');
    const { blockRefs } = await data<{ blockRefs: Array<{ id: string; line: string }> }>('vault_get_aspect', {
      path: await notePath(note),
      aspect: 'block_references',
    });
    const line = blockRefs.find((b) => b.id === block)?.line ?? '';
    const amount = /([\d,]+)\s*EUR/.exec(line);
    return (amount?.[1] ?? '').replace(/,/g, '');
  },
  // Q5: Atlas -> embedded section of Field Protocol -> first nested heading
  async (): Promise<string> => {
    const pilot = (await data<{ items: Array<{ path: string }> }>('search_fulltext', { query: 'groundwater' })).items
      .map((i) => i.path)
      .find((p) => p.startsWith('projects/'));
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
  // Q6: page through the station log with vault_read offset, last S-05 row
  async (): Promise<string> => {
    const path = await notePath('Station Log');
    let content = '';
    let offset = 0;
    let pages = 0;
    for (;;) {
      const r = await data<{ content: string; has_more: boolean; next_offset?: number; total_length: number }>(
        'vault_read',
        { path, offset },
      );
      expect(r.total_length).toBeGreaterThan(25_000);
      content += r.content;
      pages++;
      if (!r.has_more) break;
      offset = r.next_offset ?? 0;
    }
    expect(pages).toBeGreaterThan(1);
    const rows = content.split('\n').filter((l) => l.includes('| S-05 |'));
    const cells = rows[rows.length - 1].split('|').map((c) => c.trim());
    return cells[4];
  },
  // Q7: template_list -> read the meeting template -> distinct placeholders
  async (): Promise<string> => {
    const { files } = await data<{ files: string[] }>('template_list');
    const meeting = files.find((f) => /meeting/i.test(f));
    const { content } = await data<{ content: string }>('vault_read', { path: meeting });
    return String(new Set([...content.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)].map((m) => m[1])).size);
  },
  // Q8: #project notes outside projects/ -> owner -> team
  async (): Promise<string> => {
    const tagged = (await data<Page>('search_by_tag', { tag: 'project' })).items;
    const outside = tagged.filter((p) => !p.startsWith('projects/'));
    expect(outside).toHaveLength(1);
    const owner = String((await frontmatter(outside[0])).owner);
    return String((await frontmatter(await notePath(owner))).team);
  },
  // Q9: attendees (outgoing links) common to both meetings
  async (): Promise<string> => {
    const meetings = await inFolder('meetings');
    expect(meetings).toHaveLength(2);
    const sets = await Promise.all(
      meetings.map(async (m) => {
        const { content } = await data<{ content: string }>('vault_read', { path: m });
        const line = content.split('\n').find((l) => l.startsWith('Attendees:')) ?? '';
        return new Set([...line.matchAll(/\[\[([^\]|#]+)/g)].map((x) => x[1]));
      }),
    );
    const both = [...sets[0]].filter((p) => sets[1].has(p));
    expect(both).toHaveLength(1);
    return both[0];
  },
  // Q10: projects not done -> earliest started
  async (): Promise<string> => {
    const projects = (await data<Page>('search_by_frontmatter', { key: 'status' })).items;
    const open: Array<{ path: string; started: string }> = [];
    for (const p of projects) {
      const fm = await frontmatter(p);
      if (fm.status !== 'done' && typeof fm.started === 'string') open.push({ path: p, started: fm.started });
    }
    open.sort((a, b) => a.started.localeCompare(b.started));
    return nameOf(open[0].path);
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
