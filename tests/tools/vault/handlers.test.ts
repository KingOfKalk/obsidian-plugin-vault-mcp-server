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
