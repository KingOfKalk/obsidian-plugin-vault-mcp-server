import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import { buildInputSchema } from '../../../src/registry/input-schema';
import { replaceInFileSchema, updateFileSchema } from '../../../src/tools/vault/schemas';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
}

/** 2026-01-10T08:15:00.000Z */
const MTIME = Date.UTC(2026, 0, 10, 8, 15, 0, 0);
const MTIME_ISO = new Date(MTIME).toISOString();
const STALE_ISO = new Date(MTIME - 60_000).toISOString();

describe('vault_replace and expectedMtime (#406)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  describe('replaceInFile', () => {
    it('replaces a unique match and reports the new mtime', async () => {
      adapter.addFile('a.md', 'one two three', { mtime: MTIME });
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: 'two',
        newString: '2',
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('a.md')).toBe('one 2 three');
      const stat = await adapter.stat('a.md');
      expect(result.structuredContent).toEqual({
        path: 'a.md',
        replacements: 1,
        modified: new Date(stat!.mtime).toISOString(),
      });
      expect(getText(result)).toContain('a.md');
    });

    it('treats oldString and newString literally (no regex, no $ patterns)', async () => {
      adapter.addFile('a.md', 'price: (a+b)*2');
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: '(a+b)',
        newString: '$&$1',
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('a.md')).toBe('price: $&$1*2');
    });

    it('fails with the match count when oldString is missing, without writing', async () => {
      adapter.addFile('a.md', 'hello', { mtime: MTIME });
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: 'absent',
        newString: 'x',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('0 matches');
      expect(await adapter.readFile('a.md')).toBe('hello');
      expect((await adapter.stat('a.md'))!.mtime).toBe(MTIME);
    });

    it('fails with the match count when oldString is ambiguous, without writing', async () => {
      adapter.addFile('a.md', 'x x x', { mtime: MTIME });
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: 'x',
        newString: 'y',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('3 matches');
      expect(getText(result)).toContain('replaceAll');
      expect(await adapter.readFile('a.md')).toBe('x x x');
      expect((await adapter.stat('a.md'))!.mtime).toBe(MTIME);
    });

    it('replaces every non-overlapping match with replaceAll', async () => {
      adapter.addFile('a.md', 'aaaa b aa');
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: 'aa',
        newString: 'c',
        replaceAll: true,
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('a.md')).toBe('cc b c');
      expect(result.structuredContent).toMatchObject({ replacements: 3 });
    });

    it('still fails on zero matches with replaceAll', async () => {
      adapter.addFile('a.md', 'hello');
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: 'zzz',
        newString: 'x',
        replaceAll: true,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('0 matches');
    });

    it('returns File not found for a missing file', async () => {
      const result = await handlers.replaceInFile({
        path: 'missing.md',
        oldString: 'a',
        newString: 'b',
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('File not found');
    });

    it('rejects path traversal', async () => {
      const result = await handlers.replaceInFile({
        path: '../x.md',
        oldString: 'a',
        newString: 'b',
      });
      expect(result.isError).toBe(true);
    });

    it('writes when expectedMtime matches', async () => {
      adapter.addFile('a.md', 'old', { mtime: MTIME });
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: 'old',
        newString: 'new',
        expectedMtime: MTIME_ISO,
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('a.md')).toBe('new');
    });

    it('rejects a stale expectedMtime without writing', async () => {
      adapter.addFile('a.md', 'old', { mtime: MTIME });
      const result = await handlers.replaceInFile({
        path: 'a.md',
        oldString: 'old',
        newString: 'new',
        expectedMtime: STALE_ISO,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain(MTIME_ISO);
      expect(await adapter.readFile('a.md')).toBe('old');
    });
  });

  describe('expectedMtime on other write tools', () => {
    it('vault_update writes when expectedMtime matches', async () => {
      adapter.addFile('a.md', 'old', { mtime: MTIME });
      const result = await handlers.updateFile({
        path: 'a.md',
        content: 'new',
        expectedMtime: MTIME_ISO,
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('a.md')).toBe('new');
    });

    it('vault_update rejects a stale expectedMtime without writing', async () => {
      adapter.addFile('a.md', 'old', { mtime: MTIME });
      const result = await handlers.updateFile({
        path: 'a.md',
        content: 'new',
        expectedMtime: STALE_ISO,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('changed since');
      expect(getText(result)).toContain(MTIME_ISO);
      expect(getText(result)).toContain(String(MTIME));
      expect(await adapter.readFile('a.md')).toBe('old');
      expect((await adapter.stat('a.md'))!.mtime).toBe(MTIME);
    });

    it('accepts expectedMtime as epoch milliseconds', async () => {
      adapter.addFile('a.md', 'old', { mtime: MTIME });
      const ok = await handlers.updateFile({
        path: 'a.md',
        content: 'new',
        expectedMtime: String(MTIME),
      });
      expect(ok.isError).toBeUndefined();
    });

    it('ignores sub-millisecond mtime precision', async () => {
      adapter.addFile('a.md', 'old', { mtime: MTIME + 0.75 });
      const ok = await handlers.updateFile({
        path: 'a.md',
        content: 'new',
        expectedMtime: MTIME_ISO,
      });
      expect(ok.isError).toBeUndefined();
    });

    it('vault_update reports File not found when expectedMtime is set on a missing file', async () => {
      const result = await handlers.updateFile({
        path: 'missing.md',
        content: 'x',
        expectedMtime: MTIME_ISO,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('File not found');
    });

    it('vault_append rejects a stale expectedMtime without writing', async () => {
      adapter.addFile('a.md', 'Hello\n', { mtime: MTIME });
      const stale = await handlers.appendFile({
        path: 'a.md',
        content: 'World',
        expectedMtime: STALE_ISO,
      });
      expect(stale.isError).toBe(true);
      expect(await adapter.readFile('a.md')).toBe('Hello\n');

      const ok = await handlers.appendFile({
        path: 'a.md',
        content: 'World',
        expectedMtime: MTIME_ISO,
      });
      expect(ok.isError).toBeUndefined();
      expect(await adapter.readFile('a.md')).toBe('Hello\nWorld');
    });

    it('vault_write_binary rejects a stale expectedMtime without writing', async () => {
      await adapter.writeBinary('a.bin', new Uint8Array([1]).buffer);
      const current = (await adapter.stat('a.bin'))!.mtime;
      const data = Buffer.from([9, 9]).toString('base64');

      const stale = await handlers.writeBinary({
        path: 'a.bin',
        data,
        expectedMtime: new Date(current - 1000).toISOString(),
      });
      expect(stale.isError).toBe(true);
      expect(new Uint8Array(await adapter.readBinary('a.bin'))).toEqual(new Uint8Array([1]));

      const ok = await handlers.writeBinary({
        path: 'a.bin',
        data,
        expectedMtime: new Date(current).toISOString(),
      });
      expect(ok.isError).toBeUndefined();
      expect(new Uint8Array(await adapter.readBinary('a.bin'))).toEqual(new Uint8Array([9, 9]));
    });

    it('vault_write_binary with expectedMtime does not create a missing file', async () => {
      const result = await handlers.writeBinary({
        path: 'new.bin',
        data: 'AAEC',
        expectedMtime: MTIME_ISO,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('File not found');
      expect(await adapter.exists('new.bin')).toBe(false);
    });
  });

  describe('vault_read exposes modified', () => {
    it('includes the file mtime as an ISO string in structuredContent', async () => {
      adapter.addFile('a.md', 'body', { mtime: MTIME });
      const result = await handlers.readFile({ path: 'a.md' });
      expect(result.structuredContent).toMatchObject({ modified: MTIME_ISO });
      // The markdown text stays the bare content.
      expect(getText(result)).toBe('body');
    });
  });

  describe('input validation', () => {
    it('rejects an unparseable expectedMtime', () => {
      const schema = buildInputSchema(updateFileSchema);
      const result = schema.safeParse({ path: 'a.md', content: 'x', expectedMtime: 'yesterday' });
      expect(result.success).toBe(false);
    });

    it('defaults replaceAll to false and requires a non-empty oldString', () => {
      const schema = buildInputSchema(replaceInFileSchema);
      expect(schema.parse({ path: 'a.md', oldString: 'a', newString: '' })).toEqual({
        path: 'a.md',
        oldString: 'a',
        newString: '',
        replaceAll: false,
      });
      expect(schema.safeParse({ path: 'a.md', oldString: '', newString: 'x' }).success).toBe(false);
    });
  });

  describe('MockObsidianAdapter.processFile', () => {
    it('writes nothing when the callback throws', async () => {
      adapter.addFile('a.md', 'keep', { mtime: MTIME });
      await expect(
        adapter.processFile('a.md', () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await adapter.readFile('a.md')).toBe('keep');
      expect((await adapter.stat('a.md'))!.mtime).toBe(MTIME);
    });

    it('throws File not found for a missing file', async () => {
      await expect(adapter.processFile('nope.md', (c) => c)).rejects.toThrow('File not found');
    });
  });
});
