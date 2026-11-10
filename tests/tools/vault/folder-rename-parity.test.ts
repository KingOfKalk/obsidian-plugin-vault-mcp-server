import { describe, it, expect } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';

/**
 * Parity check before `vault_rename_folder` is removed (#468): on the same
 * vault, `vault_move` (path + newPath) and `vault_rename` (same folder, new
 * name) must return exactly what `vault_rename_folder` returned (the link
 * report, the warning, the errors) and leave the same files behind.
 */
type Setup = (adapter: MockObsidianAdapter) => void;

function addNote(adapter: MockObsidianAdapter, path: string, content: string, links: string[] = []): void {
  adapter.addFile(path, content);
  adapter.setMetadata(path, { links: links.map((link) => ({ link })) });
}

function fresh(setup: Setup): {
  adapter: MockObsidianAdapter;
  handlers: ReturnType<typeof createHandlers>;
} {
  const adapter = new MockObsidianAdapter();
  setup(adapter);
  return { adapter, handlers: createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter)) };
}

async function snapshot(adapter: MockObsidianAdapter): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const path of [...adapter.getAllFiles()].sort()) files[path] = await adapter.readFile(path);
  return files;
}

function text(result: CallToolResult): string {
  const item = result.content[0];
  return item.type === 'text' ? item.text : '';
}

const scenarios: Array<[string, Setup, string, string]> = [
  [
    'links into the folder, auto-update on',
    (a): void => {
      addNote(a, 'wip/one.md', 'one, see [[wip/two]]', ['wip/two']);
      addNote(a, 'wip/two.md', 'two');
      addNote(a, 'index.md', '[[wip/one]] [[wip/two]]', ['wip/one', 'wip/two']);
    },
    'wip',
    'done',
  ],
  [
    'links into the folder, auto-update off (warning)',
    (a): void => {
      a.setAutoUpdateLinks(false);
      addNote(a, 'wip/one.md', 'one');
      addNote(a, 'index.md', '[[wip/one]]', ['wip/one']);
    },
    'wip',
    'done',
  ],
  [
    'setting unreadable',
    (a): void => {
      a.setAutoUpdateLinks(null);
      addNote(a, 'wip/one.md', 'one');
      addNote(a, 'index.md', '[[wip/one]]', ['wip/one']);
    },
    'wip',
    'done',
  ],
  [
    'only links inside the folder, auto-update off',
    (a): void => {
      a.setAutoUpdateLinks(false);
      addNote(a, 'wip/one.md', '[[wip/two]]', ['wip/two']);
      addNote(a, 'wip/two.md', 'two');
    },
    'wip',
    'done',
  ],
  ['empty folder', (a): void => a.addFolder('empty'), 'empty', 'renamed'],
  [
    'nested folder renamed in place',
    (a): void => {
      addNote(a, 'p/wip/one.md', 'one');
      addNote(a, 'index.md', '[[p/wip/one]]', ['p/wip/one']);
    },
    'p/wip',
    'p/done',
  ],
  [
    'folder moved into a missing parent',
    (a): void => {
      addNote(a, 'wip/one.md', 'one');
      addNote(a, 'index.md', '[[wip/one]]', ['wip/one']);
    },
    'wip',
    'archive/2026/wip',
  ],
  ['missing folder', (): void => undefined, 'nope', 'x'],
  [
    'destination exists',
    (a): void => {
      a.addFile('f1/x.md', 'x');
      a.addFile('f2/y.md', 'y');
    },
    'f1',
    'f2',
  ],
  ['into the config folder', (a): void => a.addFile('notes/a.md', 'a'), 'notes', '.obsidian/notes'],
  ['out of the config folder', (): void => undefined, '.obsidian', 'config'],
];

describe('vault_move / vault_rename on a folder match vault_rename_folder (#468)', () => {
  it.each(scenarios)('%s', async (_name, setup, path, newPath) => {
    const folder = fresh(setup);
    const move = fresh(setup);
    const expected = await folder.handlers.renameFolder({ path, newPath });
    const moved = await move.handlers.moveFile({ path, newPath });

    expect(moved.isError).toBe(expected.isError);
    expect(moved.structuredContent).toEqual(expected.structuredContent);
    expect(text(moved)).toBe(text(expected));
    expect(await snapshot(move.adapter)).toEqual(await snapshot(folder.adapter));

    // vault_rename keeps the parent folder, so it only covers those cases.
    const parent = (p: string): string => p.split('/').slice(0, -1).join('/');
    if (parent(path) === parent(newPath)) {
      const rename = fresh(setup);
      const renamed = await rename.handlers.renameFile({
        path,
        newName: newPath.split('/').pop() ?? newPath,
      });
      expect(renamed.isError).toBe(expected.isError);
      expect(renamed.structuredContent).toEqual(expected.structuredContent);
      expect(text(renamed)).toBe(text(expected));
      expect(await snapshot(rename.adapter)).toEqual(await snapshot(folder.adapter));
    }
  });
});
