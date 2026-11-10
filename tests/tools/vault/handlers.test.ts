import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import { jsonOf, parseDocument, windowOf } from '../../helpers/result';

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
    handlers = createHandlers(adapter, mutex, createSearchHandlers(adapter));
  });

  describe('createFile', () => {
    it('should create a file', async () => {
      const result = await handlers.createFile({ path: 'test.md', content: '# Hello' });
      expect(result.isError).toBeUndefined();
      expect(jsonOf(result)).toEqual(result.structuredContent);
      expect(result.structuredContent).toMatchObject({ path: 'test.md', created: true });
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
      const doc = parseDocument(result);
      expect(doc.body).toBe('# Hello World');
      expect(doc.meta).toMatchObject({ path: 'test.md', totalLength: '13', hasMore: 'false' });
      expect(result.structuredContent).toBeUndefined();
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
    it('should append to a file that ends with a newline', async () => {
      adapter.addFile('test.md', 'Hello\n');
      const result = await handlers.appendFile({ path: 'test.md', content: 'World' });
      expect(result.isError).toBeUndefined();
      const content = await adapter.readFile('test.md');
      expect(content).toBe('Hello\nWorld');
    });

    // #447: the tool is line-oriented ("add a bullet"); text used to be
    // glued onto the last line.
    it.each([
      ['starts a new line when the file does not end with one', '- a', '- b', '- a\n- b'],
      ['uses the file\'s CRLF line ending', '- a\r\n- b', '- c', '- a\r\n- b\r\n- c'],
      ['adds nothing when content starts with a newline', '- a', '\n- b', '- a\n- b'],
      ['adds nothing when content starts with CRLF', '- a', '\r\n- b', '- a\r\n- b'],
      ['adds nothing when the file ends with CRLF', 'x\r\n', 'y', 'x\r\ny'],
      ['adds nothing to an empty file', '', '- a', '- a'],
    ])('%s (#447)', async (_name, existing, content, expected) => {
      adapter.addFile('list.md', existing);
      const result = await handlers.appendFile({ path: 'list.md', content });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('list.md')).toBe(expected);
    });

    it('returns the new modified timestamp, usable as the next expectedMtime (#447)', async () => {
      adapter.addFile('test.md', 'a\n', { mtime: 1000 });
      const result = await handlers.appendFile({ path: 'test.md', content: 'b' });
      const sc = result.structuredContent as { path: string; appended: boolean; modified: string };
      const stat = await adapter.stat('test.md');
      expect(sc).toEqual({
        path: 'test.md',
        appended: true,
        modified: new Date(stat!.mtime).toISOString(),
      });
      const next = await handlers.appendFile({
        path: 'test.md',
        content: 'c',
        expectedMtime: sc.modified,
      });
      expect(next.isError).toBeUndefined();
      expect(await adapter.readFile('test.md')).toBe('a\nb\nc');
    });

    it('should return error for nonexistent file', async () => {
      const result = await handlers.appendFile({ path: 'missing.md', content: 'data' });
      expect(result.isError).toBe(true);
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata as JSON text and structuredContent', async () => {
      adapter.addFile('test.md', 'content', { ctime: 1000, mtime: 2000 });
      const result = await handlers.getMetadata({
        path: 'test.md',
      });
      const data = JSON.parse(getText(result)) as Record<string, unknown>;
      expect(data.path).toBe('test.md');
      expect(data.size).toBe(7);
      expect(result.structuredContent).toMatchObject({ path: 'test.md' });
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
      expect(jsonOf(result)).toMatchObject({ from: 'notes/old.md', to: 'notes/new.md' });
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
      expect(jsonOf(result)).toMatchObject({ from: 'old/test.md', to: 'new/test.md' });
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
      const result = await handlers.listFolder({
        path: 'notes',
      });
      const data = JSON.parse(getText(result)) as { files: string[]; folders: string[] };
      expect(data.files).toHaveLength(2);
      expect(result.structuredContent).toBeDefined();
    });
  });

  describe('listRecursive', () => {
    it('should list folder contents recursively with pagination metadata', async () => {
      adapter.addFolder('notes');
      adapter.addFolder('notes/sub');
      adapter.addFile('notes/a.md', 'a');
      adapter.addFile('notes/sub/b.md', 'b');
      const result = await handlers.listRecursive({
        path: 'notes',
      });
      const data = JSON.parse(getText(result)) as {
        folders: string[];
        total: number;
        count: number;
        items: string[];
      };
      expect(data.folders).toHaveLength(1);
      expect(data.total).toBe(2);
      expect(data.count).toBe(2);
      expect(data.items).toHaveLength(2);
    });

    it('honours limit and offset on listRecursive', async () => {
      adapter.addFolder('lots');
      for (let i = 0; i < 10; i++) {
        adapter.addFile(`lots/f-${String(i).padStart(2, '0')}.md`, 'x');
      }
      const result = await handlers.listRecursive({
        path: 'lots',
        limit: 3,
        offset: 5,
      });
      const page = JSON.parse(getText(result)) as {
        total: number;
        count: number;
        offset: number;
        hasMore: boolean;
        nextOffset?: number;
        items: string[];
      };
      expect(page.total).toBe(10);
      expect(page.count).toBe(3);
      expect(page.offset).toBe(5);
      expect(page.hasMore).toBe(true);
      expect(page.nextOffset).toBe(8);
    });
  });

  describe('readBinary', () => {
    it('should read a binary file as base64', async () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
      await adapter.writeBinary('test.bin', data);
      const result = await handlers.readBinary({ path: 'test.bin' });
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'path: test.bin\nmimeType: application/octet-stream\nsizeBytes: 5\ncontent: resource',
        },
        {
          type: 'resource',
          resource: {
            uri: 'obsidian://vault/test.bin',
            mimeType: 'application/octet-stream',
            blob: Buffer.from('Hello').toString('base64'),
          },
        },
      ]);
    });

    it('returns an image block for an image, without repeating the data', async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
      await adapter.writeBinary('img/dot.png', png);
      const result = await handlers.readBinary({ path: 'img/dot.png' });
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([
        { type: 'text', text: 'path: img/dot.png\nmimeType: image/png\nsizeBytes: 4\ncontent: image' },
        { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
      ]);
    });

    it('returns an audio block for audio', async () => {
      await adapter.writeBinary('a/b.mp3', new Uint8Array([1, 2]).buffer);
      const result = await handlers.readBinary({ path: 'a/b.mp3' });
      expect(result.content[1]).toEqual({ type: 'audio', data: 'AQI=', mimeType: 'audio/mpeg' });
    });

    it('returns SVG and other text types as a resource with a percent-encoded URI', async () => {
      await adapter.writeBinary('my pics/logo #1.svg', new Uint8Array([60, 115]).buffer);
      const result = await handlers.readBinary({ path: 'my pics/logo #1.svg' });
      expect(result.content[1]).toEqual({
        type: 'resource',
        resource: {
          uri: 'obsidian://vault/my%20pics/logo%20%231.svg',
          mimeType: 'image/svg+xml',
          blob: 'PHM=',
        },
      });
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

describe('vault handlers truncation and size limits', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  it('truncates oversized readFile content with a clear footer', async () => {
    const big = 'x'.repeat(50_000);
    adapter.addFile('big.md', big);
    const result = await handlers.readFile({ path: 'big.md' });
    expect(getText(result)).toContain('[TRUNCATED:');
  });

  describe('readFile paging (#388)', () => {
    it('returns a small file whole when only path is given', async () => {
      adapter.addFile('small.md', '# Small');
      const result = await handlers.readFile({ path: 'small.md' });
      const doc = parseDocument(result);
      expect(doc.body).toBe('# Small');
      expect(Object.keys(doc.meta)).toEqual(['path', 'modified', 'totalLength', 'offset', 'hasMore']);
      expect(doc.meta).toMatchObject({ path: 'small.md', totalLength: '7', offset: '0', hasMore: 'false' });
      expect(Number.isNaN(Date.parse(doc.meta.modified))).toBe(false);
      expect(result.structuredContent).toBeUndefined();
    });

    it('returns the first chunk of a large file and points at the next offset', async () => {
      const big = 'a'.repeat(30_000) + 'b'.repeat(30_000);
      adapter.addFile('big.md', big);
      const result = await handlers.readFile({ path: 'big.md' });
      const w = windowOf(result);
      expect(w.totalLength).toBe(60_000);
      expect(w.hasMore).toBe(true);
      expect(w.content.length).toBe(w.nextOffset);
      const text = getText(result);
      expect(text.length).toBeLessThanOrEqual(25_000);
      expect(text).toContain(`offset=${String(w.nextOffset)}`);
      expect(text).not.toContain('editor_');
    });

    it('can read a whole large file chunk by chunk', async () => {
      const big = Array.from({ length: 5000 }, (_, i) => `line ${String(i)}`).join('\n');
      adapter.addFile('big.md', big);
      let offset = 0;
      let collected = '';
      for (let guard = 0; guard < 20; guard++) {
        const w = windowOf(await handlers.readFile({ path: 'big.md', offset }));
        collected += w.content;
        if (!w.hasMore) break;
        offset = w.nextOffset ?? 0;
      }
      expect(collected).toBe(big);
    });

    it('honours offset and length', async () => {
      adapter.addFile('abc.md', 'abcdefghij');
      const result = await handlers.readFile({ path: 'abc.md', offset: 2, length: 3 });
      const w = windowOf(result);
      expect(w).toMatchObject({ content: 'cde', totalLength: 10, offset: 2, hasMore: true, nextOffset: 5 });
      expect(getText(result)).toContain('offset=5');
    });

    it('returns an empty window past the end of the file', async () => {
      adapter.addFile('abc.md', 'abc');
      const result = await handlers.readFile({ path: 'abc.md', offset: 10 });
      expect(result.isError).not.toBe(true);
      expect(windowOf(result)).toMatchObject({ content: '', totalLength: 3, hasMore: false });
    });

    // #467: the text is never JSON-escaped, so a window of quotes, newlines
    // or control characters is as long as `length`, and reassembles exactly.
    it.each([
      ['newlines', 'a\n'.repeat(15_000)],
      ['quotes', '"'.repeat(30_000)],
      ['control characters', '\u0001'.repeat(30_000)],
    ])('returns a full raw window for content full of %s', async (_name, big) => {
      adapter.addFile('big.md', big);
      const result = await handlers.readFile({ path: 'big.md' });
      const text = getText(result);
      expect(text.length).toBeLessThanOrEqual(25_000);
      const w = windowOf(result);
      expect(w.content).toBe(big.slice(0, 24_000));
      expect(w.nextOffset).toBe(24_000);
      expect(w.totalLength).toBe(big.length);
    });

    it('can read a whole escape-heavy file chunk by chunk', async () => {
      const big = 'x\n"\t\\'.repeat(20_000);
      adapter.addFile('big.md', big);
      let offset = 0;
      let collected = '';
      for (let guard = 0; guard < 50; guard++) {
        const w = windowOf(await handlers.readFile({ path: 'big.md', offset }));
        collected += w.content;
        if (!w.hasMore) break;
        offset = w.nextOffset ?? 0;
      }
      expect(collected).toBe(big);
    });

    it('keeps a file that starts with frontmatter intact after the header', async () => {
      adapter.addFile('fm.md', '---\ntitle: x\n---\n\nbody');
      const doc = parseDocument(await handlers.readFile({ path: 'fm.md' }));
      expect(doc.body).toBe('---\ntitle: x\n---\n\nbody');
      expect(doc.meta.path).toBe('fm.md');
    });

    it('does not split a surrogate pair at the end of a window', async () => {
      adapter.addFile('emoji.md', 'a\u{1F600}b');
      const w = windowOf(await handlers.readFile({ path: 'emoji.md', length: 2 }));
      expect(w.content).toBe('a');
      expect(w.nextOffset).toBe(1);
    });
  });

  it('refuses readBinary when the file is larger than the byte limit', async () => {
    // Seed a 2 MiB blob via the writeBinary adapter path so the mock adapter
    // returns a buffer that exceeds BINARY_BYTE_LIMIT (1 MiB).
    const bigBuffer = new ArrayBuffer(2_000_000);
    await adapter.writeBinary('huge.bin', bigBuffer);
    const result = await handlers.readBinary({ path: 'huge.bin' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('too large');
  });
});

describe('vault handlers: trash, links and missing folders (#405)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  it('vault_delete sends the file to the trash', async () => {
    adapter.addFile('notes/old.md', 'x');
    const result = await handlers.deleteFile({ path: 'notes/old.md' });
    expect(result.isError).toBeUndefined();
    expect(adapter.getTrashedPaths()).toEqual(['notes/old.md']);
  });

  it('vault_delete_folder sends the folder to the trash', async () => {
    adapter.addFile('drafts/a.md', 'x');
    const result = await handlers.deleteFolder({ path: 'drafts', recursive: true });
    expect(result.isError).toBeUndefined();
    expect(adapter.getTrashedPaths()).toEqual(['drafts']);
    expect(await adapter.exists('drafts/a.md')).toBe(false);
  });

  it('vault_move updates wikilinks that point at the moved file', async () => {
    adapter.addFile('notes/target.md', 'target');
    adapter.addFile('index.md', 'See [[notes/target]], [[notes/target|alias]] and [[notes/target.md#Heading]]. Not [[notes/target-other]].');
    const result = await handlers.moveFile({ path: 'notes/target.md', newPath: 'archive/2026/target.md' });
    expect(result.isError).toBeUndefined();
    expect(await adapter.readFile('index.md')).toBe(
      'See [[archive/2026/target]], [[archive/2026/target|alias]] and [[archive/2026/target#Heading]]. Not [[notes/target-other]].',
    );
  });

  it('vault_rename updates wikilinks that point at the renamed file', async () => {
    adapter.addFile('a.md', 'a');
    adapter.addFile('b.md', 'link to [[a]]');
    await handlers.renameFile({ path: 'a.md', newName: 'c.md' });
    expect(await adapter.readFile('b.md')).toBe('link to [[c]]');
  });

  it('vault_create creates missing parent folders', async () => {
    const result = await handlers.createFile({ path: 'new/deep/note.md', content: 'x' });
    expect(result.isError).toBeUndefined();
    expect(adapter.list('new').folders).toEqual(['new/deep']);
    expect(adapter.list('new/deep').files).toEqual(['new/deep/note.md']);
  });

  it('vault_copy creates missing parent folders', async () => {
    adapter.addFile('a.md', 'a');
    const result = await handlers.copyFile({ sourcePath: 'a.md', destPath: 'copies/x/a.md' });
    expect(result.isError).toBeUndefined();
    expect(await adapter.exists('copies/x')).toBe(true);
  });

  it('vault_move creates missing parent folders', async () => {
    adapter.addFile('a.md', 'a');
    const result = await handlers.moveFile({ path: 'a.md', newPath: 'archive/old/a.md' });
    expect(result.isError).toBeUndefined();
    expect(await adapter.exists('archive/old')).toBe(true);
    expect(await adapter.readFile('archive/old/a.md')).toBe('a');
  });

  it('vault_write_binary creates missing parent folders', async () => {
    const data = Buffer.from('hi').toString('base64');
    const result = await handlers.writeBinary({ path: 'assets/img/x.bin', data });
    expect(result.isError).toBeUndefined();
    expect(await adapter.exists('assets/img')).toBe(true);
  });
});
