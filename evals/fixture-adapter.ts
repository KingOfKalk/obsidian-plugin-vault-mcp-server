/**
 * Read a fixture vault from disk into a MockObsidianAdapter, with the
 * metadata Obsidian's metadataCache would provide (#393).
 *
 * The mock adapter resolves links by exact path only. Real Obsidian resolves
 * `[[Atlas]]` to `projects/Atlas.md` by basename, counts embeds in
 * resolvedLinks, and keys unresolved links by their raw link text. The
 * FixtureAdapter below overrides the three link-map methods to behave like
 * that, so the eval sees the same shapes a real vault would produce.
 *
 * Eval-only code: nothing under evals/ is imported by src/, so it never
 * ends up in main.js.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MockObsidianAdapter } from '../src/obsidian/mock-adapter';

/** Fixed timestamp for every fixture file so stat output is deterministic. */
export const FIXTURE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

export interface LinkRef {
  link: string;
  displayText?: string;
}

export interface ParsedNote {
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  headings: Array<{ heading: string; level: number }>;
  links: LinkRef[];
  embeds: LinkRef[];
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === '') return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((v) => parseScalar(v));
  }
  return value;
}

/**
 * Minimal YAML subset for fixture frontmatter: `key: value` scalars, inline
 * lists and `- item` block lists. Dates stay strings, as in Obsidian.
 */
export function parseFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of yaml.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && listKey !== null) {
      (result[listKey] as unknown[]).push(parseScalar(item[1]));
      continue;
    }
    const kv = /^([^:\s][^:]*):(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    const rest = kv[2].trim();
    if (rest === '') {
      result[key] = [];
      listKey = key;
    } else {
      result[key] = parseScalar(rest);
      listKey = null;
    }
  }
  return result;
}

/** Split a note into its frontmatter block (if any) and body. */
export function splitFrontmatter(content: string): { yaml: string | null; body: string } {
  if (!content.startsWith('---\n')) return { yaml: null, body: content };
  const end = content.indexOf('\n---', 4);
  if (end === -1) return { yaml: null, body: content };
  const after = content.indexOf('\n', end + 4);
  return {
    yaml: content.slice(4, end),
    body: after === -1 ? '' : content.slice(after + 1),
  };
}

const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const LINK_RE = /(!?)\[\[([^\]]+)\]\]/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Parse the metadata Obsidian's metadataCache would hold for one note. */
export function parseNote(content: string): ParsedNote {
  const { yaml, body } = splitFrontmatter(content);
  const tags: string[] = [];
  const headings: Array<{ heading: string; level: number }> = [];
  const links: LinkRef[] = [];
  const embeds: LinkRef[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING_RE.exec(line);
    if (heading) {
      headings.push({ heading: heading[2], level: heading[1].length });
      continue;
    }
    for (const m of line.matchAll(TAG_RE)) {
      tags.push(`#${m[1]}`);
    }
    for (const m of line.matchAll(LINK_RE)) {
      const inner = m[2];
      const pipe = inner.indexOf('|');
      const link = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      const displayText = pipe === -1 ? link : inner.slice(pipe + 1).trim();
      (m[1] === '!' ? embeds : links).push({ link, displayText });
    }
  }
  return {
    frontmatter: yaml === null ? null : parseFrontmatter(yaml),
    tags,
    headings,
    links,
    embeds,
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function stripMd(path: string): string {
  return path.endsWith('.md') ? path.slice(0, -3) : path;
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** MockObsidianAdapter with Obsidian-style link resolution. */
export class FixtureAdapter extends MockObsidianAdapter {
  private notes = new Map<string, ParsedNote>();
  private paths: string[] = [];

  addNote(path: string, content: string): void {
    this.addFile(path, content, {
      size: Buffer.byteLength(content, 'utf8'),
      ctime: FIXTURE_TIME,
      mtime: FIXTURE_TIME,
    });
    this.paths.push(path);
    if (!path.endsWith('.md')) return;
    const parsed = parseNote(content);
    this.notes.set(path, parsed);
    this.setMetadata(path, {
      ...(parsed.frontmatter ? { frontmatter: parsed.frontmatter } : {}),
      tags: parsed.tags,
      headings: parsed.headings,
      links: parsed.links,
      embeds: parsed.embeds,
    });
  }

  /**
   * Resolve a link like `Atlas#Risks` from `source` to a vault path, the
   * way Obsidian does: exact path first, then a unique basename match.
   */
  resolveLink(link: string, source: string): string | null {
    const hash = link.indexOf('#');
    const linkpath = (hash === -1 ? link : link.slice(0, hash)).trim();
    if (linkpath === '') return source;
    const lower = linkpath.toLowerCase();
    const exact = this.paths.find(
      (p) => p.toLowerCase() === lower || stripMd(p).toLowerCase() === lower,
    );
    if (exact) return exact;
    const byName = this.paths
      .filter(
        (p) =>
          basename(p).toLowerCase() === lower || stripMd(basename(p)).toLowerCase() === lower,
      )
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    return byName[0] ?? null;
  }

  private linkTargets(path: string): LinkRef[] {
    const note = this.notes.get(path);
    return note ? [...note.links, ...note.embeds] : [];
  }

  override getResolvedLinks(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const source of this.notes.keys()) {
      const targets: Record<string, number> = {};
      for (const ref of this.linkTargets(source)) {
        const target = this.resolveLink(ref.link, source);
        if (target !== null) targets[target] = (targets[target] ?? 0) + 1;
      }
      result[source] = targets;
    }
    return result;
  }

  override getUnresolvedLinks(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const source of this.notes.keys()) {
      const targets: Record<string, number> = {};
      for (const ref of this.linkTargets(source)) {
        if (this.resolveLink(ref.link, source) !== null) continue;
        const hash = ref.link.indexOf('#');
        const key = hash === -1 ? ref.link : ref.link.slice(0, hash);
        targets[key] = (targets[key] ?? 0) + 1;
      }
      result[source] = targets;
    }
    return result;
  }

  override getBacklinks(path: string): string[] {
    const resolved = this.getResolvedLinks();
    // Same rule as the real adapter: every source whose resolved map has `path`.
    return Object.keys(resolved).filter((source) => path in resolved[source]);
  }
}

/** Load every file under `dir` into a fresh FixtureAdapter. */
export function loadFixtureVault(dir: string): FixtureAdapter {
  const adapter = new FixtureAdapter();
  for (const full of walk(dir)) {
    const path = relative(dir, full).split(sep).join('/');
    adapter.addNote(path, readFileSync(full, 'utf8'));
  }
  return adapter;
}
