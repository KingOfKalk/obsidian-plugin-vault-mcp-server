import { describe, it, expect, beforeEach } from 'vitest';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { FolderNotFoundError } from '../../src/tools/shared/errors';

describe('MockObsidianAdapter', () => {
  let adapter: MockObsidianAdapter;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
  });

  describe('file operations', () => {
    it('should create and read a file', async () => {
      await adapter.createFile('test.md', '# Hello');
      const content = await adapter.readFile('test.md');
      expect(content).toBe('# Hello');
    });

    it('should throw when reading a nonexistent file', async () => {
      await expect(adapter.readFile('missing.md')).rejects.toThrow('File not found');
    });

    it('should throw when creating a file that already exists', async () => {
      await adapter.createFile('test.md', 'content');
      await expect(adapter.createFile('test.md', 'other')).rejects.toThrow('already exists');
    });

    it('should modify an existing file', async () => {
      await adapter.createFile('test.md', 'old');
      await adapter.modifyFile('test.md', 'new');
      const content = await adapter.readFile('test.md');
      expect(content).toBe('new');
    });

    it('should throw when modifying a nonexistent file', async () => {
      await expect(adapter.modifyFile('missing.md', 'data')).rejects.toThrow('File not found');
    });

    it('should delete a file', async () => {
      await adapter.createFile('test.md', 'content');
      await adapter.deleteFile('test.md');
      await expect(adapter.readFile('test.md')).rejects.toThrow('File not found');
    });

    it('should throw when deleting a nonexistent file', async () => {
      await expect(adapter.deleteFile('missing.md')).rejects.toThrow('File not found');
    });

    it('should rename a file', async () => {
      await adapter.createFile('old.md', 'content');
      await adapter.renameFile('old.md', 'new.md');
      const content = await adapter.readFile('new.md');
      expect(content).toBe('content');
      await expect(adapter.readFile('old.md')).rejects.toThrow('File not found');
    });

    it('should copy a file', async () => {
      await adapter.createFile('source.md', 'content');
      await adapter.copyFile('source.md', 'dest.md');
      expect(await adapter.readFile('source.md')).toBe('content');
      expect(await adapter.readFile('dest.md')).toBe('content');
    });

    it('should throw when copying a nonexistent file', async () => {
      await expect(adapter.copyFile('missing.md', 'dest.md')).rejects.toThrow('File not found');
    });
  });

  describe('binary operations', () => {
    it('should write and read binary data', async () => {
      const data = new Uint8Array([1, 2, 3, 4]).buffer;
      await adapter.writeBinary('test.bin', data);
      const result = await adapter.readBinary('test.bin');
      expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should overwrite existing binary data', async () => {
      const data1 = new Uint8Array([1, 2]).buffer;
      const data2 = new Uint8Array([3, 4, 5]).buffer;
      await adapter.writeBinary('test.bin', data1);
      await adapter.writeBinary('test.bin', data2);
      const result = await adapter.readBinary('test.bin');
      expect(new Uint8Array(result)).toEqual(new Uint8Array([3, 4, 5]));
    });
  });

  describe('folder operations', () => {
    it('should create a folder', async () => {
      await adapter.createFolder('notes');
      expect(await adapter.exists('notes')).toBe(true);
    });

    it('should throw when creating a folder that already exists', async () => {
      await adapter.createFolder('notes');
      await expect(adapter.createFolder('notes')).rejects.toThrow('already exists');
    });

    it('should delete an empty folder', async () => {
      await adapter.createFolder('notes');
      await adapter.deleteFolder('notes', false);
      expect(await adapter.exists('notes')).toBe(false);
    });

    it('should throw when deleting a non-empty folder without recursive', async () => {
      await adapter.createFolder('notes');
      await adapter.createFile('notes/test.md', 'content');
      await expect(adapter.deleteFolder('notes', false)).rejects.toThrow('not empty');
    });

    it('should delete a non-empty folder with recursive', async () => {
      await adapter.createFolder('notes');
      await adapter.createFile('notes/test.md', 'content');
      await adapter.deleteFolder('notes', true);
      expect(await adapter.exists('notes')).toBe(false);
      expect(await adapter.exists('notes/test.md')).toBe(false);
    });

    it('should throw when deleting a nonexistent folder', async () => {
      await expect(adapter.deleteFolder('missing', false)).rejects.toThrow('Folder not found');
    });
  });

  describe('query operations', () => {
    it('should check existence of files', async () => {
      expect(await adapter.exists('test.md')).toBe(false);
      await adapter.createFile('test.md', 'content');
      expect(await adapter.exists('test.md')).toBe(true);
    });

    it('should check existence of folders', async () => {
      expect(await adapter.exists('notes')).toBe(false);
      await adapter.createFolder('notes');
      expect(await adapter.exists('notes')).toBe(true);
    });

    it('should return stat for a file', async () => {
      await adapter.createFile('test.md', 'hello');
      const stat = await adapter.stat('test.md');
      expect(stat).not.toBeNull();
      expect(stat!.size).toBe(5);
      expect(stat!.ctime).toBeGreaterThan(0);
      expect(stat!.mtime).toBeGreaterThan(0);
    });

    it('should return null stat for nonexistent path', async () => {
      const stat = await adapter.stat('missing.md');
      expect(stat).toBeNull();
    });

    it('should list direct children', async () => {
      await adapter.createFolder('notes');
      await adapter.createFile('notes/a.md', 'a');
      await adapter.createFile('notes/b.md', 'b');
      await adapter.createFolder('notes/sub');
      await adapter.createFile('notes/sub/c.md', 'c');

      const result = adapter.list('notes');
      expect(result.files).toEqual(['notes/a.md', 'notes/b.md']);
      expect(result.folders).toEqual(['notes/sub']);
    });

    it('should list recursively', async () => {
      await adapter.createFolder('notes');
      await adapter.createFile('notes/a.md', 'a');
      await adapter.createFolder('notes/sub');
      await adapter.createFile('notes/sub/b.md', 'b');

      const result = adapter.listRecursive('notes');
      expect(result.files).toEqual(['notes/a.md', 'notes/sub/b.md']);
      expect(result.folders).toEqual(['notes/sub']);
    });

    it('should throw when listing a nonexistent folder', () => {
      expect(() => adapter.list('missing')).toThrow('Folder not found');
    });

    it('should throw FolderNotFoundError (typed) when listing a nonexistent folder', () => {
      expect(() => adapter.list('missing')).toThrow(FolderNotFoundError);
    });

    it('getBacklinkLines returns 0-based lines of wikilinks to the target (#408)', () => {
      adapter.addFile('t.md', 'x');
      adapter.addFile('s.md', 'a [[t]]\nb\n[[t|alias]] and [[t#h]]\n[[other]]');
      adapter.setMetadata('s.md', { links: [{ link: 't' }] });
      expect(adapter.getBacklinkLines('t.md')).toEqual([{ path: 's.md', lines: [0, 2] }]);
    });
  });

  describe('tags (#440)', () => {
    it('returns frontmatter-only tags in #tag form', () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { frontmatter: { tags: ['Project', '#nested/child'] } });
      expect(adapter.getTags('a.md')).toEqual(['#Project', '#nested/child']);
    });

    it('reads tags as a string and the singular tag key', () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { frontmatter: { tags: 'a, #b c', tag: 'd' } });
      expect(adapter.getTags('a.md')).toEqual(['#a', '#b', '#c', '#d']);
    });

    it('lists frontmatter tags before inline tags, keeping duplicates', () => {
      adapter.addFile('a.md', 'x');
      adapter.setMetadata('a.md', { frontmatter: { tags: ['p'] }, tags: ['#p', '#q'] });
      expect(adapter.getTags('a.md')).toEqual(['#p', '#p', '#q']);
      expect(adapter.getAllTags()).toEqual({
        '#p': { files: ['a.md'], count: 2 },
        '#q': { files: ['a.md'], count: 1 },
      });
    });

    it('picks up tags written through processFrontMatter', async () => {
      adapter.addFile('a.md', 'Body');
      await adapter.processFrontMatter('a.md', (fm) => {
        fm.tags = ['new'];
      });
      expect(adapter.getTags('a.md')).toEqual(['#new']);
    });

    it('throws "File not found" for a missing file, like the real adapter (#447)', () => {
      expect(() => adapter.getTags('missing.md')).toThrow('File not found: missing.md');
    });
  });

  describe('vault info', () => {
    it('should return the vault path', () => {
      expect(adapter.getVaultPath()).toBe('/mock-vault');
    });

    it('should allow setting the vault path', () => {
      adapter.setVaultPath('/custom/path');
      expect(adapter.getVaultPath()).toBe('/custom/path');
    });
  });

  describe('test helpers', () => {
    it('should add files via helper', async () => {
      adapter.addFile('test.md', '# Test');
      const content = await adapter.readFile('test.md');
      expect(content).toBe('# Test');
    });

    it('should add files with custom stat via helper', async () => {
      adapter.addFile('test.md', 'content', { ctime: 1000, mtime: 2000 });
      const stat = await adapter.stat('test.md');
      expect(stat!.ctime).toBe(1000);
      expect(stat!.mtime).toBe(2000);
    });

    it('should add folders via helper', async () => {
      adapter.addFolder('notes');
      expect(await adapter.exists('notes')).toBe(true);
    });
  });

  describe('rename folder', () => {
    it('should rename a folder and move its children', async () => {
      await adapter.createFolder('old');
      await adapter.createFile('old/test.md', 'content');
      await adapter.renameFile('old', 'new');

      expect(await adapter.exists('new')).toBe(true);
      expect(await adapter.exists('old')).toBe(false);
      expect(await adapter.readFile('new/test.md')).toBe('content');
      await expect(adapter.readFile('old/test.md')).rejects.toThrow('File not found');
    });
  });
});

