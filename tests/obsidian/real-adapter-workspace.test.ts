import { describe, it, expect, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';

function makeApp(): {
  app: App;
  file: TFile;
  getLeaf: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
} {
  const file = new TFile();
  file.path = 'notes/a.md';
  const openFile = vi.fn(() => Promise.resolve());
  const getLeaf = vi.fn(() => ({ openFile }));
  const app = new App();
  (app as unknown as { vault: unknown }).vault = {
    getAbstractFileByPath: (path: string): TFile | null => (path === file.path ? file : null),
  };
  (app as unknown as { workspace: unknown }).workspace = { getLeaf };
  return { app, file, getLeaf, openFile };
}

/**
 * `workspace_open_file` used to ignore `mode` (#447). The adapter now opens
 * the file in the reusable leaf with the matching Markdown view state:
 * Obsidian's Source mode is `{ mode: 'source', source: true }`, Live
 * Preview `{ mode: 'source', source: false }`, Reading view
 * `{ mode: 'preview' }`.
 */
describe('RealObsidianAdapter.openFile (#447)', () => {
  it.each([
    ['source', { mode: 'source', source: true }],
    ['live', { mode: 'source', source: false }],
    ['preview', { mode: 'preview' }],
  ] as const)('opens with mode=%s', async (mode, state) => {
    const { app, file, getLeaf, openFile } = makeApp();
    await new RealObsidianAdapter(app).openFile('notes/a.md', mode);
    expect(getLeaf).toHaveBeenCalledWith(false);
    expect(openFile).toHaveBeenCalledWith(file, { active: true, state });
  });

  it('leaves the view state to Obsidian when no mode is given', async () => {
    const { app, file, openFile } = makeApp();
    await new RealObsidianAdapter(app).openFile('notes/a.md');
    expect(openFile).toHaveBeenCalledWith(file, { active: true });
  });

  it('throws "File not found" for a missing file without opening anything', async () => {
    const { app, getLeaf } = makeApp();
    await expect(new RealObsidianAdapter(app).openFile('missing.md', 'preview')).rejects.toThrow(
      'File not found: missing.md',
    );
    expect(getLeaf).not.toHaveBeenCalled();
  });
});
