import { describe, it, expect } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';
import { FolderNotFoundError } from '../../src/tools/shared/errors';

function makeApp(): { app: App; root: TFolder } {
  const root = new TFolder();
  root.path = '/';
  const file = new TFile();
  file.path = 'README.md';
  const folder = new TFolder();
  folder.path = 'projects';
  root.children = [file, folder];

  const app = new App();
  (app as unknown as { vault: unknown }).vault = {
    getRoot: (): TFolder => root,
    // Obsidian does not resolve the root through this lookup.
    getAbstractFileByPath: (path: string): TFolder | null =>
      path === 'projects' ? folder : null,
  };
  return { app, root };
}

describe('RealObsidianAdapter vault root listing (#388)', () => {
  it.each(['', '/', '.'])('list(%j) resolves the root via vault.getRoot()', (path) => {
    const { app } = makeApp();
    const adapter = new RealObsidianAdapter(app);
    expect(adapter.list(path)).toEqual({ files: ['README.md'], folders: ['projects'] });
  });

  it('still throws FolderNotFoundError for a missing folder', () => {
    const { app } = makeApp();
    const adapter = new RealObsidianAdapter(app);
    expect(() => adapter.list('nope')).toThrow(FolderNotFoundError);
  });
});
