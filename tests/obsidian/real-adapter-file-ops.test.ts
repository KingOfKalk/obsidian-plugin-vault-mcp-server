import { describe, it, expect, vi } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';

type Entry = TFile | TFolder;

interface FakeVault {
  entries: Map<string, Entry>;
  getAbstractFileByPath: (path: string) => Entry | null;
  createFolder: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  copy: ReturnType<typeof vi.fn>;
  createBinary: ReturnType<typeof vi.fn>;
  modifyBinary: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  trash: ReturnType<typeof vi.fn>;
}

interface FakeFileManager {
  trashFile: ReturnType<typeof vi.fn>;
  renameFile: ReturnType<typeof vi.fn>;
}

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

function makeFolder(path: string, children: Entry[] = []): TFolder {
  const f = new TFolder();
  f.path = path;
  f.children = children;
  return f;
}

/**
 * A fake App whose vault behaves like Obsidian's: `create`, `copy` and
 * `createBinary` fail when the parent folder does not exist, which is
 * the raw ENOENT the adapter must now prevent (#405).
 */
function makeApp(initial: Entry[]): { app: App; vault: FakeVault; fileManager: FakeFileManager } {
  const entries = new Map<string, Entry>(initial.map((e) => [e.path, e]));
  const requireParent = (path: string): void => {
    const idx = path.lastIndexOf('/');
    if (idx <= 0) return;
    const parent = path.slice(0, idx);
    if (!(entries.get(parent) instanceof TFolder)) {
      throw new Error(`ENOENT: no such file or directory, open '/abs/vault/${path}'`);
    }
  };
  const addFile = (path: string): TFile => {
    requireParent(path);
    const f = makeFile(path);
    entries.set(path, f);
    return f;
  };
  const vault: FakeVault = {
    entries,
    getAbstractFileByPath: (path) => entries.get(path) ?? null,
    createFolder: vi.fn((path: string) => {
      requireParent(path);
      entries.set(path, makeFolder(path));
      return Promise.resolve();
    }),
    create: vi.fn((path: string) => Promise.resolve(addFile(path))),
    copy: vi.fn((_file: TFile, path: string) => Promise.resolve(addFile(path))),
    createBinary: vi.fn((path: string) => Promise.resolve(addFile(path))),
    modifyBinary: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
    trash: vi.fn(() => Promise.resolve()),
  };
  const fileManager: FakeFileManager = {
    trashFile: vi.fn(() => Promise.resolve()),
    renameFile: vi.fn((_file: Entry, newPath: string) => {
      requireParent(newPath);
      return Promise.resolve();
    }),
  };
  const app = new App();
  (app as unknown as { vault: unknown }).vault = vault;
  (app as unknown as { fileManager: unknown }).fileManager = fileManager;
  return { app, vault, fileManager };
}

describe('RealObsidianAdapter deletes go through fileManager.trashFile (#405)', () => {
  it('deleteFile trashes the file instead of vault.delete', async () => {
    const file = makeFile('a.md');
    const { app, vault, fileManager } = makeApp([file]);
    await new RealObsidianAdapter(app).deleteFile('a.md');
    expect(fileManager.trashFile).toHaveBeenCalledWith(file);
    expect(vault.delete).not.toHaveBeenCalled();
  });

  it('deleteFolder trashes the folder (recursive)', async () => {
    const folder = makeFolder('drafts', [makeFile('drafts/a.md')]);
    const { app, vault, fileManager } = makeApp([folder]);
    await new RealObsidianAdapter(app).deleteFolder('drafts', true);
    expect(fileManager.trashFile).toHaveBeenCalledWith(folder);
    expect(vault.delete).not.toHaveBeenCalled();
  });

  it('falls back to vault.trash(file, true) when fileManager.trashFile is missing (Obsidian < 1.6.6)', async () => {
    const file = makeFile('a.md');
    const { app, vault } = makeApp([file]);
    (app as unknown as { fileManager: unknown }).fileManager = {};
    await new RealObsidianAdapter(app).deleteFile('a.md');
    expect(vault.trash).toHaveBeenCalledWith(file, true);
    expect(vault.delete).not.toHaveBeenCalled();
  });

  it('deleteFolder still refuses a non-empty folder without recursive', async () => {
    const folder = makeFolder('drafts', [makeFile('drafts/a.md')]);
    const { app, fileManager } = makeApp([folder]);
    await expect(new RealObsidianAdapter(app).deleteFolder('drafts', false)).rejects.toThrow(
      'is not empty',
    );
    expect(fileManager.trashFile).not.toHaveBeenCalled();
  });
});

