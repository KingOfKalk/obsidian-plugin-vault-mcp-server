import { describe, it, expect, beforeEach } from 'vitest';
import { App, TFile } from 'obsidian';
import { CallToolResult } from '@modelcontextprotocol/server';
import { RealObsidianAdapter, type ObsidianAdapter } from '../../src/obsidian/adapter';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { resolveLinkpath } from '../../src/obsidian/link-resolver';
import { createSearchHandlers, splitLinkSubpath } from '../../src/tools/search/handlers';

/** Resolved link targets in vault_get_aspect (#485). */

interface LinkTarget {
  link: string;
  path: string | null;
  subpath?: string;
  displayText?: string;
}

function structured(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).toBeUndefined();
  return result.structuredContent as Record<string, unknown>;
}

async function linksOf(adapter: ObsidianAdapter, path: string): Promise<LinkTarget[]> {
  const result = await createSearchHandlers(adapter).searchOutgoingLinks({ path });
  return structured(result).links as LinkTarget[];
}

async function embedsOf(adapter: ObsidianAdapter, path: string): Promise<LinkTarget[]> {
  const result = await createSearchHandlers(adapter).searchEmbeds({ path });
  return structured(result).embeds as LinkTarget[];
}

const VAULT = [
  'Home.md',
  'notes/Source.md',
  'notes/Dup.md',
  'archive/old/Dup.md',
  'Shared.md',
  'deep/nested/Shared.md',
  'reference/Field Protocol.md',
  'assets/diagram.png',
  '.obsidian/snippets/style.css',
];

describe('resolveLinkpath: Obsidian rule for the mock adapters', () => {
  it.each([
    ['unique name in another folder', 'Field Protocol', 'Home.md', 'reference/Field Protocol.md'],
    ['name with extension', 'Field Protocol.md', 'Home.md', 'reference/Field Protocol.md'],
    ['case-insensitive', 'field protocol', 'Home.md', 'reference/Field Protocol.md'],
    ['non-Markdown file', 'diagram.png', 'notes/Source.md', 'assets/diagram.png'],
    ['same name: file under the source folder wins', 'Dup', 'notes/Source.md', 'notes/Dup.md'],
    ['same name: shortest path wins elsewhere', 'Dup', 'Home.md', 'notes/Dup.md'],
    ['same name: source folder beats a shorter path', 'Dup', 'archive/old/x.md', 'archive/old/Dup.md'],
    ['same name: a root file matches the bare name exactly', 'Shared', 'deep/nested/x.md', 'Shared.md'],
    ['full vault path', 'archive/old/Dup', 'notes/Source.md', 'archive/old/Dup.md'],
    ['partial path suffix', 'old/Dup', 'Home.md', 'archive/old/Dup.md'],
    ['relative ./ path', './Dup', 'notes/Source.md', 'notes/Dup.md'],
    ['relative ../ path', '../archive/old/Dup', 'notes/Source.md', 'archive/old/Dup.md'],
    ['leading slash', '/Shared', 'deep/nested/x.md', 'Shared.md'],
    ['empty link path is the source', '', 'notes/Source.md', 'notes/Source.md'],
  ])('%s', (_name, linkpath, source, expected) => {
    expect(resolveLinkpath(linkpath, source, VAULT)).toBe(expected);
  });

  it.each([
    ['missing note', 'Nowhere'],
    ['wrong folder in a full path', 'other/Dup'],
    ['absolute path that does not exist', '/old/Dup'],
  ])('unresolved: %s', (_name, linkpath) => {
    expect(resolveLinkpath(linkpath, 'Home.md', VAULT)).toBeNull();
  });
});

describe('splitLinkSubpath', () => {
  it.each([
    ['Note', { linkpath: 'Note' }],
    ['Note#Heading', { linkpath: 'Note', subpath: '#Heading' }],
    ['Note#^block-1', { linkpath: 'Note', subpath: '#^block-1' }],
    ['Note#A#B', { linkpath: 'Note', subpath: '#A#B' }],
    ['#Local', { linkpath: '', subpath: '#Local' }],
    ['Note#', { linkpath: 'Note' }],
  ])('%s', (link, expected) => {
    expect(splitLinkSubpath(link)).toEqual(expected);
  });
});