/**
 * The mock must fail where the real adapter (and Obsidian) fails, or unit
 * tests cannot catch handlers that rely on the mock's leniency (#447).
 * The Obsidian error texts are the ones the E2E specs observe.
 */
describe('MockObsidianAdapter matches the real adapter (#447)', () => {
  let adapter: MockObsidianAdapter;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
  });

  it.each([
    ['getFrontmatter', (a: MockObsidianAdapter): unknown => a.getFrontmatter('missing.md')],
    ['getHeadings', (a: MockObsidianAdapter): unknown => a.getHeadings('missing.md')],
    ['getLinks', (a: MockObsidianAdapter): unknown => a.getLinks('missing.md')],
    ['getEmbeds', (a: MockObsidianAdapter): unknown => a.getEmbeds('missing.md')],
    ['getTags', (a: MockObsidianAdapter): unknown => a.getTags('missing.md')],
  ])('%s throws "File not found" for a missing file', (_name, call) => {
    expect(() => call(adapter)).toThrow('File not found: missing.md');
  });

  it('renameFile refuses an existing destination file and changes nothing', async () => {
    adapter.addFile('a.md', 'A');
    adapter.addFile('b.md', 'B');
    await expect(adapter.renameFile('a.md', 'b.md')).rejects.toThrow(
      'Destination file already exists!',
    );
    expect(await adapter.readFile('a.md')).toBe('A');
    expect(await adapter.readFile('b.md')).toBe('B');
  });

  it('renameFile refuses an existing destination folder', async () => {
    adapter.addFile('a.md', 'A');
    adapter.addFolder('taken');
    await expect(adapter.renameFile('a.md', 'taken')).rejects.toThrow(
      'Destination file already exists!',
    );
    expect(await adapter.readFile('a.md')).toBe('A');
  });

  it('renameFile refuses to move a folder onto an existing folder', async () => {
    adapter.addFile('f1/x.md', 'x');
    adapter.addFile('f2/y.md', 'y');
    await expect(adapter.renameFile('f1', 'f2')).rejects.toThrow(
      'Destination file already exists!',
    );
    expect(await adapter.readFile('f1/x.md')).toBe('x');
    expect(await adapter.exists('f2/x.md')).toBe(false);
  });

  it('copyFile refuses an existing destination and changes nothing', async () => {
    adapter.addFile('a.md', 'A');
    adapter.addFile('b.md', 'B');
    await expect(adapter.copyFile('a.md', 'b.md')).rejects.toThrow('EEXIST: file already exists');
    expect(await adapter.readFile('b.md')).toBe('B');
  });

  describe('editor positions (CodeMirror semantics)', () => {
    it('replaceRange accepts toLine == lineCount as the end of the document', () => {
      adapter.setActiveEditor('a.md', 'A\nline2');
      expect(adapter.replaceRange(1, 0, 2, 0, 'Z')).toBe(true);
      expect(adapter.getActiveFileContent()).toBe('A\nZ');
    });

    it('insertTextAt at line == lineCount appends at the end of the document', () => {
      adapter.setActiveEditor('a.md', 'A\nZ');
      expect(adapter.insertTextAt(2, 0, 'Q')).toBe(true);
      expect(adapter.getActiveFileContent()).toBe('A\nZQ');
    });

    it('deleteRange to the end of the document removes the trailing lines', () => {
      adapter.setActiveEditor('a.md', 'one\ntwo\nthree');
      expect(adapter.deleteRange(0, 3, 3, 0)).toBe(true);
      expect(adapter.getActiveFileContent()).toBe('one');
    });

    it('replaceRange counts ch past the line end into the next line, like CodeMirror', () => {
      adapter.setActiveEditor('a.md', 'ab\ncd');
      // (0, 4) is offset 4: past "ab\n", one character into "cd".
      expect(adapter.replaceRange(0, 1, 0, 4, '-')).toBe(true);
      expect(adapter.getActiveFileContent()).toBe('a-d');
    });

    it('replaceRange throws for a range past the end of the document', () => {
      adapter.setActiveEditor('a.md', 'A\nZQ');
      expect(() => adapter.replaceRange(0, 50, 1, 99, 'W')).toThrow(
        'Invalid change range 50 to 101 (in doc of length 4)',
      );
      expect(adapter.getActiveFileContent()).toBe('A\nZQ');
    });
  });
});

