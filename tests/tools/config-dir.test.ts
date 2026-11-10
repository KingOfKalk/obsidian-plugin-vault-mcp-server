import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { createVaultModule } from '../../src/tools/vault/index';
import { createTemplatesModule } from '../../src/tools/templates/index';
import { createWorkspaceModule } from '../../src/tools/workspace/index';
import { createIndexHandler } from '../../src/server/resources';
import {
  createExpandTemplateHandler,
  createFindRelatedHandler,
  createFixBrokenLinksHandler,
  createSummarizeNoteHandler,
} from '../../src/server/prompts';
import { ConfigDirError } from '../../src/utils/path-guard';
import { Logger } from '../../src/utils/logger';
import type { ToolModule } from '../../src/registry/types';

/**
 * #462: no tool, prompt or resource may read or write inside the vault's
 * config folder (`app.vault.configDir`). The mock adapter keeps files there
 * like any other folder, so without the guard every call below would work.
 */

const BLOCKED = 'Path is inside the Obsidian config folder (.obsidian)';
const KEY_FILE = '.obsidian/plugins/vault-mcp-server/data.json';
const KEY_JSON = '{"accessKey":"secret"}';

function getText(r: CallToolResult): string {
  const first = r.content[0];
  return first.type === 'text' ? first.text : '';
}

function tool(module: ToolModule, name: string): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const found = module.tools().find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return (args) => found.handler(args);
}

