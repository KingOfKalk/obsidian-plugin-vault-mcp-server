import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import { createVaultModule } from '../../../src/tools/vault/index';
import { buildInputSchema } from '../../../src/registry/input-schema';
import { insertSchema, readFileSchema } from '../../../src/tools/vault/schemas';
import {
  findSection,
  insertIntoSection,
  lineOffset,
  parseHeadingQuery,
  parseHeadings,
  splitLines,
} from '../../../src/tools/vault/sections';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
}

/** 2026-01-10T08:15:00.000Z */
const MTIME = Date.UTC(2026, 0, 10, 8, 15, 0, 0);
const MTIME_ISO = new Date(MTIME).toISOString();
const STALE_ISO = new Date(MTIME - 60_000).toISOString();

const JOURNAL = [
  '---',
  'title: Journal',
  '# not a heading',
  '---',
  '# Journal',
  '',
  '## Notes',
  '',
  '- one',
  '- two',
  '',
  '### Detail',
  'detail text',
  '',
  '## Log',
  '- 08:00 coffee',
  '',
].join('\n');

describe('section helpers (#428)', () => {
  describe('parseHeadings', () => {
    it('finds ATX headings with levels and line indexes', () => {
      expect(parseHeadings(splitLines(JOURNAL))).toEqual([
        { index: 4, level: 1, text: 'Journal' },
        { index: 6, level: 2, text: 'Notes' },
        { index: 11, level: 3, text: 'Detail' },
        { index: 14, level: 2, text: 'Log' },
      ]);
    });

    it('ignores headings in fenced code blocks (``` and ~~~)', () => {
      const lines = splitLines(
        [
          '# A',
          '```md',
          '# fake',
          '```',
          '~~~~',
          '## fake too',
          '~~~',
          '## still fake',
          '~~~~',
          '## B',
        ].join('\n'),
      );
      expect(parseHeadings(lines).map((h) => h.text)).toEqual(['A', 'B']);
    });

    it('treats an unclosed fence as running to the end of the file', () => {
      expect(parseHeadings(splitLines('# A\n```\n# B')).map((h) => h.text)).toEqual(['A']);
    });

    it('does not open a backtick fence whose info string has backticks', () => {
      expect(parseHeadings(splitLines('``` a`b\n# A')).map((h) => h.text)).toEqual(['A']);
    });

    it('treats an unclosed frontmatter block as text', () => {
      expect(parseHeadings(splitLines('---\n# A')).map((h) => h.text)).toEqual(['A']);
    });

    it('accepts ... as frontmatter terminator', () => {
      expect(parseHeadings(splitLines('---\na: 1\n...\n# A')).map((h) => h.index)).toEqual([3]);
    });

    it('requires a space after the marks and strips closing hashes', () => {
      const lines = splitLines('#tag\n## Title ##\n###\n####### seven\n   #  Spaced   out  ');
      expect(parseHeadings(lines)).toEqual([
        { index: 1, level: 2, text: 'Title' },
        { index: 2, level: 3, text: '' },
        { index: 4, level: 1, text: 'Spaced out' },
      ]);
    });

    it('handles CRLF line endings', () => {
      expect(parseHeadings(splitLines('# A\r\ntext\r\n## B\r\n'))).toEqual([
        { index: 0, level: 1, text: 'A' },
        { index: 2, level: 2, text: 'B' },
      ]);
    });
  });

  describe('parseHeadingQuery', () => {
    it('parses plain text and text with a level', () => {
      expect(parseHeadingQuery('  Log ')).toEqual({ text: 'Log' });
      expect(parseHeadingQuery('## Log')).toEqual({ level: 2, text: 'Log' });
      expect(parseHeadingQuery('#tag')).toEqual({ text: '#tag' });
    });
  });

  describe('findSection', () => {
    const lines = splitLines(JOURNAL);

    it('runs to the next heading of the same or a higher level', () => {
      expect(findSection(lines, 'Notes', 'j.md')).toMatchObject({ start: 6, end: 14 });
      expect(findSection(lines, 'Detail', 'j.md')).toMatchObject({ start: 11, end: 14 });
      expect(findSection(lines, 'Journal', 'j.md')).toMatchObject({ start: 4, end: 17 });
    });

    it('runs to the end of the file for the last section', () => {
      expect(findSection(lines, '## Log', 'j.md')).toMatchObject({ start: 14, end: 17 });
    });

    it('lists the available headings when nothing matches', () => {
      expect(() => findSection(lines, 'Missing', 'j.md')).toThrow(
        'Heading not found in j.md: "Missing". Available headings: line 5 "# Journal", ' +
          'line 7 "## Notes", line 12 "### Detail", line 15 "## Log".',
      );
    });

    it('does not match a heading by the wrong level', () => {
      expect(() => findSection(lines, '### Log', 'j.md')).toThrow('Heading not found');
    });

    it('says so when the file has no headings', () => {
      expect(() => findSection(['text'], 'A', 'n.md')).toThrow('n.md has no headings.');
    });

    it('cuts a long list of available headings', () => {
      const many = Array.from({ length: 60 }, (_, i) => `# H${String(i)}`);
      expect(() => findSection(many, 'X', 'n.md')).toThrow('… and 10 more');
    });

    it('lists the matches with line numbers when ambiguous, and accepts a level', () => {
      const dup = splitLines('# Log\na\n## Log\nb\n## Log\nc');
      expect(() => findSection(dup, 'Log', 'n.md')).toThrow(
        'Heading "Log" is ambiguous in n.md (3 matches): line 1 "# Log", line 3 "## Log", line 5 "## Log".',
      );
      expect(findSection(dup, '# Log', 'n.md')).toMatchObject({ start: 0, end: 6 });
      expect(() => findSection(dup, '## Log', 'n.md', ' X')).toThrow(/2 matches.*one of them\. X$/);
    });
  });

  describe('lineOffset', () => {
    it('returns the content length past the last line', () => {
      expect(lineOffset('a\nb', 1)).toBe(2);
      expect(lineOffset('a\nb', 5)).toBe(3);
    });
  });

  describe('insertIntoSection', () => {
    function insert(content: string, heading: string, position: 'start' | 'end', text: string): {
      content: string;
      line: number;
    } {
      const lines = splitLines(content);
      return insertIntoSection(content, lines, findSection(lines, heading, 'n.md'), position, text);
    }

    it('end: goes after the last non-blank line, keeping the blank line before the next heading', () => {
      const result = insert(JOURNAL, 'Notes', 'end', '- three');
      expect(result.line).toBe(13);
      expect(result.content).toContain('detail text\n- three\n\n## Log');
    });

    it('start: goes below the heading and the blank line after it', () => {
      const result = insert(JOURNAL, 'Notes', 'start', '- zero');
      expect(result.line).toBe(8);
      expect(result.content).toContain('## Notes\n\n- zero\n- one');
    });

    it('start without a blank line goes right after the heading', () => {
      expect(insert('## A\nx\n', 'A', 'start', 'new').content).toBe('## A\nnew\nx\n');
    });

    it('end of the last section keeps the trailing newline', () => {
      expect(insert('## A\n- a\n', 'A', 'end', '- b').content).toBe('## A\n- a\n- b\n');
    });

    it('end of a file without a trailing newline starts a new line', () => {
      const result = insert('## A\n- a', 'A', 'end', '- b');
      expect(result).toEqual({ content: '## A\n- a\n- b', line: 2 });
      expect(insert('## A', 'A', 'start', 'x').content).toBe('## A\nx');
    });

    it('an empty section gets the text right below the heading', () => {
      expect(insert('## A\n\n## B\n', 'A', 'end', 'x').content).toBe('## A\nx\n\n## B\n');
      expect(insert('## A\n## B\n', 'A', 'start', 'x').content).toBe('## A\nx\n## B\n');
    });

    it('drops one trailing newline and keeps a leading one', () => {
      expect(insert('## A\npara\n', 'A', 'end', '\nnew para\n').content).toBe(
        '## A\npara\n\nnew para\n',
      );
    });

    it('uses CRLF in CRLF files', () => {
      expect(insert('## A\r\na\r\n## B\r\n', 'A', 'end', 'x\ny').content).toBe(
        '## A\r\na\r\nx\r\ny\r\n## B\r\n',
      );
    });
  });
});

