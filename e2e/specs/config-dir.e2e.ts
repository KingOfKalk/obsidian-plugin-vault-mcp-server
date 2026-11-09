import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  callTool,
  callToolError,
  connectClient,
  readFromDisk,
  startMcpServer,
  waitForCache,
  writeNotes,
} from '../helpers';

/**
 * No tool may read or write inside the vault's config folder (#462, R97).
 *
 * Before the block, Obsidian 1.5.3 and 1.15.0 refused most of these calls
 * only by accident: the config folder is not in the vault index, so reads,
 * updates and deletes failed with "File not found", and creating, copying or
 * moving into it failed with "Folder already exists." when the plugin tried
 * to create the existing config folder as a parent. Two calls went through:
 * `vault_create_folder` created a folder inside it, and `vault_get_metadata`
 * returned size and dates of any file in it, e.g. this plugin's data.json.
 * This spec checks that every path tool now fails with the config-folder
 * error and that nothing changed on disk.
 */
describe('config folder is blocked (#462)', function () {
  let client: Client;
  let configDir: string;
  let blocked: string;

  /** Files placed in the config folder behind Obsidian's back. */
  const seeded: Record<string, string> = {};

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    configDir = await browser.executeObsidian(({ app }) => app.vault.configDir);
    blocked = `Path is inside the Obsidian config folder (${configDir})`;
    seeded[`${configDir}/e2e-block/a.md`] = '# original\n';
    seeded[`${configDir}/e2e-block/b.md`] = 'original b\n';
    await browser.executeObsidian(
      async ({ app }, dir, files) => {
        const adapter = app.vault.adapter;
        for (const folder of [`${dir}/e2e-block`, `${dir}/e2e-block-folder`]) {
          if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
        }
        for (const [path, content] of Object.entries(files)) {
          await adapter.write(path, content);
        }
      },
      configDir,
      seeded,
    );
    await writeNotes({ 'block/src.md': 'source\n', 'block/move.md': 'move me\n' });
    await waitForCache(['block/src.md', 'block/move.md']);
  });

  after(async function () {
    await client.close();
  });

  async function existsOnDisk(path: string): Promise<boolean> {
    return browser.executeObsidian(({ app }, p) => app.vault.adapter.exists(p), path);
  }

  async function expectBlocked(name: string, args: Record<string, unknown>): Promise<void> {
    const text = await callToolError(client, name, args);
    expect(text).toContain(blocked);
  }

  it('reads fail: the access key in data.json stays private', async function () {
    const dataJson = `${configDir}/plugins/vault-mcp-server/data.json`;
    expect(await existsOnDisk(dataJson)).toBe(true);
    await expectBlocked('vault_read', { path: dataJson });
    await expectBlocked('vault_read_binary', { path: dataJson });
    await expectBlocked('vault_get_metadata', { path: dataJson });
    await expectBlocked('vault_get_aspect', { path: `${configDir}/e2e-block/a.md`, aspect: 'headings' });
    await expectBlocked('vault_read', { path: `/${configDir.toUpperCase()}/e2e-block/a.md` });
    await expectBlocked('vault_read', { path: `block/../${configDir}/e2e-block/a.md` });
  });

  it('listing the config folder fails, and the root listing leaves it out', async function () {
    await expectBlocked('vault_list', { path: configDir });
    await expectBlocked('vault_list_recursive', { path: `${configDir}/plugins` });
    const root = await callTool<{ files: string[]; folders: string[] }>(client, 'vault_list', { path: '/' });
    const deep = await callTool<{ folders: string[]; items: string[] }>(client, 'vault_list_recursive', {
      path: '',
    });
    for (const entry of [...root.files, ...root.folders, ...deep.folders, ...deep.items]) {
      expect(entry.toLowerCase().startsWith(configDir.toLowerCase())).toBe(false);
    }
    expect(deep.items).toContain('block/src.md');
  });

  it('writes fail and change nothing on disk', async function () {
    const a = `${configDir}/e2e-block/a.md`;
    const b = `${configDir}/e2e-block/b.md`;
    await expectBlocked('vault_create', { path: `${configDir}/plugins/e2e-evil/main.js`, content: 'evil' });
    await expectBlocked('vault_create', { path: a, content: 'overwritten' });
    await expectBlocked('vault_update', { path: a, content: 'overwritten' });
    await expectBlocked('vault_append', { path: a, content: 'appended' });
    await expectBlocked('vault_replace', { path: a, oldString: 'original', newString: 'changed' });
    await expectBlocked('vault_insert', { path: a, heading: 'original', text: 'inserted' });
    await expectBlocked('vault_set_frontmatter', { path: a, set: { x: 1 } });
    await expectBlocked('vault_write_binary', { path: b, data: Buffer.from('binary').toString('base64') });
    await expectBlocked('vault_delete', { path: b });

    expect(await readFromDisk(a)).toBe(seeded[a]);
    expect(await readFromDisk(b)).toBe(seeded[b]);
    expect(await existsOnDisk(`${configDir}/plugins/e2e-evil`)).toBe(false);
  });

  it('rename, move and copy fail for a source or destination in the config folder', async function () {
    const a = `${configDir}/e2e-block/a.md`;
    await expectBlocked('vault_rename', { path: a, newName: 'renamed.md' });
    await writeNotes({ 'top-level.md': 'top\n' });
    await waitForCache(['top-level.md']);
    await expectBlocked('vault_rename', { path: 'top-level.md', newName: configDir });
    await expectBlocked('vault_move', { path: 'block/move.md', newPath: `${configDir}/moved.md` });
    await expectBlocked('vault_move', { path: a, newPath: 'block/out.md' });
    await expectBlocked('vault_copy', { sourcePath: 'block/src.md', destPath: `${configDir}/copied.md` });
    await expectBlocked('vault_copy', {
      sourcePath: `${configDir}/plugins/vault-mcp-server/data.json`,
      destPath: 'block/leak.json',
    });
    await expectBlocked('template_create_from', { templatePath: a, destPath: 'block/from-template.md' });
    await expectBlocked('template_create_from', {
      templatePath: 'block/src.md',
      destPath: `${configDir}/from-template.md`,
    });

    expect(await readFromDisk(a)).toBe(seeded[a]);
    expect(await readFromDisk('block/move.md')).toBe('move me\n');
    expect(await readFromDisk('top-level.md')).toBe('top\n');
    for (const gone of [
      `${configDir}/e2e-block/renamed.md`,
      `${configDir}/moved.md`,
      `${configDir}/copied.md`,
      `${configDir}/from-template.md`,
      'block/out.md',
      'block/leak.json',
      'block/from-template.md',
    ]) {
      expect(await existsOnDisk(gone)).toBe(false);
    }
  });

  it('folder tools fail and change nothing on disk', async function () {
    await expectBlocked('vault_create_folder', { path: `${configDir}/e2e-new-folder` });
    await expectBlocked('vault_delete_folder', { path: `${configDir}/e2e-block-folder`, recursive: true });
    await expectBlocked('vault_rename_folder', {
      path: `${configDir}/e2e-block-folder`,
      newPath: 'block/stolen',
    });
    await expectBlocked('vault_rename_folder', { path: 'block', newPath: `${configDir}/block` });

    expect(await existsOnDisk(`${configDir}/e2e-new-folder`)).toBe(false);
    expect(await existsOnDisk(`${configDir}/e2e-block-folder`)).toBe(true);
    expect(await existsOnDisk('block/stolen')).toBe(false);
    expect(await existsOnDisk('block/src.md')).toBe(true);
  });

  it('workspace_open_file fails', async function () {
    await expectBlocked('workspace_open_file', { path: `${configDir}/e2e-block/a.md` });
  });

  it('the vault resource rejects a URI in the config folder', async function () {
    async function readError(uri: string): Promise<string | null> {
      try {
        await client.readResource({ uri });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
    const message = await readError(
      `obsidian://vault/${configDir}/plugins/vault-mcp-server/data.json`,
    );
    expect(message).not.toBeNull();
    // Older Electron (Obsidian 1.5.3) parses `obsidian://vault/...` without
    // a host, so every resource read fails there with "Unexpected host"
    // before the path is checked. Where an ordinary note can be read, the
    // config-folder URI must fail with the config-folder error.
    if ((await readError('obsidian://vault/block/src.md')) === null) {
      expect(message).toContain(blocked);
    }
  });
});
