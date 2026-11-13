import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  callTool,
  connectClient,
  readFromDisk,
  setVaultConfig,
  startMcpServer,
  waitForCache,
  writeNotes,
} from '../helpers';

interface DeleteResult {
  path: string;
  deleted: boolean;
  trashedTo: 'system' | 'vault' | 'permanent' | 'unknown';
}

/**
 * `vault_delete` reports `trashedTo` from the "Deleted files" setting
 * (`trashOption`, #430). Obsidian honours that setting through
 * `fileManager.trashFile` (since 1.6.6, below the minAppVersion, #557).
 */
describe('vault_delete: trashedTo follows the vault config', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
  });

  after(async function () {
    await client.close();
  });

  async function deleteNote(name: string): Promise<DeleteResult> {
    const path = `delete/${name}.md`;
    await writeNotes({ [path]: `# ${name}\n` });
    await waitForCache([path]);
    const result = await callTool<DeleteResult>(client, 'vault_delete', { path });
    expect(result).toMatchObject({ path, deleted: true });
    expect(await readFromDisk(path)).toBeNull();
    return result;
  }

  it('"Move to Obsidian trash" (local): reports "vault" and the file is in .trash', async function () {
    await setVaultConfig('trashOption', 'local');
    const result = await deleteNote('Local');
    expect(result.trashedTo).toBe('vault');
    expect(await readFromDisk('.trash/Local.md')).toBe('# Local\n');
  });

  it('"Permanently delete" (none): reports "permanent" and nothing lands in .trash', async function () {
    await setVaultConfig('trashOption', 'none');
    const result = await deleteNote('Gone');
    expect(result.trashedTo).toBe('permanent');
    expect(await readFromDisk('.trash/Gone.md')).toBeNull();
  });

  it('"Move to system trash" (system): reports "system"', async function () {
    // Where the system trash lives on a headless runner is not checked.
    await setVaultConfig('trashOption', 'system');
    const result = await deleteNote('System');
    expect(result.trashedTo).toBe('system');
  });
});