describe('vault_insert and vault_read with heading (#428)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  describe('insert', () => {
    it('appends to a section and returns path, heading, position, line and modified', async () => {
      adapter.addFile('j.md', JOURNAL, { mtime: MTIME });
      const result = await handlers.insert({
        path: 'j.md',
        heading: 'Log',
        position: 'end',
        text: '- 09:30 standup',
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('j.md')).toBe(
        JOURNAL.replace('- 08:00 coffee\n', '- 08:00 coffee\n- 09:30 standup\n'),
      );
      const stat = await adapter.stat('j.md');
      expect(result.structuredContent).toEqual({
        path: 'j.md',
        heading: '## Log',
        position: 'end',
        line: 17,
        modified: new Date(stat!.mtime).toISOString(),
      });
      expect(getText(result)).toBe('Inserted into "## Log" (end) in j.md at line 17');
    });

    it('defaults position to end', async () => {
      adapter.addFile('a.md', '## A\nx\n## B\n');
      const result = await handlers.insert({ path: 'a.md', heading: 'A', text: 'y' });
      expect(result.structuredContent).toMatchObject({ position: 'end', line: 3 });
      expect(await adapter.readFile('a.md')).toBe('## A\nx\ny\n## B\n');
    });

    it('inserts at the start of a nested parent section, before its subsections', async () => {
      adapter.addFile('a.md', '# P\n## C\nc\n');
      await handlers.insert({ path: 'a.md', heading: 'P', position: 'start', text: 'p' });
      expect(await adapter.readFile('a.md')).toBe('# P\np\n## C\nc\n');
    });

    it('fails on a missing heading without writing', async () => {
      adapter.addFile('j.md', JOURNAL, { mtime: MTIME });
      const result = await handlers.insert({ path: 'j.md', heading: 'Nope', text: 'x' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Heading not found in j.md: "Nope"');
      expect(getText(result)).toContain('line 15 "## Log"');
      expect(getText(result)).toMatch(/Nothing was written\.$/);
      expect(await adapter.readFile('j.md')).toBe(JOURNAL);
      expect((await adapter.stat('j.md'))!.mtime).toBe(MTIME);
    });

    it('fails on a duplicate heading without writing', async () => {
      adapter.addFile('d.md', '## Log\na\n## Log\nb\n', { mtime: MTIME });
      const result = await handlers.insert({ path: 'd.md', heading: 'Log', text: 'x' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('(2 matches): line 1 "## Log", line 3 "## Log"');
      expect(await adapter.readFile('d.md')).toBe('## Log\na\n## Log\nb\n');
      expect((await adapter.stat('d.md'))!.mtime).toBe(MTIME);
    });

    it('ignores a heading inside a code fence', async () => {
      adapter.addFile('c.md', '## Log\na\n```\n## Log\n```\n');
      const result = await handlers.insert({ path: 'c.md', heading: 'Log', text: 'b' });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('c.md')).toBe('## Log\na\n```\n## Log\n```\nb\n');
    });

    it('writes when expectedMtime matches', async () => {
      adapter.addFile('a.md', '## A\n', { mtime: MTIME });
      const result = await handlers.insert({
        path: 'a.md',
        heading: 'A',
        text: 'x',
        expectedMtime: MTIME_ISO,
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('a.md')).toBe('## A\nx\n');
    });

    it('rejects a stale expectedMtime without writing', async () => {
      adapter.addFile('a.md', '## A\n', { mtime: MTIME });
      const result = await handlers.insert({
        path: 'a.md',
        heading: 'A',
        text: 'x',
        expectedMtime: STALE_ISO,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('File changed since expectedMtime');
      expect(await adapter.readFile('a.md')).toBe('## A\n');
    });

    it('returns File not found for a missing file', async () => {
      const result = await handlers.insert({ path: 'none.md', heading: 'A', text: 'x' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('File not found');
    });

    it('rejects path traversal', async () => {
      const result = await handlers.insert({ path: '../x.md', heading: 'A', text: 'x' });
      expect(result.isError).toBe(true);
    });

    it('serialises concurrent inserts on the same file', async () => {
      adapter.addFile('a.md', '## A\n');
      await Promise.all([
        handlers.insert({ path: 'a.md', heading: 'A', text: '1' }),
        handlers.insert({ path: 'a.md', heading: 'A', text: '2' }),
      ]);
      expect(await adapter.readFile('a.md')).toBe('## A\n1\n2\n');
    });
  });

  describe('readFile with heading', () => {
    it('returns only the section with heading, line and modified', async () => {
      adapter.addFile('j.md', JOURNAL, { mtime: MTIME });
      const result = await handlers.readFile({ path: 'j.md', heading: 'Notes' });
      expect(result.isError).toBeUndefined();
      const section = '## Notes\n\n- one\n- two\n\n### Detail\ndetail text\n\n';
      expect(getText(result)).toBe(section);
      expect(result.structuredContent).toEqual({
        path: 'j.md',
        heading: '## Notes',
        line: 7,
        content: section,
        totalLength: section.length,
        offset: 0,
        hasMore: false,
        modified: MTIME_ISO,
      });
    });

    it('pages within the section', async () => {
      const body = 'x'.repeat(30);
      adapter.addFile('p.md', `# Intro\nhi\n## Big\n${body}\n## After\nz\n`);
      const first = await handlers.readFile({ path: 'p.md', heading: 'Big', length: 20 });
      expect(first.structuredContent).toMatchObject({
        content: `## Big\n${'x'.repeat(13)}`,
        totalLength: 38,
        offset: 0,
        hasMore: true,
        nextOffset: 20,
      });
      expect(getText(first)).toContain('Call vault_read again with offset=20');
      const second = await handlers.readFile({
        path: 'p.md',
        heading: 'Big',
        offset: 20,
        length: 20,
      });
      expect(second.structuredContent).toMatchObject({
        content: `${'x'.repeat(17)}\n`,
        offset: 20,
        hasMore: false,
      });
    });

    it('fails with the available headings when the heading is missing', async () => {
      adapter.addFile('j.md', JOURNAL);
      const result = await handlers.readFile({ path: 'j.md', heading: 'Nope' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Available headings: line 5 "# Journal"');
      expect(getText(result)).not.toContain('Nothing was written');
    });

    it('fails with the matches when the heading is ambiguous', async () => {
      adapter.addFile('d.md', '## Log\na\n## Log\nb\n');
      const result = await handlers.readFile({ path: 'd.md', heading: 'Log' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('ambiguous in d.md (2 matches)');
    });

    it('is unchanged without heading', async () => {
      adapter.addFile('a.md', '# A\nbody', { mtime: MTIME });
      const result = await handlers.readFile({ path: 'a.md' });
      expect(result.structuredContent).not.toHaveProperty('heading');
      expect(result.structuredContent).not.toHaveProperty('line');
      expect(getText(result)).toBe('# A\nbody');
    });
  });

  describe('schemas and registration', () => {
    it('defaults position to end and rejects a blank heading or empty text', () => {
      const schema = buildInputSchema(insertSchema);
      expect(schema.parse({ path: 'a.md', heading: 'A', text: 'x' })).toEqual({
        path: 'a.md',
        heading: 'A',
        text: 'x',
        position: 'end',
      });
      expect(schema.safeParse({ path: 'a.md', heading: '  ', text: 'x' }).success).toBe(false);
      expect(schema.safeParse({ path: 'a.md', heading: 'A', text: '' }).success).toBe(false);
      expect(
        schema.safeParse({ path: 'a.md', heading: 'A', text: 'x', position: 'middle' }).success,
      ).toBe(false);
    });

    it('vault_read accepts an optional heading', () => {
      const schema = buildInputSchema(readFileSchema);
      expect(schema.safeParse({ path: 'a.md', heading: 'Log' }).success).toBe(true);
    });

    it('vault_insert is additive (not read-only, not destructive, not idempotent)', () => {
      const tool = createVaultModule(new MockObsidianAdapter())
        .tools()
        .find((t) => t.name === 'vault_insert');
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
    });

    it('structured output parses against the declared output schemas', async () => {
      const tools = createVaultModule(new MockObsidianAdapter()).tools();
      const shape = (name: string): z.ZodTypeAny => {
        const tool = tools.find((t) => t.name === name);
        return z.object(tool!.outputSchema as z.ZodRawShape).strict();
      };
      adapter.addFile('a.md', '## A\nx\n');
      const inserted = await handlers.insert({ path: 'a.md', heading: 'A', text: 'y' });
      expect(() => shape('vault_insert').parse(inserted.structuredContent)).not.toThrow();
      const read = await handlers.readFile({ path: 'a.md', heading: 'A' });
      expect(() => shape('vault_read').parse(read.structuredContent)).not.toThrow();
    });
  });
});
