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
