import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
}

describe('vault handlers', () => {
  let adapter: MockObsidianAdapter;
  let mutex: WriteMutex;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    mutex = new WriteMutex();
    handlers = createHandlers(adapter, mutex);
  });

  describe('createFile', () => {
    it('should create a file', async () => {
      const result = await handlers.createFile({ path: 'test.md', content: '# Hello' });
      expect(result.isError).toBeUndefined();
      expect(getText(result)).toContain('Created file');
      const content = await adapter.readFile('test.md');
      expect(content).toBe('# Hello');
    });

    it('should reject path traversal', async () => {
      const result = await handlers.createFile({ path: '../etc/passwd', content: 'hack' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Error');
    });

    it('should return error when file already exists', async () => {
      adapter.addFile('test.md', 'existing');
      const result = await handlers.createFile({ path: 'test.md', content: 'new' });
      expect(result.isError).toBe(true);
    });
  });

  describe('readFile', () => {
    it('should read a file', async () => {
      adapter.addFile('test.md', '# Hello World');
      const result = await handlers.readFile({ path: 'test.md' });
      expect(getText(result)).toBe('# Hello World');
    });

    it('should return error for nonexistent file', async () => {
      const result = await handlers.readFile({ path: 'missing.md' });
      expect(result.isError).toBe(true);
    });

    it('should reject path traversal', async () => {
      const result = await handlers.readFile({ path: '../../etc/passwd' });
      expect(result.isError).toBe(true);
    });
  });

  describe('updateFile', () => {
    it('should update a file', async () => {
      adapter.addFile('test.md', 'old');
      const result = await handlers.updateFile({ path: 'test.md', content: 'new' });
      expect(result.isError).toBeUndefined();
      const content = await adapter.readFile('test.md');
      expect(content).toBe('new');
    });

    it('should return error for nonexistent file', async () => {
      const result = await handlers.updateFile({ path: 'missing.md', content: 'data' });
      expect(result.isError).toBe(true);
    });
  });

  describe('deleteFile', () => {
    it('should delete a file', async () => {
      adapter.addFile('test.md', 'content');
      const result = await handlers.deleteFile({ path: 'test.md' });
      expect(result.isError).toBeUndefined();
      expect(await adapter.exists('test.md')).toBe(false);
    });

    it('should return error for nonexistent file', async () => {
      const result = await handlers.deleteFile({ path: 'missing.md' });
      expect(result.isError).toBe(true);
    });
  });

  describe('appendFile', () => {
    it('should append to a file', async () => {
      adapter.addFile('test.md', 'Hello');
      const result = await handlers.appendFile({ path: 'test.md', content: ' World' });
      expect(result.isError).toBeUndefined();
      const content = await adapter.readFile('test.md');
      expect(content).toBe('Hello World');
    });

    it('should return error for nonexistent file', async () => {
      const result = await handlers.appendFile({ path: 'missing.md', content: 'data' });
      expect(result.isError).toBe(true);
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata', async () => {
      adapter.addFile('test.md', 'content', { ctime: 1000, mtime: 2000 });
      const result = await handlers.getMetadata({ path: 'test.md' });
      const data = JSON.parse(getText(result)) as Record<string, unknown>;
      expect(data.path).toBe('test.md');
      expect(data.size).toBe(7);
    });

    it('should return error for nonexistent file', async () => {
      const result = await handlers.getMetadata({ path: 'missing.md' });
      expect(result.isError).toBe(true);
    });
  });

  describe('renameFile', () => {
    it('should rename a file', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({ path: 'notes/old.md', newName: 'new.md' });
      expect(result.isError).toBeUndefined();
      expect(getText(result)).toContain('Renamed');
      const content = await adapter.readFile('notes/new.md');
      expect(content).toBe('content');
    });

    it('should reject path traversal in rename', async () => {
      adapter.addFile('test.md', 'content');
      const result = await handlers.renameFile({ path: '../test.md', newName: 'new.md' });
      expect(result.isError).toBe(true);
    });

    it('should reject newName containing forward slashes', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({
        path: 'notes/old.md',
        newName: 'sub/dir',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe('Error: Invalid rename target');
      // File untouched — still at original path.
      expect(await adapter.readFile('notes/old.md')).toBe('content');
    });

    it('should reject newName attempting directory traversal', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({
        path: 'notes/old.md',
        newName: '../escape',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe('Error: Invalid rename target');
      expect(await adapter.readFile('notes/old.md')).toBe('content');
    });

    it('should reject empty newName', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({
        path: 'notes/old.md',
        newName: '',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe('Error: Invalid rename target');
    });

    it('should reject whitespace-only newName', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({
        path: 'notes/old.md',
        newName: '   ',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe('Error: Invalid rename target');
    });

    it('should reject newName with Windows-style backslashes', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({
        path: 'notes/old.md',
        newName: 'foo\\bar',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe('Error: Invalid rename target');
    });

    it('should reject newName containing null bytes', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({
        path: 'notes/old.md',
        newName: 'foo\0bar',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toBe('Error: Invalid rename target');
    });

    it('should not echo the user-supplied newName in the error', async () => {
      adapter.addFile('notes/old.md', 'content');
      const result = await handlers.renameFile({
        path: 'notes/old.md',
        newName: '../../etc/passwd',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).not.toContain('etc/passwd');
      expect(getText(result)).not.toContain('..');
    });
  });

  describe('moveFile', () => {
    it('should move a file', async () => {
      adapter.addFile('old/test.md', 'content');
      adapter.addFolder('new');
      const result = await handlers.moveFile({ path: 'old/test.md', newPath: 'new/test.md' });
      expect(result.isError).toBeUndefined();
      expect(getText(result)).toContain('Moved');
    });

    it('should reject path traversal in move', async () => {
      const result = await handlers.moveFile({ path: '../test.md', newPath: 'safe.md' });
      expect(result.isError).toBe(true);
    });
  });

  describe('copyFile', () => {
    it('should copy a file', async () => {
      adapter.addFile('source.md', 'content');
      const result = await handlers.copyFile({ sourcePath: 'source.md', destPath: 'dest.md' });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('source.md')).toBe('content');
      expect(await adapter.readFile('dest.md')).toBe('content');
    });

    it('should reject path traversal in copy', async () => {
      const result = await handlers.copyFile({ sourcePath: '../etc/passwd', destPath: 'dest.md' });
      expect(result.isError).toBe(true);
    });
  });

  describe('createFolder', () => {
    it('should create a folder', async () => {
      const result = await handlers.createFolder({ path: 'notes' });
      expect(result.isError).toBeUndefined();
      expect(await adapter.exists('notes')).toBe(true);
    });
  });

  describe('deleteFolder', () => {
    it('should delete an empty folder', async () => {
      adapter.addFolder('notes');
      const result = await handlers.deleteFolder({ path: 'notes', recursive: false });
      expect(result.isError).toBeUndefined();
    });

    it('should reject deleting non-empty folder without recursive', async () => {
      adapter.addFolder('notes');
      adapter.addFile('notes/test.md', 'content');
      const result = await handlers.deleteFolder({ path: 'notes', recursive: false });
      expect(result.isError).toBe(true);
    });

    it('should delete non-empty folder with recursive', async () => {
      adapter.addFolder('notes');
      adapter.addFile('notes/test.md', 'content');
      const result = await handlers.deleteFolder({ path: 'notes', recursive: true });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('renameFolder', () => {
    it('should rename a folder', async () => {
      adapter.addFolder('old');
      const result = await handlers.renameFolder({ path: 'old', newPath: 'new' });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('listFolder', () => {
    it('should list folder contents', async () => {
      adapter.addFolder('notes');
      adapter.addFile('notes/a.md', 'a');
      adapter.addFile('notes/b.md', 'b');
      const result = await handlers.listFolder({ path: 'notes' });
      const data = JSON.parse(getText(result)) as { files: string[]; folders: string[] };
      expect(data.files).toHaveLength(2);
    });
  });

  describe('listRecursive', () => {
    it('should list folder contents recursively', async () => {
      adapter.addFolder('notes');
      adapter.addFolder('notes/sub');
      adapter.addFile('notes/a.md', 'a');
      adapter.addFile('notes/sub/b.md', 'b');
      const result = await handlers.listRecursive({ path: 'notes' });
      const data = JSON.parse(getText(result)) as { files: string[]; folders: string[] };
      expect(data.files).toHaveLength(2);
      expect(data.folders).toHaveLength(1);
    });
  });

  describe('readBinary', () => {
    it('should read a binary file as base64', async () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
      await adapter.writeBinary('test.bin', data);
      const result = await handlers.readBinary({ path: 'test.bin' });
      expect(getText(result)).toBe(Buffer.from('Hello').toString('base64'));
    });
  });

  describe('writeBinary', () => {
    it('should write a binary file from base64', async () => {
      const base64 = Buffer.from('Hello').toString('base64');
      const result = await handlers.writeBinary({ path: 'test.bin', data: base64 });
      expect(result.isError).toBeUndefined();
      const data = await adapter.readBinary('test.bin');
      expect(Buffer.from(data).toString()).toBe('Hello');
    });
  });
});

describe('WriteMutex', () => {
  it('should serialize writes to the same path', async () => {
    const mutex = new WriteMutex();
    const order: number[] = [];

    const p1 = mutex.acquire('test.md', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
      return { content: [{ type: 'text' as const, text: '1' }] };
    });

    const p2 = mutex.acquire('test.md', () => {
      order.push(2);
      return Promise.resolve({ content: [{ type: 'text' as const, text: '2' }] });
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('should allow parallel writes to different paths', async () => {
    const mutex = new WriteMutex();
    const order: string[] = [];

    const p1 = mutex.acquire('a.md', async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push('a');
      return { content: [{ type: 'text' as const, text: 'a' }] };
    });

    const p2 = mutex.acquire('b.md', () => {
      order.push('b');
      return Promise.resolve({ content: [{ type: 'text' as const, text: 'b' }] });
    });

    await Promise.all([p1, p2]);
    // 'b' should complete before 'a' since they're independent
    expect(order[0]).toBe('b');
  });
});
