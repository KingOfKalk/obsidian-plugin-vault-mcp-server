import { describe, it, expect } from 'vitest';
import { App, TFile } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';
import { buildTagIndex } from '../../src/obsidian/tag-index';

function file(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

function makeApp(tagsByFile: Record<string, string[]>): App {
  const files = Object.keys(tagsByFile).map(file);
  const app = new App();
  (app as unknown as { vault: unknown }).vault = {
    getMarkdownFiles: (): TFile[] => files,
    getAbstractFileByPath: (path: string): TFile | null =>
      files.find((f) => f.path === path) ?? null,
  };
  (app as unknown as { metadataCache: unknown }).metadataCache = {
    getFileCache: (f: TFile): unknown => {
      const tags = tagsByFile[f.path];
      return tags.length === 0 ? {} : { tags: tags.map((tag) => ({ tag })) };
    },
  };
  return app;
}

describe('RealObsidianAdapter.getAllTags (#431)', () => {
  it('lists each file once per tag and counts every occurrence', () => {
    const adapter = new RealObsidianAdapter(
      makeApp({
        'a.md': ['#project', '#work', '#project'],
        'b.md': ['#project'],
        'c.md': [],
      }),
    );
    expect(adapter.getAllTags()).toEqual({
      '#project': { files: ['a.md', 'b.md'], count: 3 },
      '#work': { files: ['a.md'], count: 1 },
    });
  });
});

describe('buildTagIndex', () => {
  it('returns an empty index when no file has tags', () => {
    expect(buildTagIndex([{ path: 'a.md', tags: [] }])).toEqual({});
  });
});
