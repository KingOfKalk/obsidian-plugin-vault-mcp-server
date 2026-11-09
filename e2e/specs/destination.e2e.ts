import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { callToolError, connectClient, readFromDisk, startMcpServer, writeNotes } from '../helpers';

/**
 * Obsidian refuses to rename, move or copy onto an existing path; nothing
 * is overwritten. `MockObsidianAdapter` throws the same errors, so unit
 * tests see what real Obsidian does (#447).
 */
describe('rename, move and copy onto an existing destination', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({
      'dest/a.md': 'A\n',
      'dest/b.md': 'B\n',
      'dest/f1/x.md': 'x\n',
      'dest/f2/y.md': 'y\n',
    });
  });

  after(async function () {
    await client.close();
  });

  it('vault_rename fails with "Destination file already exists!"', async function () {
    const text = await callToolError(client, 'vault_rename', { path: 'dest/a.md', newName: 'b.md' });
    expect(text).toContain('Destination file already exists!');
    expect(await readFromDisk('dest/a.md')).toBe('A\n');
    expect(await readFromDisk('dest/b.md')).toBe('B\n');
  });

  it('vault_move fails with "Destination file already exists!"', async function () {
    const text = await callToolError(client, 'vault_move', { path: 'dest/a.md', newPath: 'dest/b.md' });
    expect(text).toContain('Destination file already exists!');
    expect(await readFromDisk('dest/b.md')).toBe('B\n');
  });

  it('vault_rename_folder onto an existing folder fails with "Destination file already exists!"', async function () {
    const text = await callToolError(client, 'vault_rename_folder', { path: 'dest/f1', newPath: 'dest/f2' });
    expect(text).toContain('Destination file already exists!');
    expect(await readFromDisk('dest/f1/x.md')).toBe('x\n');
    expect(await readFromDisk('dest/f2/x.md')).toBeNull();
  });

  it('vault_copy fails with an EEXIST error', async function () {
    const text = await callToolError(client, 'vault_copy', { sourcePath: 'dest/a.md', destPath: 'dest/b.md' });
    expect(text).toContain('EEXIST: file already exists');
    expect(await readFromDisk('dest/b.md')).toBe('B\n');
  });
});
