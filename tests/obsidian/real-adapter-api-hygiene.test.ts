import { describe, it, expect, vi, type Mock } from 'vitest';
import { App, FileView, TFile, TFolder, View, type WorkspaceLeaf } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';
import { mockFileSystemAdapter } from '../__mocks__/obsidian';

/**
 * Public Obsidian API instead of internals and deprecated fields (#557):
 * `Vault.process`, `TFile.stat`, `FileSystemAdapter.getBasePath()`,
 * `getActiveViewOfType`, `FileView`, `normalizePath()`.
 */

function makeFile(path: string, stat = { ctime: 1, mtime: 2, size: 3 }): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = stat;
  return f;
}

function makeFolder(path: string): TFolder {
  const f = new TFolder();
  f.path = path;
  return f;
}

/** A view of the given class without running its constructor. */
function makeView<T extends View>(type: abstract new (...args: never[]) => T, viewType: string): T {
  const view = Object.create(type.prototype as object) as T;
  Object.assign(view, { getViewType: (): string => viewType });
  return view;
}

function fileView(file: TFile | null): FileView {
  const view = makeView(FileView, 'markdown');
  view.file = file;
  return view;
}

function graphView(): View {
  return makeView(View, 'graph');
}

/** A leaf with Obsidian's undocumented `id`. */
function makeLeaf(id: string | undefined, view: View): WorkspaceLeaf {
  const leaf = (id === undefined ? { view } : { id, view }) as unknown as WorkspaceLeaf;
  view.leaf = leaf;
  return leaf;
}

interface FakeVault {
  getAbstractFileByPath: Mock<(path: string) => TFile | TFolder | null>;
  process: Mock<(file: TFile, fn: (data: string) => string) => Promise<string>>;
  modify: Mock<() => Promise<void>>;
  create: Mock<(path: string, data: string) => Promise<void>>;
  createFolder: Mock<() => Promise<void>>;
  adapter: unknown;
  configDir: string;
}

interface FakeWorkspace {
  getActiveViewOfType: Mock<(type: abstract new (...args: never[]) => View) => View | null>;
  iterateAllLeaves: Mock<(cb: (leaf: WorkspaceLeaf) => void) => void>;
  setActiveLeaf: Mock<(leaf: WorkspaceLeaf, params: { focus: boolean }) => void>;
}

function makeApp(options: {
  entries?: Array<TFile | TFolder>;
  adapter?: unknown;
  leaves?: WorkspaceLeaf[];
  activeLeaf?: WorkspaceLeaf | null;
} = {}): { app: App; vault: FakeVault; workspace: FakeWorkspace } {
  const entries = new Map((options.entries ?? []).map((e) => [e.path, e]));
  const vault: FakeVault = {
    getAbstractFileByPath: vi.fn((path: string) => entries.get(path) ?? null),
    process: vi.fn((_file: TFile, fn: (data: string) => string) => Promise.resolve(fn('old'))),
    modify: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve()),
    createFolder: vi.fn(() => Promise.resolve()),
    adapter: options.adapter ?? mockFileSystemAdapter('/abs/vault'),
    configDir: '.obsidian',
  };
  const leaves = options.leaves ?? [];
  const active = options.activeLeaf ?? null;
  const workspace: FakeWorkspace = {
    getActiveViewOfType: vi.fn((type: abstract new (...args: never[]) => View) => {
      const view = active?.view;
      return view instanceof type ? view : null;
    }),
    iterateAllLeaves: vi.fn((cb: (leaf: WorkspaceLeaf) => void) => {
      leaves.forEach(cb);
    }),
    setActiveLeaf: vi.fn(),
  };
  const app = new App();
  (app as unknown as { vault: unknown }).vault = vault;
  (app as unknown as { workspace: unknown }).workspace = workspace;
  return { app, vault, workspace };
}


describe('RealObsidianAdapter.modifyFile uses Vault.process (#557)', () => {
  it('replaces the content through vault.process, not vault.modify', async () => {
    const file = makeFile('a.md');
    const { app, vault } = makeApp({ entries: [file] });
    await new RealObsidianAdapter(app).modifyFile('a.md', 'new');
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(vault.process.mock.calls[0][0]).toBe(file);
    const fn = vault.process.mock.calls[0][1];
    expect(fn('anything')).toBe('new');
    expect(vault.modify).not.toHaveBeenCalled();
  });

  it('throws "File not found" for a missing file', async () => {
    const { app } = makeApp();
    await expect(new RealObsidianAdapter(app).modifyFile('nope.md', 'x')).rejects.toThrow(
      'File not found',
    );
  });
});

describe('RealObsidianAdapter.stat reads TFile.stat (#557)', () => {
  it('returns size, ctime and mtime of a file', async () => {
    const { app } = makeApp({ entries: [makeFile('a.md', { ctime: 10, mtime: 20, size: 30 })] });
    expect(await new RealObsidianAdapter(app).stat('a.md')).toEqual({ ctime: 10, mtime: 20, size: 30 });
  });

  it('returns null for a folder or a missing path', async () => {
    const { app } = makeApp({ entries: [makeFolder('dir')] });
    const adapter = new RealObsidianAdapter(app);
    expect(await adapter.stat('dir')).toBeNull();
    expect(await adapter.stat('missing.md')).toBeNull();
  });
});

