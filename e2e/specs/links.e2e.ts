import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  callTool,
  connectClient,
  expectNoModal,
  readFromDisk,
  setVaultConfig,
  startMcpServer,
  waitForLinks,
  writeNotes,
} from '../helpers';

interface LinkReport {
  from: string;
  to: string;
  linksUpdated: number;
  updatedFiles: string[];
  autoUpdateLinks: boolean | null;
  warning?: string;
}

/**
 * `vault_rename` / `vault_move` report which links Obsidian rewrote (#430).
 * The report reads the linking files right after the rename resolves, so
 * these specs check that Obsidian has rewritten the links by then (setting
 * on), that nothing is rewritten and no "Update links" prompt opens
 * (setting off, #445), and that the report matches the bytes on disk.
 */
describe('rename and move: link report vs real link rewriting', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
  });

  after(async function () {
    await client.close();
  });

  it('vault_rename reports the links Obsidian rewrote when auto-update is on', async function () {
    await setVaultConfig('alwaysUpdateLinks', true);
    await writeNotes({
      'rename-on/Target.md': '# Target\n',
      'rename-on/A.md': 'See [[Target]] and [[Target#Target|again]].\n',
      'rename-on/B.md': 'Also [[Target]].\n',
      'rename-on/Unrelated.md': 'No links here.\n',
    });
    await waitForLinks({
      'rename-on/A.md': { 'rename-on/Target.md': 2 },
      'rename-on/B.md': { 'rename-on/Target.md': 1 },
    });

    const report = await callTool<LinkReport>(client, 'vault_rename', {
      path: 'rename-on/Target.md',
      newName: 'Renamed.md',
    });

    expect(report).toMatchObject({
      from: 'rename-on/Target.md',
      to: 'rename-on/Renamed.md',
      autoUpdateLinks: true,
      linksUpdated: 3,
      updatedFiles: ['rename-on/A.md', 'rename-on/B.md'],
    });
    expect(report.warning).toBeUndefined();

    const a = await readFromDisk('rename-on/A.md');
    const b = await readFromDisk('rename-on/B.md');
    expect(a).toContain('[[Renamed]]');
    expect(a).toContain('[[Renamed#Target|again]]');
    expect(a).not.toContain('[[Target');
    expect(b).toBe('Also [[Renamed]].\n');
    expect(await readFromDisk('rename-on/Unrelated.md')).toBe('No links here.\n');
    expect(await readFromDisk('rename-on/Target.md')).toBeNull();
    expect(await readFromDisk('rename-on/Renamed.md')).toBe('# Target\n');
  });

  it('vault_move reports the links Obsidian rewrote when auto-update is on', async function () {
    await setVaultConfig('alwaysUpdateLinks', true);
    await writeNotes({
      'move-on/Note.md': 'Body\n',
      'move-on/Linker.md': 'Link: [[move-on/Note]]\n',
    });
    await waitForLinks({ 'move-on/Linker.md': { 'move-on/Note.md': 1 } });

    const report = await callTool<LinkReport>(client, 'vault_move', {
      path: 'move-on/Note.md',
      newPath: 'move-on/archive/Note.md',
    });

    expect(report).toMatchObject({
      to: 'move-on/archive/Note.md',
      autoUpdateLinks: true,
      linksUpdated: 1,
      updatedFiles: ['move-on/Linker.md'],
    });
    expect(report.warning).toBeUndefined();
    const linker = await readFromDisk('move-on/Linker.md');
    expect(linker).not.toBe('Link: [[move-on/Note]]\n');
    expect(linker).toContain('Note]]');
    expect(await readFromDisk('move-on/archive/Note.md')).toBe('Body\n');
  });

  /**
   * With the setting off, `fileManager.renameFile` would rename the file and
   * then ask "Update links" (Always update / Just once / Do not update),
   * and not resolve until someone answers. The tools rename with
   * `vault.rename` instead (#445), so the call returns on its own, no modal
   * opens and links stay as they were.
   */
  it('vault_rename returns without a prompt, leaves links alone and warns when auto-update is off', async function () {
    await setVaultConfig('alwaysUpdateLinks', false);
    await writeNotes({
      'rename-off/Kept.md': '# Kept\n',
      'rename-off/Kept linker.md': 'See [[Kept]].\n',
    });
    await waitForLinks({ 'rename-off/Kept linker.md': { 'rename-off/Kept.md': 1 } });

    const report = await callTool<LinkReport>(client, 'vault_rename', {
      path: 'rename-off/Kept.md',
      newName: 'Kept renamed.md',
    });

    expect(report).toMatchObject({
      to: 'rename-off/Kept renamed.md',
      autoUpdateLinks: false,
      linksUpdated: 0,
      updatedFiles: [],
    });
    expect(report.warning).toContain('"Automatically update internal links" is off');
    expect(report.warning).toContain('1 file links to rename-off/Kept.md');
    expect(await readFromDisk('rename-off/Kept linker.md')).toBe('See [[Kept]].\n');
    expect(await readFromDisk('rename-off/Kept.md')).toBeNull();
    expect(await readFromDisk('rename-off/Kept renamed.md')).toBe('# Kept\n');
    await expectNoModal();
  });

  it('vault_move returns without a prompt and leaves links alone when auto-update is off', async function () {
    await setVaultConfig('alwaysUpdateLinks', false);
    await writeNotes({
      'move-off/Note.md': 'Body\n',
      'move-off/Linker.md': 'Link: [[move-off/Note]]\n',
    });
    await waitForLinks({ 'move-off/Linker.md': { 'move-off/Note.md': 1 } });

    const report = await callTool<LinkReport>(client, 'vault_move', {
      path: 'move-off/Note.md',
      newPath: 'move-off/archive/Note.md',
    });

    expect(report).toMatchObject({
      to: 'move-off/archive/Note.md',
      autoUpdateLinks: false,
      linksUpdated: 0,
      updatedFiles: [],
    });
    expect(report.warning).toContain('1 file links to move-off/Note.md');
    expect(await readFromDisk('move-off/Linker.md')).toBe('Link: [[move-off/Note]]\n');
    expect(await readFromDisk('move-off/archive/Note.md')).toBe('Body\n');
    await expectNoModal();
  });

  it('vault_rename_folder returns without a prompt and leaves links alone when auto-update is off', async function () {
    await setVaultConfig('alwaysUpdateLinks', false);
    await writeNotes({
      'folder-off/wip/Inside.md': 'Inside\n',
      'folder-off/Outside.md': 'Link: [[folder-off/wip/Inside]]\n',
    });
    await waitForLinks({ 'folder-off/Outside.md': { 'folder-off/wip/Inside.md': 1 } });

    const report = await callTool<LinkReport>(client, 'vault_rename_folder', {
      path: 'folder-off/wip',
      newPath: 'folder-off/done',
    });

    expect(report).toMatchObject({
      autoUpdateLinks: false,
      linksUpdated: 0,
      updatedFiles: [],
    });
    expect(report.warning).toContain('1 file links to folder-off/wip');
    expect(await readFromDisk('folder-off/Outside.md')).toBe('Link: [[folder-off/wip/Inside]]\n');
    expect(await readFromDisk('folder-off/done/Inside.md')).toBe('Inside\n');
    expect(await readFromDisk('folder-off/wip/Inside.md')).toBeNull();
    await expectNoModal();
  });

  /**
   * vault_move and vault_rename accept folders too; their link report must
   * count links to every file in the folder, like vault_rename_folder
   * (#447). It used to look only for links to the folder path itself.
   */
  it('vault_move on a folder reports the links Obsidian rewrote into it', async function () {
    await setVaultConfig('alwaysUpdateLinks', true);
    await writeNotes({
      'fmove-on/wip/One.md': 'One\n',
      'fmove-on/wip/Two.md': 'Two\n',
      'fmove-on/Index.md': 'See [[fmove-on/wip/One]] and [[fmove-on/wip/Two]].\n',
    });
    await waitForLinks({
      'fmove-on/Index.md': { 'fmove-on/wip/One.md': 1, 'fmove-on/wip/Two.md': 1 },
    });

    const report = await callTool<LinkReport>(client, 'vault_move', {
      path: 'fmove-on/wip',
      newPath: 'fmove-on/archive/wip',
    });

    expect(report).toMatchObject({
      to: 'fmove-on/archive/wip',
      autoUpdateLinks: true,
      linksUpdated: 2,
      updatedFiles: ['fmove-on/Index.md'],
    });
    expect(report.warning).toBeUndefined();
    const index = await readFromDisk('fmove-on/Index.md');
    expect(index).not.toContain('[[fmove-on/wip/');
    expect(await readFromDisk('fmove-on/archive/wip/One.md')).toBe('One\n');
  });

  it('vault_rename on a folder warns when auto-update is off', async function () {
    await setVaultConfig('alwaysUpdateLinks', false);
    await writeNotes({
      'frename-off/wip/Inside.md': 'Inside\n',
      'frename-off/Outside.md': 'Link: [[frename-off/wip/Inside]]\n',
    });
    await waitForLinks({ 'frename-off/Outside.md': { 'frename-off/wip/Inside.md': 1 } });

    const report = await callTool<LinkReport>(client, 'vault_rename', {
      path: 'frename-off/wip',
      newName: 'done',
    });

    expect(report).toMatchObject({
      to: 'frename-off/done',
      autoUpdateLinks: false,
      linksUpdated: 0,
      updatedFiles: [],
    });
    expect(report.warning).toContain('1 file links to frename-off/wip');
    expect(await readFromDisk('frename-off/Outside.md')).toBe('Link: [[frename-off/wip/Inside]]\n');
    expect(await readFromDisk('frename-off/done/Inside.md')).toBe('Inside\n');
    await expectNoModal();
  });

  /**
   * vault_move and vault_rename replace vault_rename_folder (#468): on a
   * folder they must report and warn exactly like it did.
   */
  it('vault_move on a folder returns without a prompt and leaves links alone when auto-update is off', async function () {
    await setVaultConfig('alwaysUpdateLinks', false);
    await writeNotes({
      'fmove-off/wip/Inside.md': 'Inside\n',
      'fmove-off/Outside.md': 'Link: [[fmove-off/wip/Inside]]\n',
    });
    await waitForLinks({ 'fmove-off/Outside.md': { 'fmove-off/wip/Inside.md': 1 } });

    const report = await callTool<LinkReport>(client, 'vault_move', {
      path: 'fmove-off/wip',
      newPath: 'fmove-off/done',
    });

    expect(report).toEqual({
      from: 'fmove-off/wip',
      to: 'fmove-off/done',
      autoUpdateLinks: false,
      linksUpdated: 0,
      updatedFiles: [],
      warning: expect.stringContaining('1 file links to fmove-off/wip') as unknown as string,
    });
    expect(await readFromDisk('fmove-off/Outside.md')).toBe('Link: [[fmove-off/wip/Inside]]\n');
    expect(await readFromDisk('fmove-off/done/Inside.md')).toBe('Inside\n');
    expect(await readFromDisk('fmove-off/wip/Inside.md')).toBeNull();
    await expectNoModal();
  });

  it('vault_rename on a folder reports the links Obsidian rewrote into it, sources inside included', async function () {
    await setVaultConfig('alwaysUpdateLinks', true);
    await writeNotes({
      'frename-on/wip/One.md': 'See [[frename-on/wip/Two]].\n',
      'frename-on/wip/Two.md': 'Two\n',
      'frename-on/Index.md': 'See [[frename-on/wip/One]] and [[frename-on/wip/Two]].\n',
    });
    await waitForLinks({
      'frename-on/Index.md': { 'frename-on/wip/One.md': 1, 'frename-on/wip/Two.md': 1 },
      'frename-on/wip/One.md': { 'frename-on/wip/Two.md': 1 },
    });

    const report = await callTool<LinkReport>(client, 'vault_rename', {
      path: 'frename-on/wip',
      newName: 'done',
    });

    expect(report).toEqual({
      from: 'frename-on/wip',
      to: 'frename-on/done',
      autoUpdateLinks: true,
      linksUpdated: 3,
      updatedFiles: ['frename-on/Index.md', 'frename-on/done/One.md'],
    });
    const index = await readFromDisk('frename-on/Index.md');
    expect(index).not.toContain('[[frename-on/wip/');
    expect(await readFromDisk('frename-on/done/One.md')).not.toContain('[[frename-on/wip/');
    expect(await readFromDisk('frename-on/done/Two.md')).toBe('Two\n');
    await expectNoModal();
  });
});
