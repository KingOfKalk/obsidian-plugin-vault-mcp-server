import { describe, it, expect, beforeEach } from 'vitest';
import moment from 'moment';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';

function getText(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type === 'text') return item.text;
  return '';
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
      const structured = result.structuredContent as { path: string; created: boolean; content: string };
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
      const structured = result.structuredContent as { path: string; created: boolean; content: string };
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

      const result = await handlers.dailyNote({});
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { path: string; created: boolean; content: string };
      expect(structured.path).toBe(path);
      expect(structured.created).toBe(true);
      expect(structured.content).toBe('');
      // and the file actually exists in the mock vault
      expect(await adapter.readFile(path)).toBe('');
    });

    it('idempotent: a second call returns created=false', async () => {
      adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
      await handlers.dailyNote({});
      const result = await handlers.dailyNote({});
      const structured = result.structuredContent as { created: boolean };
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

      const result = await handlers.dailyNote({ date: '2026-05-05' });
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { content: string };
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

      const result = await handlers.dailyNote({ date: '2026-05-05' });
      const structured = result.structuredContent as { content: string };
      expect(structured.content).toBe(tpBody);
    });

    it('falls back to empty body when the configured template path is missing', async () => {
      adapter.setDailyNotesSettings({
        format: 'YYYY-MM-DD',
        folder: '',
        template: 'templates/missing.md',
      });
      const result = await handlers.dailyNote({ date: '2026-05-05' });
      const structured = result.structuredContent as { created: boolean; content: string };
      expect(structured.created).toBe(true);
      expect(structured.content).toBe('');
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
      const result = await handlers.dailyNote({ date: '2026-05-05' });
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

      const result = await handlers.dailyNote({ date: '2026-05-05' });
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { path: string; created: boolean };
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

      const result = await handlers.dailyNote({ date: '2026-05-05' });
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { path: string };
      expect(structured.path).toBe('Daily-2026-05-05.md');
    });
  });
});