describe('RealObsidianAdapter.getVaultPath (#557)', () => {
  it('uses FileSystemAdapter.getBasePath()', () => {
    const { app } = makeApp({ adapter: mockFileSystemAdapter('/abs/vault') });
    expect(new RealObsidianAdapter(app).getVaultPath()).toBe('/abs/vault');
  });

  it('is empty for another adapter (no file system path)', () => {
    const { app } = makeApp({ adapter: { basePath: '/not/read' } });
    expect(new RealObsidianAdapter(app).getVaultPath()).toBe('');
  });
});

describe('RealObsidianAdapter workspace without activeLeaf (#557)', () => {
  it('getActiveLeafInfo describes the active view\'s leaf', () => {
    const leaf = makeLeaf('leaf-1', fileView(makeFile('notes/a.md')));
    const { app, workspace } = makeApp({ leaves: [leaf], activeLeaf: leaf });
    expect(new RealObsidianAdapter(app).getActiveLeafInfo()).toEqual({
      id: 'leaf-1',
      type: 'markdown',
      filePath: 'notes/a.md',
    });
    expect(workspace.getActiveViewOfType).toHaveBeenCalledWith(View);
  });

  it('getActiveLeafInfo gives no file for a view that shows none', () => {
    const leaf = makeLeaf('leaf-2', graphView());
    const { app } = makeApp({ leaves: [leaf], activeLeaf: leaf });
    expect(new RealObsidianAdapter(app).getActiveLeafInfo()).toEqual({
      id: 'leaf-2',
      type: 'graph',
      filePath: null,
    });
  });

  it('getActiveLeafInfo is null without an active view', () => {
    const { app } = makeApp();
    expect(new RealObsidianAdapter(app).getActiveLeafInfo()).toBeNull();
  });

  it('getActiveLeafInfo reports id "unknown" when the leaf has no id', () => {
    const leaf = makeLeaf(undefined, fileView(null));
    const { app } = makeApp({ leaves: [leaf], activeLeaf: leaf });
    expect(new RealObsidianAdapter(app).getActiveLeafInfo()).toEqual({
      id: 'unknown',
      type: 'markdown',
      filePath: null,
    });
  });

  it('getOpenFiles lists the files of file views only', () => {
    const leaves = [
      makeLeaf('l1', fileView(makeFile('a.md'))),
      makeLeaf('l2', graphView()),
      makeLeaf('l3', fileView(null)),
      makeLeaf('l4', fileView(makeFile('b.md'))),
    ];
    const { app } = makeApp({ leaves });
    expect(new RealObsidianAdapter(app).getOpenFiles()).toEqual([
      { path: 'a.md', leafId: 'l1' },
      { path: 'b.md', leafId: 'l4' },
    ]);
  });

  it('setActiveLeaf activates the leaf with the id', () => {
    const target = makeLeaf('l2', fileView(makeFile('b.md')));
    const leaves = [makeLeaf('l1', fileView(makeFile('a.md'))), target];
    const { app, workspace } = makeApp({ leaves });
    const adapter = new RealObsidianAdapter(app);
    expect(adapter.setActiveLeaf('l2')).toBe(true);
    expect(workspace.setActiveLeaf).toHaveBeenCalledWith(target, { focus: true });
    expect(adapter.setActiveLeaf('nope')).toBe(false);
  });
});

describe('RealObsidianAdapter normalizes paths for the Vault API (#557)', () => {
  it('looks a file up under its normalized path (non-breaking space)', async () => {
    const { app, vault } = makeApp({ entries: [makeFile('a b.md')] });
    expect(await new RealObsidianAdapter(app).exists('a\u00A0b.md')).toBe(true);
    expect(vault.getAbstractFileByPath).toHaveBeenCalledWith('a b.md');
  });

  it('creates a file under its normalized path (narrow no-break space)', async () => {
    const { app, vault } = makeApp();
    await new RealObsidianAdapter(app).createFile('new\u202Fnote.md', 'x');
    expect(vault.create).toHaveBeenCalledWith('new note.md', 'x');
  });

  it('normalizes to NFC', async () => {
    const { app, vault } = makeApp();
    await new RealObsidianAdapter(app).createFile('Cafe\u0301.md', 'x');
    expect(vault.create).toHaveBeenCalledWith('Caf\u00E9.md', 'x');
  });

  it('writes a file found under its normalized path', async () => {
    const file = makeFile('x y.md');
    const { app, vault } = makeApp({ entries: [file] });
    await new RealObsidianAdapter(app).modifyFile('x\u00A0y.md', 'new');
    expect(vault.process.mock.calls[0][0]).toBe(file);
  });
});
