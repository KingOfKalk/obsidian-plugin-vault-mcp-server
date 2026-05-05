import { describe, it, expect, beforeEach } from 'vitest';
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
      const today = new Date().toISOString().split('T')[0];
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
});
