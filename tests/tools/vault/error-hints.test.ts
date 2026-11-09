import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/server';
import { App, TFile } from 'obsidian';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { RealObsidianAdapter } from '../../../src/obsidian/adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import { createEditorModule } from '../../../src/tools/editor/index';
import { writeBinarySchema } from '../../../src/tools/vault/schemas';
import {
  DestinationExistsError,
  FileNotFoundError,
  handleToolError,
  isDestinationExistsError,
  markdownCandidate,
  withDestinationCheck,
} from '../../../src/tools/shared/errors';
import { base64Schema } from '../../../src/utils/validation';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  return item.type === 'text' ? item.text : '';
}

/** Errors that name the next step (#463). */
describe('error hints (#463)', () => {
  describe('markdownCandidate', () => {
    it.each([
      ['projects/Atlas', 'projects/Atlas.md'],
      ['Atlas', 'Atlas.md'],
      ['notes/v1.2', 'notes/v1.2.md'],
    ])('%s -> %s', (path, expected) => {
      expect(markdownCandidate(path)).toBe(expected);
    });

    it.each(['a.md', 'a.MD', '', 'folder/'])('no candidate for %j', (path) => {
      expect(markdownCandidate(path)).toBeNull();
    });
  });

  describe('FileNotFoundError', () => {
    it('keeps the plain message without a suggestion', () => {
      expect(new FileNotFoundError('a').message).toBe('File not found: a');
    });

    it('appends "Did you mean" with a suggestion', () => {
      expect(new FileNotFoundError('a', 'a.md').message).toBe(
        'File not found: a. Did you mean a.md?',
      );
    });
  });

  describe('destination exists', () => {
    it.each([
      'Destination file already exists!',
      "EEXIST: file already exists, copyfile '/x/a.md' -> '/x/b.md'",
    ])('recognises %j', (message) => {
      expect(isDestinationExistsError(new Error(message))).toBe(true);
    });

    it('ignores other errors', () => {
      expect(isDestinationExistsError(new Error('File not found: a.md'))).toBe(false);
      expect(isDestinationExistsError('boom')).toBe(false);
    });

    it('withDestinationCheck maps the error and passes others through', async () => {
      await expect(
        withDestinationCheck('b.md', () =>
          Promise.reject(new Error('Destination file already exists!')),
        ),
      ).rejects.toBeInstanceOf(DestinationExistsError);
      await expect(
        withDestinationCheck('b.md', () => Promise.reject(new Error('other'))),
      ).rejects.toThrow('other');
      await expect(withDestinationCheck('b.md', () => Promise.resolve(3))).resolves.toBe(3);
    });

    it('handleToolError renders the hint', () => {
      const result = handleToolError(new DestinationExistsError('dest/b.md'));
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe(
        'Error: Destination already exists: dest/b.md. Choose another path or delete it first; nothing was changed.',
      );
    });
  });

  describe('vault tools', () => {
    let adapter: MockObsidianAdapter;
    let handlers: ReturnType<typeof createHandlers>;

    beforeEach(() => {
      adapter = new MockObsidianAdapter();
      handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
    });

    it('vault_read suggests the .md path when it exists', async () => {
      adapter.addFile('projects/Atlas.md', 'x');
      const result = await handlers.readFile({ path: 'projects/Atlas' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe(
        'Error: File not found: projects/Atlas. Did you mean projects/Atlas.md?',
      );
    });

    it('vault_read gives no suggestion when the .md file does not exist', async () => {
      const result = await handlers.readFile({ path: 'projects/Atlas' });
      expect(getText(result)).toBe('Error: File not found: projects/Atlas');
    });

    it('metadata of a missing path suggests the .md path', async () => {
      adapter.addFile('Atlas.md', 'x');
      const result = await handlers.getMetadata({ path: 'Atlas' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe('Error: File not found: Atlas. Did you mean Atlas.md?');
    });

    it('expectedMtime on a missing path suggests the .md path', async () => {
      adapter.addFile('Atlas.md', 'x');
      const result = await handlers.updateFile({
        path: 'Atlas',
        content: 'y',
        expectedMtime: new Date().toISOString(),
      });
      expect(getText(result)).toContain('Did you mean Atlas.md?');
    });

    it('vault_move suggests the .md path for a missing source', async () => {
      adapter.addFile('Atlas.md', 'x');
      const result = await handlers.moveFile({ path: 'Atlas', newPath: 'b.md' });
      expect(getText(result)).toBe('Error: Path not found: Atlas. Did you mean Atlas.md?');
    });

    it('vault_move onto an existing file names the destination', async () => {
      adapter.addFile('a.md', 'A');
      adapter.addFile('b.md', 'B');
      const result = await handlers.moveFile({ path: 'a.md', newPath: 'b.md' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe(
        'Error: Destination already exists: b.md. Choose another path or delete it first; nothing was changed.',
      );
      expect(await adapter.readFile('a.md')).toBe('A');
    });

    it('vault_rename onto an existing file names the destination', async () => {
      adapter.addFile('n/a.md', 'A');
      adapter.addFile('n/b.md', 'B');
      const result = await handlers.renameFile({ path: 'n/a.md', newName: 'b.md' });
      expect(getText(result)).toContain('Destination already exists: n/b.md.');
    });

    it('vault_rename_folder onto an existing folder names the destination', async () => {
      adapter.addFile('f1/x.md', 'x');
      adapter.addFile('f2/y.md', 'y');
      const result = await handlers.renameFolder({ path: 'f1', newPath: 'f2' });
      expect(getText(result)).toContain('Destination already exists: f2.');
    });

    it('vault_copy onto an existing file names the destination instead of EEXIST', async () => {
      adapter.addFile('a.md', 'A');
      adapter.addFile('b.md', 'B');
      const result = await handlers.copyFile({ sourcePath: 'a.md', destPath: 'b.md' });
      expect(getText(result)).toContain('Destination already exists: b.md.');
      expect(getText(result)).not.toContain('EEXIST');
    });
  });

  describe('RealObsidianAdapter', () => {
    function makeAdapter(paths: string[]): RealObsidianAdapter {
      const files = new Map(
        paths.map((p) => {
          const f = new TFile();
          f.path = p;
          return [p, f] as const;
        }),
      );
      const app = new App();
      (app as unknown as { vault: unknown }).vault = {
        getAbstractFileByPath: (path: string): TFile | null => files.get(path) ?? null,
      };
      return new RealObsidianAdapter(app);
    }

    it('readFile suggests the .md path when it exists', async () => {
      await expect(makeAdapter(['projects/Atlas.md']).readFile('projects/Atlas')).rejects.toThrow(
        'File not found: projects/Atlas. Did you mean projects/Atlas.md?',
      );
    });

    it('readFile keeps the plain message otherwise', async () => {
      await expect(makeAdapter([]).readFile('projects/Atlas')).rejects.toThrow(
        /^File not found: projects\/Atlas$/,
      );
    });

    it('renameFile suggests the .md path for a missing source', async () => {
      await expect(makeAdapter(['Atlas.md']).renameFile('Atlas', 'b.md')).rejects.toThrow(
        'Path not found: Atlas. Did you mean Atlas.md?',
      );
    });

    it('renameFile keeps "Path not found" otherwise', async () => {
      await expect(makeAdapter([]).renameFile('Atlas', 'b.md')).rejects.toThrow(
        /^Path not found: Atlas$/,
      );
    });
  });

  describe('editor tools', () => {
    it.each(['editor_get_content', 'editor_insert', 'editor_get_line_count'])(
      '%s says how to proceed without an active editor',
      async (name) => {
        const tool = createEditorModule(new MockObsidianAdapter())
          .tools()
          .find((t) => t.name === name)!;
        const result = await tool.handler({ line: 0, ch: 0, text: 'x' });
        expect(result.isError).toBe(true);
        expect(getText(result)).toMatch(/^Error: No active editor\. Open the note in Obsidian/);
        expect(getText(result)).toContain('vault_* tools');
      },
    );

    it('editor_get_selection says how to proceed without an active editor', async () => {
      const tool = createEditorModule(new MockObsidianAdapter())
        .tools()
        .find((t) => t.name === 'editor_get_selection')!;
      const result = await tool.handler({});
      expect(getText(result)).toContain(
        'No active editor or selection. Open the note in Obsidian',
      );
    });
  });

  describe('base64', () => {
    it('says a trailing newline is the problem', () => {
      const parsed = base64Schema.safeParse('SGVsbG8=\n');
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toContain('whitespace or a line break');
      expect(parsed.error?.issues[0].message).toContain('trailing newline');
    });

    it('says so for whitespace inside the data too', () => {
      const parsed = base64Schema.safeParse('SGVs bG8=');
      expect(parsed.error?.issues[0].message).toContain('whitespace');
    });

    it('keeps the plain message for other invalid characters', () => {
      const parsed = base64Schema.safeParse('invalid!@#');
      expect(parsed.error?.issues[0].message).toBe('Invalid base64 string');
    });

    it('vault_write_binary data reports the newline', () => {
      const parsed = writeBinarySchema.data.safeParse('SGVsbG8=\n');
      expect(parsed.error?.issues[0].message).toContain('trailing newline');
    });
  });
});