describe('RealObsidianAdapter renames go through fileManager.renameFile (#405)', () => {
  it('renameFile uses fileManager.renameFile so links are updated', async () => {
    const file = makeFile('a.md');
    const { app, vault, fileManager } = makeApp([file]);
    await new RealObsidianAdapter(app).renameFile('a.md', 'b.md');
    expect(fileManager.renameFile).toHaveBeenCalledWith(file, 'b.md');
    expect(vault.rename).not.toHaveBeenCalled();
  });

  it('renaming a folder uses fileManager.renameFile', async () => {
    const folder = makeFolder('wip');
    const { app, fileManager } = makeApp([folder]);
    await new RealObsidianAdapter(app).renameFile('wip', 'archive');
    expect(fileManager.renameFile).toHaveBeenCalledWith(folder, 'archive');
  });

  it('moving into a missing folder creates it first', async () => {
    const file = makeFile('a.md');
    const { app, vault, fileManager } = makeApp([file]);
    await new RealObsidianAdapter(app).renameFile('a.md', 'archive/2026/a.md');
    expect(vault.createFolder.mock.calls.map((c) => c[0] as string)).toEqual([
      'archive',
      'archive/2026',
    ]);
    expect(fileManager.renameFile).toHaveBeenCalledWith(file, 'archive/2026/a.md');
  });

  it('throws "Path not found" for a missing source', async () => {
    const { app } = makeApp([]);
    await expect(new RealObsidianAdapter(app).renameFile('nope.md', 'x.md')).rejects.toThrow(
      'Path not found: nope.md',
    );
  });
});

describe('RealObsidianAdapter creates missing parent folders (#405)', () => {
  it('createFile creates every missing ancestor', async () => {
    const { app, vault } = makeApp([makeFolder('notes')]);
    await new RealObsidianAdapter(app).createFile('notes/a/b/c.md', 'x');
    expect(vault.createFolder.mock.calls.map((c) => c[0] as string)).toEqual([
      'notes/a',
      'notes/a/b',
    ]);
    expect(vault.create).toHaveBeenCalledWith('notes/a/b/c.md', 'x');
  });

  it('createFile at the vault root creates no folder', async () => {
    const { app, vault } = makeApp([]);
    await new RealObsidianAdapter(app).createFile('c.md', 'x');
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it('copyFile creates the destination folder', async () => {
    const { app, vault } = makeApp([makeFile('a.md')]);
    await new RealObsidianAdapter(app).copyFile('a.md', 'copies/a.md');
    expect(vault.createFolder).toHaveBeenCalledWith('copies');
    expect(vault.entries.has('copies/a.md')).toBe(true);
  });

  it('writeBinary creates the folder for a new file', async () => {
    const { app, vault } = makeApp([]);
    await new RealObsidianAdapter(app).writeBinary('assets/x.bin', new ArrayBuffer(1));
    expect(vault.createFolder).toHaveBeenCalledWith('assets');
    expect(vault.createBinary).toHaveBeenCalled();
  });

  it('writeBinary modifies an existing file without creating folders', async () => {
    const { app, vault } = makeApp([makeFolder('assets'), makeFile('assets/x.bin')]);
    await new RealObsidianAdapter(app).writeBinary('assets/x.bin', new ArrayBuffer(1));
    expect(vault.modifyBinary).toHaveBeenCalled();
    expect(vault.createFolder).not.toHaveBeenCalled();
  });

  it('refuses when a file sits where a parent folder is needed', async () => {
    const { app, vault } = makeApp([makeFile('notes')]);
    await expect(new RealObsidianAdapter(app).createFile('notes/a.md', 'x')).rejects.toThrow(
      'Cannot create folder "notes": a file with that name exists',
    );
    expect(vault.create).not.toHaveBeenCalled();
  });
});
