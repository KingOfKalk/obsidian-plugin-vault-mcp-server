import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../helpers/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createVaultModule } from '../../../src/tools/vault/index';
import { buildInputSchema } from '../../../src/registry/input-schema';
import { replaceInFileSchema, MAX_REPLACE_EDITS } from '../../../src/tools/vault/schemas';
import { applyReplaceEdits } from '../../../src/tools/vault/replace-edits';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  return item.type === 'text' ? item.text : '';
}

/** 2026-01-10T08:15:00.000Z */
const MTIME = Date.UTC(2026, 0, 10, 8, 15, 0, 0);
const MTIME_ISO = new Date(MTIME).toISOString();
const STALE_ISO = new Date(MTIME - 60_000).toISOString();

const PLAN = '## Agenda\n- standup\n\n## Tasks\n- [ ] write report\n- [ ] review PR\n';

describe('vault_replace with edits (#429)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex());
  });

  it('applies several edits in one write and reports per-edit counts', async () => {
    adapter.addFile('plan.md', PLAN, { mtime: MTIME });
    const result = await handlers.replaceInFile({
      path: 'plan.md',
      edits: [
        { oldString: '- standup', newString: '- standup\n- 1:1 with Sam' },
        { oldString: '- [ ] write report', newString: '- [x] write report' },
      ],
      expectedMtime: MTIME_ISO,
    });
    expect(result.isError).toBeUndefined();
    expect(await adapter.readFile('plan.md')).toBe(
      '## Agenda\n- standup\n- 1:1 with Sam\n\n## Tasks\n- [x] write report\n- [ ] review PR\n',
    );
    const stat = await adapter.stat('plan.md');
    expect(result.structuredContent).toEqual({
      path: 'plan.md',
      replacements: 2,
      edits: [
        { index: 0, replacements: 1 },
        { index: 1, replacements: 1 },
      ],
      modified: new Date(stat!.mtime).toISOString(),
    });
    expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
  });

  it('writes the file exactly once', async () => {
    adapter.addFile('plan.md', PLAN);
    let calls = 0;
    const original = adapter.processFile.bind(adapter);
    adapter.processFile = async (path, fn): Promise<string> => {
      calls += 1;
      return original(path, fn);
    };
    await handlers.replaceInFile({
      path: 'plan.md',
      edits: [
        { oldString: 'Agenda', newString: 'Plan' },
        { oldString: 'Tasks', newString: 'Todo' },
      ],
    });
    expect(calls).toBe(1);
  });

  it('supports replaceAll on a single edit', async () => {
    adapter.addFile('a.md', 'x y x y x');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'x', newString: 'X', replaceAll: true },
        { oldString: 'y', newString: 'Y', replaceAll: true },
      ],
    });
    expect(result.isError).toBeUndefined();
    expect(await adapter.readFile('a.md')).toBe('X Y X Y X');
    expect(result.structuredContent).toMatchObject({
      replacements: 5,
      edits: [
        { index: 0, replacements: 3 },
        { index: 1, replacements: 2 },
      ],
    });
  });

  it('reports a single-edit array with singular wording', async () => {
    adapter.addFile('a.md', 'hello');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [{ oldString: 'hello', newString: 'bye' }],
    });
    expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
  });

  it('matches every edit against the original content, not earlier output', async () => {
    adapter.addFile('a.md', 'a b');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'a', newString: 'b' },
        { oldString: 'b', newString: 'c' },
      ],
    });
    expect(result.isError).toBeUndefined();
    // A sequential apply would have produced "c c"; the second edit only
    // sees the original "b".
    expect(await adapter.readFile('a.md')).toBe('b c');
  });

  it('applies edits regardless of their order in the file', async () => {
    adapter.addFile('a.md', 'first second third');
    await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'third', newString: '3' },
        { oldString: 'first', newString: '1' },
      ],
    });
    expect(await adapter.readFile('a.md')).toBe('1 second 3');
  });

  it('treats strings literally', async () => {
    adapter.addFile('a.md', 'price: (a+b)*2');
    await handlers.replaceInFile({
      path: 'a.md',
      edits: [{ oldString: '(a+b)', newString: '$&$1' }],
    });
    expect(await adapter.readFile('a.md')).toBe('price: $&$1*2');
  });

  it('writes nothing when a later edit has no match, naming its index and count', async () => {
    adapter.addFile('plan.md', PLAN, { mtime: MTIME });
    const result = await handlers.replaceInFile({
      path: 'plan.md',
      edits: [
        { oldString: '- standup', newString: '- retro' },
        { oldString: '- [ ] missing task', newString: '- [x] missing task' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('edits[1]');
    expect(getText(result)).toContain('0 matches');
    expect(getText(result)).toContain('Nothing was written');
    expect(await adapter.readFile('plan.md')).toBe(PLAN);
    expect((await adapter.stat('plan.md'))!.mtime).toBe(MTIME);
  });

  it('writes nothing when an edit is ambiguous without replaceAll', async () => {
    adapter.addFile('plan.md', PLAN, { mtime: MTIME });
    const result = await handlers.replaceInFile({
      path: 'plan.md',
      edits: [
        { oldString: 'Agenda', newString: 'Plan' },
        { oldString: '- [ ]', newString: '- [x]' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('edits[1]');
    expect(getText(result)).toContain('2 matches');
    expect(getText(result)).toContain('replaceAll');
    expect(await adapter.readFile('plan.md')).toBe(PLAN);
    expect((await adapter.stat('plan.md'))!.mtime).toBe(MTIME);
  });

  it('reports the first failing edit by index', async () => {
    adapter.addFile('a.md', 'a a b');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'b', newString: 'B' },
        { oldString: 'a', newString: 'A' },
        { oldString: 'zzz', newString: 'Z' },
      ],
    });
    expect(getText(result)).toContain('edits[1].oldString is ambiguous');
  });

  it('rejects overlapping edits without writing', async () => {
    adapter.addFile('a.md', 'hello world', { mtime: MTIME });
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'hello wo', newString: 'x' },
        { oldString: 'world', newString: 'y' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('edits[0] and edits[1] overlap');
    expect(getText(result)).toContain('at character 6');
    expect(getText(result)).toContain('1 match');
    expect(await adapter.readFile('a.md')).toBe('hello world');
    expect((await adapter.stat('a.md'))!.mtime).toBe(MTIME);
  });

  it('rejects two edits with the same oldString as overlapping', async () => {
    adapter.addFile('a.md', 'once');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'once', newString: 'A' },
        { oldString: 'once', newString: 'B' },
      ],
    });
    expect(getText(result)).toContain('edits[0] and edits[1] overlap');
  });

  it('detects an overlap with a long earlier match past shorter ones', async () => {
    // edits[0] covers the whole string; edits[1] and edits[2] sit inside it.
    adapter.addFile('a.md', 'abcdefgh');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'bcd', newString: '' },
        { oldString: 'g', newString: '' },
        { oldString: 'abcdefgh', newString: '' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('edits[0] and edits[2] overlap');
  });

  it('detects an overlap with a replaceAll edit, naming its match count', async () => {
    adapter.addFile('a.md', 'ab ab ab.');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'ab', newString: 'x', replaceAll: true },
        { oldString: 'b.', newString: 'y' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('edits[0]: 3 matches, edits[1]: 1 match');
    expect(await adapter.readFile('a.md')).toBe('ab ab ab.');
  });

  it('allows edits whose matches touch but do not overlap', async () => {
    adapter.addFile('a.md', 'foobar');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [
        { oldString: 'bar', newString: 'BAR' },
        { oldString: 'foo', newString: 'FOO' },
      ],
    });
    expect(result.isError).toBeUndefined();
    expect(await adapter.readFile('a.md')).toBe('FOOBAR');
  });

  it('rejects oldString/newString together with edits', async () => {
    adapter.addFile('a.md', 'abc');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      oldString: 'a',
      newString: 'A',
      edits: [{ oldString: 'b', newString: 'B' }],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not both');
    expect(await adapter.readFile('a.md')).toBe('abc');
  });

  it('rejects a lone newString together with edits', async () => {
    adapter.addFile('a.md', 'abc');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      newString: 'A',
      edits: [{ oldString: 'b', newString: 'B' }],
    });
    expect(getText(result)).toContain('not both');
  });

  it('rejects the top-level replaceAll together with edits', async () => {
    adapter.addFile('a.md', 'abc');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      replaceAll: true,
      edits: [{ oldString: 'b', newString: 'B' }],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('set replaceAll on each edit');
    expect(await adapter.readFile('a.md')).toBe('abc');
  });

  it('rejects a call with neither form', async () => {
    adapter.addFile('a.md', 'abc');
    const result = await handlers.replaceInFile({ path: 'a.md' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Pass oldString and newString, or edits');
  });

  it('rejects oldString without newString and vice versa', async () => {
    adapter.addFile('a.md', 'abc');
    const onlyOld = await handlers.replaceInFile({ path: 'a.md', oldString: 'a' });
    expect(getText(onlyOld)).toContain('must be given together');
    const onlyNew = await handlers.replaceInFile({ path: 'a.md', newString: 'a' });
    expect(getText(onlyNew)).toContain('must be given together');
    expect(await adapter.readFile('a.md')).toBe('abc');
  });

  it('rejects a stale expectedMtime without writing', async () => {
    adapter.addFile('plan.md', PLAN, { mtime: MTIME });
    const result = await handlers.replaceInFile({
      path: 'plan.md',
      edits: [{ oldString: 'Agenda', newString: 'Plan' }],
      expectedMtime: STALE_ISO,
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('changed since');
    expect(getText(result)).toContain(MTIME_ISO);
    expect(await adapter.readFile('plan.md')).toBe(PLAN);
  });

  it('returns File not found for a missing file', async () => {
    const result = await handlers.replaceInFile({
      path: 'missing.md',
      edits: [{ oldString: 'a', newString: 'b' }],
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('File not found');
  });

  it('keeps the single-edit result shape without edits', async () => {
    adapter.addFile('a.md', 'one two');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      oldString: 'two',
      newString: '2',
    });
    expect(result.structuredContent).not.toHaveProperty('edits');
    expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
  });

  it('multi-edit structuredContent parses against the declared outputSchema', async () => {
    adapter.addFile('a.md', 'one two');
    const result = await handlers.replaceInFile({
      path: 'a.md',
      edits: [{ oldString: 'one', newString: '1' }],
    });
    const tool = createVaultModule(adapter)
      .tools()
      .find((t) => t.name === 'vault_replace');
    const shape = tool?.outputSchema as z.ZodRawShape;
    expect(z.object(shape).strict().parse(result.structuredContent)).toMatchObject({
      edits: [{ index: 0, replacements: 1 }],
    });
  });
});

describe('vault_replace input schema (#429)', () => {
  const schema = buildInputSchema(replaceInFileSchema);

  it('accepts edits and defaults replaceAll per edit', () => {
    expect(
      schema.parse({ path: 'a.md', edits: [{ oldString: 'a', newString: 'b' }] }),
    ).toEqual({
      path: 'a.md',
      replaceAll: false,
      edits: [{ oldString: 'a', newString: 'b', replaceAll: false }],
    });
  });

  it('rejects an empty edits array', () => {
    expect(schema.safeParse({ path: 'a.md', edits: [] }).success).toBe(false);
  });

  it(`rejects more than ${String(MAX_REPLACE_EDITS)} edits`, () => {
    const edits = Array.from({ length: MAX_REPLACE_EDITS + 1 }, (_, i) => ({
      oldString: `k${String(i)}`,
      newString: 'v',
    }));
    expect(schema.safeParse({ path: 'a.md', edits }).success).toBe(false);
  });

  it('rejects an empty oldString inside an edit', () => {
    expect(
      schema.safeParse({ path: 'a.md', edits: [{ oldString: '', newString: 'x' }] }).success,
    ).toBe(false);
  });

  it('rejects unknown keys inside an edit', () => {
    expect(
      schema.safeParse({
        path: 'a.md',
        edits: [{ old_string: 'a', oldString: 'a', newString: 'b' }],
      }).success,
    ).toBe(false);
  });

  it('still parses the single-edit form unchanged', () => {
    expect(schema.parse({ path: 'a.md', oldString: 'a', newString: '' })).toEqual({
      path: 'a.md',
      oldString: 'a',
      newString: '',
      replaceAll: false,
    });
  });
});

describe('applyReplaceEdits', () => {
  it('returns the content unchanged apart from the matched spans', () => {
    expect(
      applyReplaceEdits('a-b-c', [{ oldString: '-', newString: '+', replaceAll: true }], 'x.md'),
    ).toEqual({ content: 'a+b+c', replacements: [2] });
  });

  it('treats a missing replaceAll as false', () => {
    expect(() =>
      applyReplaceEdits('a a', [{ oldString: 'a', newString: 'b' }], 'x.md'),
    ).toThrow('edits[0].oldString is ambiguous in x.md (2 matches)');
  });
});