describe('config folder block (#462)', () => {
  let adapter: MockObsidianAdapter;
  let vault: ToolModule;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    adapter.addFile(KEY_FILE, KEY_JSON);
    adapter.addFile('.obsidian/app.json', '{}');
    adapter.addFile('notes/a.md', '# A\n');
    vault = createVaultModule(adapter);
  });

  const calls: Array<[string, Record<string, unknown>]> = [
    ['vault_read', { path: KEY_FILE }],
    ['vault_read', { path: '.Obsidian/plugins/vault-mcp-server/data.json' }],
    ['vault_read', { path: '/./.obsidian//app.json' }],
    ['vault_read_binary', { path: KEY_FILE }],
    ['vault_get_metadata', { path: KEY_FILE }],
    ['vault_get_aspect', { path: '.obsidian/app.json', aspect: 'frontmatter' }],
    ['vault_create', { path: '.obsidian/plugins/evil/main.js', content: 'evil' }],
    ['vault_update', { path: KEY_FILE, content: '{}' }],
    ['vault_append', { path: '.obsidian/app.json', content: 'x' }],
    ['vault_replace', { path: '.obsidian/app.json', oldString: '{}', newString: '[]' }],
    ['vault_insert', { path: '.obsidian/app.json', heading: 'A', text: 'x' }],
    ['vault_set_frontmatter', { path: '.obsidian/x.md', set: { a: 1 } }],
    ['vault_write_binary', { path: KEY_FILE, data: 'e30=' }],
    ['vault_delete', { path: KEY_FILE }],
    ['vault_rename', { path: '.obsidian/app.json', newName: 'b.json' }],
    ['vault_move', { path: 'notes/a.md', newPath: '.obsidian/a.md' }],
    ['vault_move', { path: '.obsidian/app.json', newPath: 'notes/app.json' }],
    ['vault_copy', { sourcePath: KEY_FILE, destPath: 'notes/leak.json' }],
    ['vault_copy', { sourcePath: 'notes/a.md', destPath: '.obsidian/a.md' }],
    ['vault_create_folder', { path: '.obsidian/new' }],
    ['vault_delete_folder', { path: '.obsidian', recursive: true }],
    ['vault_move', { path: 'notes', newPath: '.obsidian/notes' }],
    ['vault_move', { path: '.obsidian', newPath: 'config' }],
    ['vault_rename', { path: '.obsidian', newName: 'config' }],
    ['vault_list', { path: '.obsidian' }],
    ['vault_list_recursive', { path: '.obsidian/plugins' }],
  ];

  it.each(calls)('%s %j is rejected', async (name, args) => {
    const result = await tool(vault, name)(args);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain(BLOCKED);
  });

  it('nothing in the config folder or the vault changed', async () => {
    for (const [name, args] of calls) await tool(vault, name)(args);
    expect(await adapter.readFile(KEY_FILE)).toBe(KEY_JSON);
    expect(await adapter.exists('.obsidian/plugins/evil/main.js')).toBe(false);
    expect(await adapter.exists('.obsidian/a.md')).toBe(false);
    expect(await adapter.exists('notes/leak.json')).toBe(false);
    expect(await adapter.exists('notes/a.md')).toBe(true);
  });

  it('vault_rename cannot rename a root file to the config folder name', async () => {
    adapter.addFile('top.md', 'x');
    const result = await tool(vault, 'vault_rename')({ path: 'top.md', newName: '.obsidian' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain(BLOCKED);
  });

  it('vault_list and vault_list_recursive of the root leave the config folder out', async () => {
    const list = await tool(vault, 'vault_list')({ path: '/' });
    const flat = JSON.parse(getText(list)) as { files: string[]; folders: string[] };
    expect(flat.folders).toEqual(['notes']);
    expect(flat.files).toEqual([]);

    const recursive = await tool(vault, 'vault_list_recursive')({ path: '' });
    const deep = JSON.parse(getText(recursive)) as { folders: string[]; items: string[] };
    expect(deep.folders).toEqual(['notes']);
    expect(deep.items).toEqual(['notes/a.md']);
  });

  it('uses the adapter\'s config folder, not a hard-coded .obsidian', async () => {
    const custom = new MockObsidianAdapter();
    custom.setConfigDir('.config');
    custom.addFile('.config/app.json', '{}');
    custom.addFile('.obsidian/note.md', 'not the config folder here');
    const module = createVaultModule(custom);
    const blocked = await tool(module, 'vault_read')({ path: '.config/app.json' });
    expect(blocked.isError).toBe(true);
    expect(getText(blocked)).toContain('Path is inside the Obsidian config folder (.config)');
    const allowed = await tool(module, 'vault_read')({ path: '.obsidian/note.md' });
    expect(allowed.isError).toBeUndefined();
  });

  it('template_create_from rejects a template or destination in the config folder', async () => {
    adapter.addFile('templates/t.md', 'T');
    const templates = createTemplatesModule(adapter);
    const create = tool(templates, 'template_create_from');
    for (const args of [
      { templatePath: KEY_FILE, destPath: 'notes/leak.md' },
      { templatePath: 'templates/t.md', destPath: '.obsidian/t.md' },
    ]) {
      const result = await create(args);
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain(BLOCKED);
    }
    expect(await adapter.exists('notes/leak.md')).toBe(false);
    expect(await adapter.exists('.obsidian/t.md')).toBe(false);
  });

  it('workspace_open_file rejects a file in the config folder', async () => {
    const workspace = createWorkspaceModule(adapter);
    const result = await tool(workspace, 'workspace_open_file')({ path: '.obsidian/app.json' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain(BLOCKED);
  });

  it('prompts reject a path in the config folder', async () => {
    await expect(createSummarizeNoteHandler(adapter)({ path: KEY_FILE })).rejects.toBeInstanceOf(ConfigDirError);
    await expect(createFindRelatedHandler(adapter)({ path: KEY_FILE })).rejects.toBeInstanceOf(ConfigDirError);
    await expect(createExpandTemplateHandler(adapter)({ template: KEY_FILE })).rejects.toBeInstanceOf(
      ConfigDirError,
    );
    await expect(createFixBrokenLinksHandler(adapter)({ path: KEY_FILE })).rejects.toBeInstanceOf(
      ConfigDirError,
    );
  });

  it('the obsidian://vault/index resource leaves the config folder out', async () => {
    const handler = createIndexHandler(adapter, new Logger('test', { debugMode: false, accessKey: '' }));
    const result = await handler(new URL('obsidian://vault/index'));
    const text = (result.contents[0] as { text: string }).text;
    expect(text).not.toContain('.obsidian');
    expect(text).toContain('notes/a.md');
  });
});

describe('entry points use validateToolPath (#462)', () => {
  it('no source file outside path-guard.ts calls validateVaultPath directly', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (full.endsWith('.ts') && !full.endsWith(join('utils', 'path-guard.ts'))) {
          if (/\bvalidateVaultPath\(/.test(readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
