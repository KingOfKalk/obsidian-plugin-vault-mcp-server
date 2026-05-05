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
});