describe('vault_get_aspect link targets, mock adapter', () => {
  let adapter: MockObsidianAdapter;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    for (const path of VAULT) adapter.addFile(path, '');
  });

  it('adds path and subpath next to the raw link', async () => {
    adapter.setMetadata('notes/Source.md', {
      links: [
        { link: 'Field Protocol#Calibration', displayText: 'Field Protocol > Calibration' },
        { link: 'Field Protocol#^step-2' },
        { link: 'Dup' },
        { link: 'Nowhere#Intro' },
        { link: '#Local' },
      ],
    });
    expect(await linksOf(adapter, 'notes/Source.md')).toEqual([
      {
        link: 'Field Protocol#Calibration',
        path: 'reference/Field Protocol.md',
        subpath: '#Calibration',
        displayText: 'Field Protocol > Calibration',
      },
      { link: 'Field Protocol#^step-2', path: 'reference/Field Protocol.md', subpath: '#^step-2' },
      { link: 'Dup', path: 'notes/Dup.md' },
      { link: 'Nowhere#Intro', path: null, subpath: '#Intro' },
      { link: '#Local', path: 'notes/Source.md', subpath: '#Local' },
    ]);
  });

  it('resolves embeds, including non-Markdown files', async () => {
    adapter.setMetadata('Home.md', {
      embeds: [{ link: 'diagram.png' }, { link: 'Dup#Part' }, { link: 'missing.pdf' }],
    });
    expect(await embedsOf(adapter, 'Home.md')).toEqual([
      { link: 'diagram.png', path: 'assets/diagram.png' },
      { link: 'Dup#Part', path: 'notes/Dup.md', subpath: '#Part' },
      { link: 'missing.pdf', path: null },
    ]);
  });

  it('reports a target inside the config folder as null (#462)', async () => {
    adapter.setMetadata('Home.md', {
      links: [{ link: 'style.css' }],
      embeds: [{ link: '.obsidian/snippets/style.css' }],
    });
    expect(await linksOf(adapter, 'Home.md')).toEqual([{ link: 'style.css', path: null }]);
    expect(await embedsOf(adapter, 'Home.md')).toEqual([
      { link: '.obsidian/snippets/style.css', path: null },
    ]);
  });

  it('keeps the JSON text identical to structuredContent', async () => {
    adapter.setMetadata('Home.md', { links: [{ link: 'Dup#^b' }, { link: 'x' }] });
    const result = await createSearchHandlers(adapter).searchOutgoingLinks({ path: 'Home.md' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toBe(JSON.stringify(result.structuredContent));
  });
});

describe('vault_get_aspect link targets, real adapter', () => {
  function file(path: string): TFile {
    const f = new TFile();
    f.path = path;
    return f;
  }

  /** App with a fake metadataCache whose getFirstLinkpathDest uses the Obsidian rule. */
  function makeApp(caches: Record<string, { links?: unknown[]; embeds?: unknown[] }>): {
    app: App;
    calls: Array<[string, string]>;
  } {
    const files = new Map(VAULT.map((p) => [p, file(p)]));
    const calls: Array<[string, string]> = [];
    const app = new App();
    (app as unknown as { vault: unknown }).vault = {
      configDir: '.obsidian',
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string): TFile | null => files.get(path) ?? null,
    };
    (app as unknown as { metadataCache: unknown }).metadataCache = {
      getFileCache: (f: TFile): unknown => caches[f.path] ?? null,
      getFirstLinkpathDest: (linkpath: string, source: string): TFile | null => {
        calls.push([linkpath, source]);
        const path = resolveLinkpath(linkpath, source, VAULT);
        return path === null ? null : (files.get(path) ?? null);
      },
    };
    return { app, calls };
  }

  it('resolveLinkpath returns the path getFirstLinkpathDest gives, or null', () => {
    const { app, calls } = makeApp({});
    const adapter = new RealObsidianAdapter(app);
    expect(adapter.resolveLinkpath('Dup', 'archive/old/x.md')).toBe('archive/old/Dup.md');
    expect(adapter.resolveLinkpath('Dup', 'Home.md')).toBe('notes/Dup.md');
    expect(adapter.resolveLinkpath('Nowhere', 'Home.md')).toBeNull();
    expect(calls).toEqual([
      ['Dup', 'archive/old/x.md'],
      ['Dup', 'Home.md'],
      ['Nowhere', 'Home.md'],
    ]);
  });

  it('passes the link path without its subpath and fills path and subpath', async () => {
    const { app, calls } = makeApp({
      'notes/Source.md': {
        links: [
          { link: 'Field Protocol#Calibration', displayText: 'Calibration' },
          { link: 'Dup#^block' },
          { link: 'Nowhere' },
          { link: '.obsidian/snippets/style.css' },
        ],
        embeds: [{ link: 'diagram.png' }],
      },
    });
    const adapter = new RealObsidianAdapter(app);
    expect(await linksOf(adapter, 'notes/Source.md')).toEqual([
      {
        link: 'Field Protocol#Calibration',
        path: 'reference/Field Protocol.md',
        subpath: '#Calibration',
        displayText: 'Calibration',
      },
      { link: 'Dup#^block', path: 'notes/Dup.md', subpath: '#^block' },
      { link: 'Nowhere', path: null },
      { link: '.obsidian/snippets/style.css', path: null },
    ]);
    expect(await embedsOf(adapter, 'notes/Source.md')).toEqual([
      { link: 'diagram.png', path: 'assets/diagram.png' },
    ]);
    expect(calls.slice(0, 2)).toEqual([
      ['Field Protocol', 'notes/Source.md'],
      ['Dup', 'notes/Source.md'],
    ]);
  });
});
