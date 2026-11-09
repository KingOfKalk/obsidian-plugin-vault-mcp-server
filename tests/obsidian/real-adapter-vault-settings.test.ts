import { describe, it, expect, vi } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';
import { createHandlers, WriteMutex } from '../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../src/tools/search/handlers';

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

/**
 * A fake App with an in-memory vault, `vault.getConfig` (undeclared in
 * Obsidian's typings), the metadata cache's `resolvedLinks`, and a
 * `fileManager.renameFile` that rewrites `[[old]]` links in the linking
 * files when `alwaysUpdateLinks` is on, like Obsidian does.
 */
function makeApp(
  config: Record<string, unknown>,
  files: Record<string, string>,
  resolvedLinks: Record<string, Record<string, number>>,
): { app: App; contents: Map<string, string>; trashFile: ReturnType<typeof vi.fn> } {
  const contents = new Map(Object.entries(files));
  const entries = new Map<string, TFile | TFolder>();
  for (const path of contents.keys()) entries.set(path, makeFile(path));
  const strip = (p: string): string => p.replace(/\.md$/, '');

  const vault = {
    getConfig: (key: string): unknown => config[key],
    getAbstractFileByPath: (path: string): TFile | TFolder | null => entries.get(path) ?? null,
    read: (file: TFile): Promise<string> => Promise.resolve(contents.get(file.path) ?? ''),
    createFolder: vi.fn(() => Promise.resolve()),
    adapter: { basePath: '/abs/vault' },
  };
  const trashFile = vi.fn(() => Promise.resolve());
  const fileManager = {
    trashFile,
    renameFile: vi.fn((file: TFile, newPath: string): Promise<void> => {
      const oldPath = file.path;
      const body = contents.get(oldPath) ?? '';
      contents.delete(oldPath);
      entries.delete(oldPath);
      contents.set(newPath, body);
      entries.set(newPath, makeFile(newPath));
      if (config.alwaysUpdateLinks === true) {
        for (const [path, text] of contents) {
          contents.set(path, text.split(`[[${strip(oldPath)}]]`).join(`[[${strip(newPath)}]]`));
        }
      }
      return Promise.resolve();
    }),
  };
  const app = new App();
  (app as unknown as { vault: unknown }).vault = vault;
  (app as unknown as { fileManager: unknown }).fileManager = fileManager;
  (app as unknown as { metadataCache: unknown }).metadataCache = { resolvedLinks };
  return { app, contents, trashFile };
}

describe('RealObsidianAdapter reads vault settings via getConfig (#430)', () => {
  it.each([
    ['system', 'system'],
    ['local', 'vault'],
    ['none', 'permanent'],
    ['something-new', 'unknown'],
    [undefined, 'unknown'],
  ])('trashOption %s maps to %s', (option, expected) => {
    const { app } = makeApp({ trashOption: option }, {}, {});
    expect(new RealObsidianAdapter(app).getTrashDestination()).toBe(expected);
  });

  it('reports "system" when fileManager.trashFile is missing (vault.trash fallback)', () => {
    const { app } = makeApp({ trashOption: 'none' }, {}, {});
    (app as unknown as { fileManager: unknown }).fileManager = {};
    expect(new RealObsidianAdapter(app).getTrashDestination()).toBe('system');
  });

  it.each([
    [true, true],
    [false, false],
    ['yes', null],
    [undefined, null],
  ])('alwaysUpdateLinks %s reads as %s', (value, expected) => {
    const { app } = makeApp({ alwaysUpdateLinks: value }, {}, {});
    expect(new RealObsidianAdapter(app).getAutoUpdateLinks()).toBe(expected);
  });

  it('returns null / unknown when vault.getConfig is missing', () => {
    const { app } = makeApp({}, {}, {});
    delete (app.vault as unknown as { getConfig?: unknown }).getConfig;
    const adapter = new RealObsidianAdapter(app);
    expect(adapter.getAutoUpdateLinks()).toBeNull();
    expect(adapter.getTrashDestination()).toBe('unknown');
  });

  it('returns null when vault.getConfig throws', () => {
    const { app } = makeApp({}, {}, {});
    (app.vault as unknown as { getConfig: () => unknown }).getConfig = (): unknown => {
      throw new Error('boom');
    };
    expect(new RealObsidianAdapter(app).getAutoUpdateLinks()).toBeNull();
  });
});

describe('vault handlers on the real adapter report link updates (#430)', () => {
  const files = { 'a.md': 'a', 'b.md': 'see [[a]] and [[a]]', 'c.md': 'none' };
  const links = { 'b.md': { 'a.md': 2 } };

  it('counts the rewritten links when "Automatically update internal links" is on', async () => {
    const { app, contents } = makeApp({ alwaysUpdateLinks: true }, files, links);
    const adapter = new RealObsidianAdapter(app);
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.renameFile({ path: 'a.md', newName: 'z.md' });

    expect(result.structuredContent).toEqual({
      from: 'a.md',
      to: 'z.md',
      linksUpdated: 2,
      updatedFiles: ['b.md'],
      autoUpdateLinks: true,
    });
    expect(contents.get('b.md')).toBe('see [[z]] and [[z]]');
  });

  it('warns when the setting is off', async () => {
    const { app } = makeApp({ alwaysUpdateLinks: false }, files, links);
    const adapter = new RealObsidianAdapter(app);
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.moveFile({ path: 'a.md', newPath: 'z.md' });

    expect(result.structuredContent).toMatchObject({
      linksUpdated: 0,
      updatedFiles: [],
      autoUpdateLinks: false,
    });
    expect((result.structuredContent as { warning?: string }).warning).toContain('1 file links to a.md');
  });

  it('vault_delete reports where the file went', async () => {
    const { app, trashFile } = makeApp({ trashOption: 'local' }, files, links);
    const adapter = new RealObsidianAdapter(app);
    const handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));

    const result = await handlers.deleteFile({ path: 'c.md' });

    expect(trashFile).toHaveBeenCalled();
    expect(result.structuredContent).toEqual({ path: 'c.md', deleted: true, trashedTo: 'vault' });
  });
});
