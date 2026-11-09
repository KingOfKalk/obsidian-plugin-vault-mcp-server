import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import type { TrashDestination } from '../../../src/obsidian/adapter';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  return item.type === 'text' ? item.text : '';
}

describe('rename/move link report and delete destination (#430)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  /** Add a note whose content and metadata links agree. */
  function addNote(path: string, content: string, links: string[] = []): void {
    adapter.addFile(path, content);
    adapter.setMetadata(path, { links: links.map((link) => ({ link })) });
  }

  describe('vault_move', () => {
    it('reports links and files updated when the setting is on', async () => {
      addNote('notes/target.md', 'target');
      addNote('index.md', 'See [[notes/target]] and [[notes/target|alias]].', [
        'notes/target',
        'notes/target',
      ]);
      addNote('other.md', 'Also [[notes/target]].', ['notes/target']);
      addNote('unrelated.md', 'Nothing here.');

      const result = await handlers.moveFile({ path: 'notes/target.md', newPath: 'archive/target.md' });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        from: 'notes/target.md',
        to: 'archive/target.md',
        linksUpdated: 3,
        updatedFiles: ['index.md', 'other.md'],
        autoUpdateLinks: true,
      });
      expect(getText(result)).toContain('Updated 3 links in 2 files: index.md, other.md');
      expect(await adapter.readFile('index.md')).toBe('See [[archive/target]] and [[archive/target|alias]].');
    });

    it('warns and reports nothing updated when the setting is off', async () => {
      adapter.setAutoUpdateLinks(false);
      addNote('notes/target.md', 'target');
      addNote('index.md', 'See [[notes/target]].', ['notes/target']);

      const result = await handlers.moveFile({ path: 'notes/target.md', newPath: 'archive/target.md' });

      expect(result.structuredContent).toMatchObject({
        linksUpdated: 0,
        updatedFiles: [],
        autoUpdateLinks: false,
      });
      const warning = (result.structuredContent as { warning?: string }).warning;
      expect(warning).toContain('"Automatically update internal links" is off');
      expect(warning).toContain('1 file links to notes/target.md');
      expect(getText(result)).toContain('Warning:');
      expect(await adapter.readFile('index.md')).toBe('See [[notes/target]].');
    });

    it('warns when the setting cannot be read and nothing was updated', async () => {
      adapter.setAutoUpdateLinks(null);
      addNote('a.md', 'a');
      addNote('b.md', '[[a]]', ['a']);
      addNote('c.md', '[[a]]', ['a']);

      const result = await handlers.moveFile({ path: 'a.md', newPath: 'x/a.md' });

      const content = result.structuredContent as { autoUpdateLinks: unknown; warning?: string };
      expect(content.autoUpdateLinks).toBeNull();
      expect(content.warning).toContain('could not be read and 2 files link to a.md');
    });

    it('reports zero links and no warning for a file with no backlinks', async () => {
      adapter.setAutoUpdateLinks(false);
      addNote('lonely.md', 'alone');

      const result = await handlers.moveFile({ path: 'lonely.md', newPath: 'archive/lonely.md' });

      expect(result.structuredContent).toEqual({
        from: 'lonely.md',
        to: 'archive/lonely.md',
        linksUpdated: 0,
        updatedFiles: [],
        autoUpdateLinks: false,
      });
      expect(getText(result)).toBe('Moved file: lonely.md → archive/lonely.md');
    });

    it('does not count a self-link toward the warning', async () => {
      adapter.setAutoUpdateLinks(false);
      addNote('self.md', 'me: [[self]]', ['self']);

      const result = await handlers.moveFile({ path: 'self.md', newPath: 'x/self.md' });

      expect((result.structuredContent as { warning?: string }).warning).toBeUndefined();
    });
  });

  describe('vault_rename', () => {
    it('reports the updated backlink', async () => {
      addNote('a.md', 'a');
      addNote('b.md', 'link to [[a]]', ['a']);

      const result = await handlers.renameFile({ path: 'a.md', newName: 'c.md' });

      expect(result.structuredContent).toEqual({
        from: 'a.md',
        to: 'c.md',
        linksUpdated: 1,
        updatedFiles: ['b.md'],
        autoUpdateLinks: true,
      });
      expect(getText(result)).toContain('Updated 1 link in 1 file: b.md');
    });
  });

  describe('vault_rename and vault_move on a folder (#447)', () => {
    it('vault_move counts links into every file of the folder', async () => {
      addNote('wip/one.md', 'one, see [[wip/two]]', ['wip/two']);
      addNote('wip/two.md', 'two');
      addNote('index.md', '[[wip/one]] [[wip/two]]', ['wip/one', 'wip/two']);

      const result = await handlers.moveFile({ path: 'wip', newPath: 'archive/wip' });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        from: 'wip',
        to: 'archive/wip',
        linksUpdated: 3,
        updatedFiles: ['archive/wip/one.md', 'index.md'],
        autoUpdateLinks: true,
      });
      expect(getText(result)).toContain('Moved folder: wip → archive/wip');
      expect(await adapter.readFile('index.md')).toBe('[[archive/wip/one]] [[archive/wip/two]]');
    });

    it('vault_rename counts links into every file of the folder', async () => {
      addNote('wip/one.md', 'one');
      addNote('index.md', '[[wip/one]]', ['wip/one']);

      const result = await handlers.renameFile({ path: 'wip', newName: 'done' });

      expect(result.structuredContent).toEqual({
        from: 'wip',
        to: 'done',
        linksUpdated: 1,
        updatedFiles: ['index.md'],
        autoUpdateLinks: true,
      });
      expect(getText(result)).toContain('Renamed folder: wip → done');
    });

    it.each(['move', 'rename'] as const)(
      'vault_%s warns when the setting is off and outside files link into the folder',
      async (tool) => {
        adapter.setAutoUpdateLinks(false);
        addNote('wip/one.md', 'one');
        addNote('index.md', '[[wip/one]]', ['wip/one']);

        const result =
          tool === 'move'
            ? await handlers.moveFile({ path: 'wip', newPath: 'done' })
            : await handlers.renameFile({ path: 'wip', newName: 'done' });

        expect(result.structuredContent).toMatchObject({ linksUpdated: 0, updatedFiles: [] });
        expect((result.structuredContent as { warning?: string }).warning).toContain(
          '1 file links to wip',
        );
        expect(await adapter.readFile('index.md')).toBe('[[wip/one]]');
      },
    );
  });

  describe('vault_rename_folder', () => {
    it('counts links into every file of the folder and remaps moved sources', async () => {
      addNote('wip/one.md', 'one, see [[wip/two]]', ['wip/two']);
      addNote('wip/two.md', 'two');
      addNote('index.md', '[[wip/one]] [[wip/two]]', ['wip/one', 'wip/two']);

      const result = await handlers.renameFolder({ path: 'wip', newPath: 'done' });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        from: 'wip',
        to: 'done',
        linksUpdated: 3,
        updatedFiles: ['done/one.md', 'index.md'],
        autoUpdateLinks: true,
      });
      expect(await adapter.readFile('index.md')).toBe('[[done/one]] [[done/two]]');
    });

    it('warns when the setting is off and outside files link into the folder', async () => {
      adapter.setAutoUpdateLinks(false);
      addNote('wip/one.md', 'one');
      addNote('index.md', '[[wip/one]]', ['wip/one']);

      const result = await handlers.renameFolder({ path: 'wip', newPath: 'done' });

      expect(result.structuredContent).toMatchObject({ linksUpdated: 0, updatedFiles: [] });
      expect((result.structuredContent as { warning?: string }).warning).toContain('1 file links to wip');
    });

    it('still reports "not found" for a missing folder', async () => {
      const result = await handlers.renameFolder({ path: 'nope', newPath: 'x' });
      expect(result.isError).toBe(true);
    });
  });

  describe('trashedTo', () => {
    const cases: Array<[TrashDestination, string]> = [
      ['system', ' (moved to the system trash)'],
      ['vault', " (moved to the vault's .trash folder)"],
      ['permanent', ' (deleted permanently)'],
      ['unknown', ''],
    ];

    for (const [destination, suffix] of cases) {
      it(`vault_delete reports "${destination}"`, async () => {
        adapter.setTrashDestination(destination);
        adapter.addFile('old.md', 'x');
        const result = await handlers.deleteFile({ path: 'old.md' });
        expect(result.structuredContent).toEqual({ path: 'old.md', deleted: true, trashedTo: destination });
        expect(getText(result)).toBe(`Deleted file: old.md${suffix}`);
      });

      it(`vault_delete_folder reports "${destination}"`, async () => {
        adapter.setTrashDestination(destination);
        adapter.addFile('drafts/a.md', 'x');
        const result = await handlers.deleteFolder({ path: 'drafts', recursive: true });
        expect(result.structuredContent).toEqual({
          path: 'drafts',
          deleted: true,
          recursive: true,
          trashedTo: destination,
        });
        expect(getText(result)).toBe(`Deleted folder: drafts${suffix}`);
      });
    }
  });
});