describe('MockObsidianAdapter root traversal', () => {
  it('listRecursive("") walks the entire vault (real Obsidian convention)', () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');
    adapter.addFile('notes/b.md', 'b');

    const result = adapter.listRecursive('');

    expect(result.files.sort()).toEqual(['a.md', 'notes/b.md']);
    expect(result.folders).toContain('notes');
  });

  it('list("") returns only the direct children of the vault root (depth filter)', () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');
    adapter.addFile('notes/b.md', 'b');

    const result = adapter.list('');

    expect(result.files).toContain('a.md');
    expect(result.files).not.toContain('notes/b.md');
    expect(result.folders).toContain('notes');
  });

  it('list("/") still walks the root for backward compatibility', () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');
    const result = adapter.list('/');
    expect(result.files).toContain('a.md');
    expect(result.folders).toContain('notes');
  });

  it('listRecursive("/") still walks the entire vault for backward compatibility', () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');
    adapter.addFile('notes/b.md', 'b');
    const result = adapter.listRecursive('/');
    expect(result.files.sort()).toEqual(['a.md', 'notes/b.md']);
    expect(result.folders).toContain('notes');
  });
});

describe('getDailyNotesSettings', () => {
  it('returns null by default', () => {
    const adapter = new MockObsidianAdapter();
    expect(adapter.getDailyNotesSettings()).toBeNull();
  });

  it('returns the value passed to setDailyNotesSettings', () => {
    const adapter = new MockObsidianAdapter();
    adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: 'Daily', template: 'templates/daily.md' });
    expect(adapter.getDailyNotesSettings()).toEqual({
      format: 'YYYY-MM-DD',
      folder: 'Daily',
      template: 'templates/daily.md',
    });
  });

  it('can be reset to null', () => {
    const adapter = new MockObsidianAdapter();
    adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
    adapter.setDailyNotesSettings(null);
    expect(adapter.getDailyNotesSettings()).toBeNull();
  });
});
