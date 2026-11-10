import { describe, it, expect } from 'vitest';
import { App, TFile } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';
import {
  buildTagIndex,
  filesWithTag,
  groupTagsByCase,
  parseFrontmatterTags,
  tagKey,
} from '../../src/obsidian/tag-index';

function file(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

interface FakeCache {
  tags?: string[];
  frontmatter?: Record<string, unknown>;
}

function makeApp(cacheByFile: Record<string, FakeCache | null>): App {
  const files = Object.keys(cacheByFile).map(file);
  const app = new App();
  (app as unknown as { vault: unknown }).vault = {
    getMarkdownFiles: (): TFile[] => files,
    getAbstractFileByPath: (path: string): TFile | null =>
      files.find((f) => f.path === path) ?? null,
  };
  (app as unknown as { metadataCache: unknown }).metadataCache = {
    getFileCache: (f: TFile): unknown => {
      const entry = cacheByFile[f.path];
      if (entry === null) return null;
      const cache: Record<string, unknown> = {};
      if (entry.tags && entry.tags.length > 0) {
        cache.tags = entry.tags.map((tag) => ({ tag }));
      }
      if (entry.frontmatter) cache.frontmatter = entry.frontmatter;
      return cache;
    },
  };
  return app;
}

function inline(tagsByFile: Record<string, string[]>): Record<string, FakeCache> {
  return Object.fromEntries(
    Object.entries(tagsByFile).map(([path, tags]) => [path, { tags }]),
  );
}

describe('RealObsidianAdapter.getAllTags (#431)', () => {
  it('lists each file once per tag and counts every occurrence', () => {
    const adapter = new RealObsidianAdapter(
      makeApp(
        inline({
          'a.md': ['#project', '#work', '#project'],
          'b.md': ['#project'],
          'c.md': [],
        }),
      ),
    );
    expect(adapter.getAllTags()).toEqual({
      '#project': { files: ['a.md', 'b.md'], count: 3 },
      '#work': { files: ['a.md'], count: 1 },
    });
  });
});

describe('RealObsidianAdapter frontmatter tags (#440)', () => {
  it('returns frontmatter-only tags in #tag form', () => {
    const adapter = new RealObsidianAdapter(
      makeApp({ 'a.md': { frontmatter: { tags: ['Project'] } } }),
    );
    expect(adapter.getTags('a.md')).toEqual(['#Project']);
  });

  it('merges frontmatter and inline tags, keeping every occurrence', () => {
    const adapter = new RealObsidianAdapter(
      makeApp({
        'a.md': { frontmatter: { tags: 'Project, #area/work' }, tags: ['#Project', '#inline'] },
      }),
    );
    expect(adapter.getTags('a.md')).toEqual([
      '#Project',
      '#area/work',
      '#Project',
      '#inline',
    ]);
  });

  it('returns no tags when the file has no cache', () => {
    const adapter = new RealObsidianAdapter(makeApp({ 'a.md': null }));
    expect(adapter.getTags('a.md')).toEqual([]);
  });

  it('indexes frontmatter tags once per file and counts all occurrences', () => {
    const adapter = new RealObsidianAdapter(
      makeApp({
        'fm.md': { frontmatter: { tag: '#Project' } },
        'mixed.md': { frontmatter: { tags: ['Project', 'area/work'] }, tags: ['#Project'] },
        'none.md': { frontmatter: { title: 'x' } },
      }),
    );
    expect(adapter.getAllTags()).toEqual({
      '#Project': { files: ['fm.md', 'mixed.md'], count: 3 },
      '#area/work': { files: ['mixed.md'], count: 1 },
    });
  });
});

describe('buildTagIndex', () => {
  it('returns an empty index when no file has tags', () => {
    expect(buildTagIndex([{ path: 'a.md', tags: [] }])).toEqual({});
  });
});

describe('parseFrontmatterTags (#440)', () => {
  it('returns nothing without frontmatter or tag keys', () => {
    expect(parseFrontmatterTags(null)).toEqual([]);
    expect(parseFrontmatterTags(undefined)).toEqual([]);
    expect(parseFrontmatterTags({ title: 'x' })).toEqual([]);
  });

  it('reads tags as a list, with or without #', () => {
    expect(parseFrontmatterTags({ tags: ['a', '#b', 'nested/c'] })).toEqual([
      '#a',
      '#b',
      '#nested/c',
    ]);
  });

  it('reads tags as a comma or space separated string', () => {
    expect(parseFrontmatterTags({ tags: 'a, #b c' })).toEqual(['#a', '#b', '#c']);
  });

  it('reads the singular tag key and keys in any case', () => {
    expect(parseFrontmatterTags({ tag: 'a', Tags: ['b'] })).toEqual(['#a', '#b']);
  });

  it('keeps numbers and skips empty or non-string values', () => {
    expect(parseFrontmatterTags({ tags: [2024, '', '#', null, { x: 1 }] })).toEqual([
      '#2024',
    ]);
    expect(parseFrontmatterTags({ tags: null })).toEqual([]);
  });
});

describe('tagKey (#470)', () => {
  it('drops leading # and trailing /, trims and lowercases', () => {
    expect(tagKey('#Project/Alpha/')).toBe('project/alpha');
    expect(tagKey('  ##TODO ')).toBe('todo');
    expect(tagKey('#')).toBe('');
  });
});

describe('filesWithTag (#470)', () => {
  const index = buildTagIndex([
    { path: 'z.md', tags: ['#Project'] },
    { path: 'a.md', tags: ['#project/alpha', '#project'] },
    { path: 'm.md', tags: ['#projects'] },
  ]);

  it('matches any case and nested tags, each file once, sorted', () => {
    expect(filesWithTag(index, 'PROJECT')).toEqual(['a.md', 'z.md']);
    expect(filesWithTag(index, '#project/Alpha')).toEqual(['a.md']);
    expect(filesWithTag(index, 'projects')).toEqual(['m.md']);
  });

  it('matches nothing for an empty tag', () => {
    expect(filesWithTag(index, '#')).toEqual([]);
  });
});

describe('groupTagsByCase (#470)', () => {
  it('keys each group by the spelling with the most occurrences', () => {
    const index = buildTagIndex([
      { path: 'a.md', tags: ['#todo', '#ToDo'] },
      { path: 'b.md', tags: ['#ToDo', '#ToDo', '#other'] },
    ]);
    expect(groupTagsByCase(index)).toEqual({
      '#ToDo': { files: ['a.md', 'b.md'], count: 4 },
      '#other': { files: ['b.md'], count: 1 },
    });
  });

  it('keeps the first spelling on a tie', () => {
    const index = buildTagIndex([
      { path: 'a.md', tags: ['#Area'] },
      { path: 'b.md', tags: ['#area'] },
    ]);
    expect(groupTagsByCase(index)).toEqual({ '#Area': { files: ['a.md', 'b.md'], count: 2 } });
  });
});
