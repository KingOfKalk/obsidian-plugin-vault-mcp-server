/**
 * Read a fixture vault from disk into a MockObsidianAdapter, with the
 * metadata Obsidian's metadataCache would provide (#393).
 *
 * Link resolution comes from the mock adapter, which resolves links the way
 * Obsidian does (by file name or relative path, embeds included), so the
 * eval sees the same shapes a real vault would produce.
 *
 * Eval-only code: nothing under evals/ is imported by src/, so it never
 * ends up in main.js.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MockObsidianAdapter } from '../tests/helpers/mock-adapter';
import type { GeneratedNote } from './fixture-generator';

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

/** MockObsidianAdapter that parses each note's metadata as it is added. */
export class FixtureAdapter extends MockObsidianAdapter {
  addNote(path: string, content: string): void {
    this.addFile(path, content, {
      size: Buffer.byteLength(content, 'utf8'),
      ctime: FIXTURE_TIME,
      mtime: FIXTURE_TIME,
    });
    if (!path.endsWith('.md')) return;
    const parsed = parseNote(content);
    this.setMetadata(path, {
      ...(parsed.frontmatter ? { frontmatter: parsed.frontmatter } : {}),
      tags: parsed.tags,
      headings: parsed.headings,
      links: parsed.links,
      embeds: parsed.embeds,
    });
  }
}

/**
 * Load every file under `dir` into a fresh FixtureAdapter, then the
 * generated notes in `extra` (#466). A generated note never replaces a
 * file from disk.
 */
export function loadFixtureVault(dir: string, extra: readonly GeneratedNote[] = []): FixtureAdapter {
  const adapter = new FixtureAdapter();
  const seen = new Set<string>();
  for (const full of walk(dir)) {
    const path = relative(dir, full).split(sep).join('/');
    seen.add(path);
    adapter.addNote(path, readFileSync(full, 'utf8'));
  }
  for (const note of extra) {
    if (seen.has(note.path)) throw new Error(`Generated note ${note.path} collides with a fixture file.`);
    adapter.addNote(note.path, note.content);
  }
  return adapter;
}
