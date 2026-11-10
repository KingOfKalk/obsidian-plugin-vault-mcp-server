import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { callToolError, connectClient, readFromDisk, startMcpServer, writeNotes } from '../helpers';

/**
 * Obsidian refuses to rename, move or copy onto an existing path; nothing
 * is overwritten. `MockObsidianAdapter` throws the same errors, so unit
 * tests see what real Obsidian does (#447). The tools replace Obsidian's
 * raw "Destination file already exists!" / "EEXIST" with an error that
 * names the destination and the next step (#463).
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

  it('vault_rename fails with "Destination already exists"', async function () {
    const text = await callToolError(client, 'vault_rename', { path: 'dest/a.md', newName: 'b.md' });
    expect(text).toBe(
      'Error: Destination already exists: dest/b.md. Choose another path or delete it first; nothing was changed.',
    );
    expect(await readFromDisk('dest/a.md')).toBe('A\n');
    expect(await readFromDisk('dest/b.md')).toBe('B\n');
  });

  it('vault_move fails with "Destination already exists"', async function () {
    const text = await callToolError(client, 'vault_move', { path: 'dest/a.md', newPath: 'dest/b.md' });
    expect(text).toContain('Destination already exists: dest/b.md.');
    expect(await readFromDisk('dest/b.md')).toBe('B\n');
  });

  it('vault_move of a folder onto an existing folder fails with "Destination already exists"', async function () {
    const text = await callToolError(client, 'vault_move', { path: 'dest/f1', newPath: 'dest/f2' });
    expect(text).toContain('Destination already exists: dest/f2.');
    expect(await readFromDisk('dest/f1/x.md')).toBe('x\n');
    expect(await readFromDisk('dest/f2/x.md')).toBeNull();
  });

  it('vault_rename of a folder onto an existing folder fails with "Destination already exists"', async function () {
    const text = await callToolError(client, 'vault_rename', { path: 'dest/f1', newName: 'f2' });
    expect(text).toContain('Destination already exists: dest/f2.');
    expect(await readFromDisk('dest/f1/x.md')).toBe('x\n');
    expect(await readFromDisk('dest/f2/x.md')).toBeNull();
  });

  it('vault_copy fails with "Destination already exists" instead of EEXIST', async function () {
    const text = await callToolError(client, 'vault_copy', { sourcePath: 'dest/a.md', destPath: 'dest/b.md' });
    expect(text).toContain('Destination already exists: dest/b.md.');
    expect(text).not.toContain('EEXIST');
    expect(text).not.toContain('<path>');
    expect(await readFromDisk('dest/b.md')).toBe('B\n');
  });
});

/** Errors that name the next step (#463). */
describe('error hints', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({ 'hints/Atlas.md': 'Atlas\n' });
  });

  after(async function () {
    await client.close();
  });

  it('vault_read without the extension suggests the .md path', async function () {
    const text = await callToolError(client, 'vault_read', { path: 'hints/Atlas' });
    expect(text).toBe('Error: File not found: hints/Atlas. Did you mean hints/Atlas.md?');
  });

  it('vault_read of a path with no .md twin has no suggestion', async function () {
    const text = await callToolError(client, 'vault_read', { path: 'hints/Nothing' });
    expect(text).toBe('Error: File not found: hints/Nothing');
  });

  it('vault_move without the extension suggests the .md path', async function () {
    const text = await callToolError(client, 'vault_move', { path: 'hints/Atlas', newPath: 'hints/x.md' });
    expect(text).toBe('Error: Path not found: hints/Atlas. Did you mean hints/Atlas.md?');
  });

  it('vault_write_binary names a trailing newline in the base64 data', async function () {
    const text = await callToolError(client, 'vault_write_binary', {
      path: 'hints/bin.dat',
      data: 'SGVsbG8=\n',
    });
    expect(text).toContain('trailing newline');
    expect(await readFromDisk('hints/bin.dat')).toBeNull();
  });
});
