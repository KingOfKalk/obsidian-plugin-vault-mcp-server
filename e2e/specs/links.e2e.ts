import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  callTool,
  connectClient,
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
 * The report reads the linking files right after `fileManager.renameFile`
 * resolves, so these specs check that Obsidian has rewritten the links by
 * then, and that the report matches the bytes on disk.
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
   * With the setting off, Obsidian renames the file and then asks "Update
   * links" (Always update / Just once / Do not update).
   * `fileManager.renameFile` does not resolve until that prompt is
   * answered, so the `vault_rename` call waits for the user.
   */
  async function renameAnswering(answer: string, name: string): Promise<LinkReport> {
    // Each case uses its own note name: a link left pointing at a missing
    // `[[Target]]` would otherwise resolve to the next case's Target.md.
    await setVaultConfig('alwaysUpdateLinks', false);
    await writeNotes({
      [`rename-prompt/${name}.md`]: `# ${name}\n`,
      [`rename-prompt/${name} linker.md`]: `See [[${name}]].\n`,
    });
    await waitForLinks({
      [`rename-prompt/${name} linker.md`]: { [`rename-prompt/${name}.md`]: 1 },
    });

    const pending = callTool<LinkReport>(client, 'vault_rename', {
      path: `rename-prompt/${name}.md`,
      newName: `${name} renamed.md`,
    });
    const button = browser.$('.modal-container').$(`button=${answer}`);
    await button.waitForClickable({ timeout: 15000, timeoutMsg: 'no "Update links" prompt' });
    await button.click();
    return pending;
  }

  it('vault_rename warns and leaves links alone when the prompt says "Do not update"', async function () {
    const report = await renameAnswering('Do not update', 'Kept');

    expect(report).toMatchObject({
      to: 'rename-prompt/Kept renamed.md',
      autoUpdateLinks: false,
      linksUpdated: 0,
      updatedFiles: [],
    });
    expect(report.warning).toContain('"Automatically update internal links" is off');
    expect(report.warning).toContain('1 file links to rename-prompt/Kept.md');
    expect(await readFromDisk('rename-prompt/Kept linker.md')).toBe('See [[Kept]].\n');
    expect(await readFromDisk('rename-prompt/Kept renamed.md')).toBe('# Kept\n');
  });

  it('vault_rename reports the links when the prompt says "Just once"', async function () {
    const report = await renameAnswering('Just once', 'Once');

    expect(report).toMatchObject({
      to: 'rename-prompt/Once renamed.md',
      autoUpdateLinks: false,
      linksUpdated: 1,
      updatedFiles: ['rename-prompt/Once linker.md'],
    });
    expect(report.warning).toBeUndefined();
    expect(await readFromDisk('rename-prompt/Once linker.md')).toBe('See [[Once renamed]].\n');
  });
});
