import { describe, it, expect } from 'vitest';
import { App, TFile } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';

function file(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

interface CacheRef {
  link: string;
  position?: { start: { line: number }; end: { line: number } };
}

function ref(link: string, start: number, end = start): CacheRef {
  return { link, position: { start: { line: start }, end: { line: end } } };
}

function makeApp(caches: Record<string, { links?: CacheRef[]; embeds?: CacheRef[] }>): App {
  const files: Record<string, TFile> = {
    'target.md': file('target.md'),
    'a.md': file('a.md'),
    'b.md': file('b.md'),
    'other.md': file('other.md'),
  };
  const app = new App();
  (app as unknown as { vault: unknown }).vault = {
    getAbstractFileByPath: (path: string): TFile | null => files[path] ?? null,
  };
  (app as unknown as { metadataCache: unknown }).metadataCache = {
    resolvedLinks: {
      'a.md': { 'target.md': 2, 'other.md': 1 },
      'b.md': { 'target.md': 1 },
      'other.md': { 'a.md': 1 },
    },
    getFileCache: (f: TFile): unknown => caches[f.path] ?? null,
    getFirstLinkpathDest: (linkpath: string, source: string): TFile | null => {
      if (linkpath === '') return files[source] ?? null;
      return files[linkpath] ?? files[`${linkpath}.md`] ?? null;
    },
  };
  return app;
}

describe('RealObsidianAdapter backlinks of a missing file (#447)', () => {
  it('getBacklinks throws "File not found" instead of returning no backlinks', () => {
    const adapter = new RealObsidianAdapter(makeApp({}));
    expect(() => adapter.getBacklinks('missing.md')).toThrow('File not found: missing.md');
  });

  it('getBacklinkLines throws "File not found" too', () => {
    const adapter = new RealObsidianAdapter(makeApp({}));
    expect(() => adapter.getBacklinkLines('missing.md')).toThrow('File not found: missing.md');
  });

  it('getBacklinks still lists the backlinks of an existing file', () => {
    const adapter = new RealObsidianAdapter(makeApp({}));
    expect(adapter.getBacklinks('target.md')).toEqual(['a.md', 'b.md']);
  });
});

describe('RealObsidianAdapter.getBacklinkLines (#408)', () => {
  it('uses metadata-cache link and embed positions that resolve to the target', () => {
    const app = makeApp({
      'a.md': {
        links: [ref('target', 4), ref('other', 1), ref('target#Heading', 4)],
        embeds: [ref('target', 2)],
      },
      'b.md': { links: [ref('target.md', 0, 1)] },
    });
    const adapter = new RealObsidianAdapter(app);
    expect(adapter.getBacklinkLines('target.md')).toEqual([
      { path: 'a.md', lines: [2, 4] },
      { path: 'b.md', lines: [0, 1] },
    ]);
  });

  it('returns an empty line list when a backlink has no positioned link', () => {
    const app = makeApp({ 'a.md': { links: [{ link: 'target' }] } });
    const adapter = new RealObsidianAdapter(app);
    expect(adapter.getBacklinkLines('target.md')).toEqual([
      { path: 'a.md', lines: [] },
      { path: 'b.md', lines: [] },
    ]);
  });
});
