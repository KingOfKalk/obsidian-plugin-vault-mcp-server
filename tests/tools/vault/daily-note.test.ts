import { describe, it, expect, beforeEach } from 'vitest';
import moment from 'moment';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import { windowOf } from '../../helpers/result';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
}

/**
 * The fields of a vault_daily_note document result (#467): header values
 * as booleans, and the note text when the note exists.
 */
function daily(result: CallToolResult): Record<string, unknown> {
  expect(result.structuredContent).toBeUndefined();
  const w = windowOf(result);
  return {
    path: w.meta.path,
    created: w.meta.created === 'true',
    exists: w.meta.exists === 'true',
    ...(w.meta.warning !== undefined ? { warning: w.meta.warning } : {}),
    ...(w.meta.exists === 'true' ? { content: w.content } : {}),
  };
}

describe('vault_daily_note handler', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  describe('plugin-disabled error', () => {
    it('errors when the daily-notes plugin returns no settings', async () => {
      // mock default: getDailyNotesSettings() returns null
      const result = await handlers.dailyNote({});
      expect(result.isError).toBe(true);
      expect(getText(result)).toMatch(/daily-notes/i);
    });
  });

  describe('existing-file path', () => {
    it('reads and returns the existing daily note without creating', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
      const today = moment().format('YYYY-MM-DD');
      const path = `${today}.md`;
      adapter.addFile(path, 'today body');

      const result = await handlers.dailyNote({});
      expect(result.isError).toBeUndefined();
      const structured = daily(result) as { path: string; created: boolean; content: string };
      expect(structured.path).toBe(path);
      expect(structured.created).toBe(false);
      expect(structured.content).toBe('today body');
    });

    it('uses an explicit YYYY-MM-DD date when provided', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: 'Daily', template: '' });
      adapter.addFolder('Daily');
      adapter.addFile('Daily/2026-01-02.md', 'specific body');

      const result = await handlers.dailyNote({ date: '2026-01-02' });
      expect(result.isError).toBeUndefined();
      const structured = daily(result) as { path: string; created: boolean; content: string };
      expect(structured.path).toBe('Daily/2026-01-02.md');
      expect(structured.created).toBe(false);
      expect(structured.content).toBe('specific body');
    });
  });

  describe('create with empty template', () => {
    it('creates the note with empty body when no template is configured', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
      const today = moment().format('YYYY-MM-DD');
      const path = `${today}.md`;

      const result = await handlers.dailyNote({ create: true });
      expect(result.isError).toBeUndefined();
      const structured = daily(result) as { path: string; created: boolean; content: string };
      expect(structured.path).toBe(path);
      expect(structured.created).toBe(true);
      expect(structured.content).toBe('');
      // and the file actually exists in the mock vault
      expect(await adapter.readFile(path)).toBe('');
    });

    it('idempotent: a second call returns created=false', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
      await handlers.dailyNote({ create: true });
      const result = await handlers.dailyNote({ create: true });
      const structured = daily(result) as { created: boolean };
      expect(structured.created).toBe(false);
    });
  });

  describe('create with template', () => {
    it('expands {{date}}/{{title}} from a plain template', async () => {
      adapter.setDailyNotesSettings({
        format: 'YYYY-MM-DD',
        folder: 'Daily',
        template: 'templates/daily.md',
      });
      adapter.addFolder('templates');
      adapter.addFile(
        'templates/daily.md',
        '# {{title}}\n\nDate: {{date}}\n\n## Notes\n',
      );

      const result = await handlers.dailyNote({ date: '2026-05-05', create: true });
      expect(result.isError).toBeUndefined();
      const structured = daily(result) as { content: string };
      expect(structured.content).toContain('Date: 2026-05-05');
      expect(structured.content).toContain('# 2026-05-05');
      expect(structured.content).toContain('## Notes');
    });

    it('copies a Templater (<%) template raw without expanding', async () => {
      adapter.setDailyNotesSettings({
        format: 'YYYY-MM-DD',
        folder: '',
        template: 'templates/templater-daily.md',
      });
      adapter.addFolder('templates');
      const tpBody =
        '<%* const t = new Date(); %>\n# <% t.toISOString().slice(0,10) %>\n';
      adapter.addFile('templates/templater-daily.md', tpBody);

      const result = await handlers.dailyNote({ date: '2026-05-05', create: true });
      const structured = daily(result) as { content: string };
      expect(structured.content).toBe(tpBody);
    });

    it('creates an empty note with a warning when the configured template is missing (#470)', async () => {
      adapter.setDailyNotesSettings({
        format: 'YYYY-MM-DD',
        folder: '',
        template: 'templates/missing.md',
      });
      const result = await handlers.dailyNote({ date: '2026-05-05', create: true });
      expect(result.isError).toBeUndefined();
      const structured = daily(result) as {
        created: boolean;
        content: string;
        warning?: string;
      };
      expect(structured.created).toBe(true);
      expect(structured.content).toBe('');
      expect(structured.warning).toBe(
        'Template templates/missing.md (Daily notes settings) not found; created an empty note.',
      );
      expect(await adapter.readFile('2026-05-05.md')).toBe('');
      expect(getText(result)).toContain('warning: Template templates/missing.md');
    });

    it('has no warning when no template is configured or it exists (#470)', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
      const none = await handlers.dailyNote({ date: '2026-05-05', create: true });
      expect(daily(none)).not.toHaveProperty('warning');
      adapter.addFolder('templates');
      adapter.addFile('templates/daily.md', 'x');
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: 'templates/daily.md' });
      const found = await handlers.dailyNote({ date: '2026-05-06', create: true });
      expect(daily(found)).not.toHaveProperty('warning');
      expect(getText(found)).not.toContain('warning');
    });

    it('finds a template configured without .md, as Obsidian stores it (#470)', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: 'templates/daily' });
      adapter.addFolder('templates');
      adapter.addFile('templates/daily.md', '# {{title}} {{time}}');
      const result = await handlers.dailyNote({ date: '2026-05-05', create: true });
      const structured = daily(result) as { content: string; warning?: string };
      expect(structured.warning).toBeUndefined();
      // A past date is created at local midnight.
      expect(structured.content).toBe('# 2026-05-05 00:00');
    });
  });

  describe('date validation', () => {
    it('rejects malformed date strings', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
      // The schema regex is enforced by the dispatcher, but the handler
      // also tolerates direct calls; moment(strict) rejects the value.
      const result = await handlers.dailyNote({ date: 'not-a-date' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toMatch(/calendar/i);
    });

    it('rejects out-of-calendar dates that pass the regex', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
      const result = await handlers.dailyNote({ date: '2026-13-40' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toMatch(/calendar/i);
    });
  });

  describe('traversal-safety', () => {
    it('rejects when the configured format would traverse outside the vault', async () => {
      adapter.setDailyNotesSettings({
        format: '[../etc/]YYYY-MM-DD',
        folder: '',
        template: '',
      });
      const result = await handlers.dailyNote({ date: '2026-05-05', create: true });
      expect(result.isError).toBe(true);
      expect(getText(result)).toMatch(/traverse/i);
    });
  });

  describe('non-default format', () => {
    it('honors a folder-style format like YYYY/MM/DD', async () => {
      adapter.setDailyNotesSettings({
        format: 'YYYY/MM/DD',
        folder: 'Daily',
        template: '',
      });

      const result = await handlers.dailyNote({ date: '2026-05-05', create: true });
      expect(result.isError).toBeUndefined();
      const structured = daily(result) as { path: string; created: boolean };
      // moment formats forward-slashes literally → 'Daily/2026/05/05.md'
      expect(structured.path).toBe('Daily/2026/05/05.md');
      expect(structured.created).toBe(true);
    });

    it('honors a literal-bracketed format like [Daily-]YYYY-MM-DD', async () => {
      adapter.setDailyNotesSettings({
        format: '[Daily-]YYYY-MM-DD',
        folder: '',
        template: '',
      });

      const result = await handlers.dailyNote({ date: '2026-05-05', create: true });
      expect(result.isError).toBeUndefined();
      const structured = daily(result) as { path: string };
      expect(structured.path).toBe('Daily-2026-05-05.md');
    });
  });

  describe('create flag (#408)', () => {
    beforeEach(() => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: 'daily', template: '' });
    });

    it('create:false on a missing note returns exists:false and creates nothing', async () => {
      const result = await handlers.dailyNote({ date: '2026-03-04', create: false });
      expect(result.isError).toBeUndefined();
      expect(daily(result)).toEqual({
        path: 'daily/2026-03-04.md',
        created: false,
        exists: false,
      });
      expect(await adapter.exists('daily/2026-03-04.md')).toBe(false);
      expect(getText(result)).toContain('does not exist');
    });

    it('create:false on a missing note has a header and no note text', async () => {
      const result = await handlers.dailyNote({
        date: '2026-03-04',
        create: false,
      });
      expect(getText(result)).toBe(
        'path: daily/2026-03-04.md\nexists: false\ncreated: false\n\n' +
          'The daily note does not exist. Call again with create=true to create it.',
      );
    });

    it('create:false on an existing note reads it like the default', async () => {
      adapter.addFile('daily/2026-03-04.md', 'body');
      const result = await handlers.dailyNote({ date: '2026-03-04', create: false });
      expect(daily(result)).toEqual({
        path: 'daily/2026-03-04.md',
        created: false,
        exists: true,
        content: 'body',
      });
    });

    it('create:true (explicit) creates the note and reports exists:true', async () => {
      const result = await handlers.dailyNote({ date: '2026-03-04', create: true });
      expect(daily(result)).toEqual({
        path: 'daily/2026-03-04.md',
        created: true,
        exists: true,
        content: '',
      });
      expect(await adapter.exists('daily/2026-03-04.md')).toBe(true);
    });

    it('omitting create only looks the note up and creates nothing (#432)', async () => {
      const result = await handlers.dailyNote({ date: '2026-03-04' });
      expect(result.isError).toBeUndefined();
      expect(daily(result)).toEqual({
        path: 'daily/2026-03-04.md',
        created: false,
        exists: false,
      });
      expect(await adapter.exists('daily/2026-03-04.md')).toBe(false);
      expect(getText(result)).toContain('create=true');
    });

    it('omitting create for today does not create today\'s note (#432)', async () => {
      const today = moment().format('YYYY-MM-DD');
      const result = await handlers.dailyNote({});
      expect(daily(result)).toEqual({
        path: `daily/${today}.md`,
        created: false,
        exists: false,
      });
      expect(await adapter.exists(`daily/${today}.md`)).toBe(false);
    });

    it('an existing note reports exists:true without create', async () => {
      adapter.addFile('daily/2026-03-04.md', 'x');
      const result = await handlers.dailyNote({ date: '2026-03-04' });
      expect(daily(result)).toMatchObject({ created: false, exists: true });
    });
  });

  describe('modified header (#489)', () => {
    beforeEach(() => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: 'daily', template: '' });
      adapter.addFolder('daily');
    });

    async function metadataModified(path: string): Promise<unknown> {
      const meta = await handlers.getMetadata({ path });
      return (meta.structuredContent as { modified: unknown }).modified;
    }

    it('an existing note carries modified, the same as vault_get_metadata', async () => {
      adapter.addFile('daily/2026-03-04.md', 'x');
      const result = await handlers.dailyNote({ date: '2026-03-04' });
      const modified = windowOf(result).meta.modified;
      expect(modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(modified).toBe(await metadataModified('daily/2026-03-04.md'));
    });

    it('a newly created note carries modified, the same as vault_get_metadata', async () => {
      const result = await handlers.dailyNote({ date: '2026-03-04', create: true });
      expect(windowOf(result).meta.created).toBe('true');
      const modified = windowOf(result).meta.modified;
      expect(modified).toBeDefined();
      expect(modified).toBe(await metadataModified('daily/2026-03-04.md'));
    });

    it('modified is accepted as expectedMtime by the next write', async () => {
      adapter.addFile('daily/2026-03-04.md', 'x');
      const result = await handlers.dailyNote({ date: '2026-03-04' });
      const modified = windowOf(result).meta.modified;
      const update = await handlers.updateFile({
        path: 'daily/2026-03-04.md',
        content: 'y',
        expectedMtime: modified,
      });
      expect(update.isError).toBeUndefined();
    });

    it('a missing note without create has no modified', async () => {
      const result = await handlers.dailyNote({ date: '2026-03-04' });
      expect(windowOf(result).meta.modified).toBeUndefined();
    });
  });
});
