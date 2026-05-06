import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

describe('prompts surface — end-to-end', () => {
  it('lists all five prompts and serves prompts/get + completion/complete via the SDK transport', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/weekly.md', '# {{week}}\n\n{{notes}}');
    const logger = new Logger('test', { debugMode: false, accessKey: '' });
    const registry = new ModuleRegistry(logger);
    const server = createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: 'test', version: '0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    // prompts/list
    const list = await client.listPrompts();
    expect(list.prompts.map((p) => p.name).sort()).toEqual([
      'daily-note',
      'expand-template',
      'find-related',
      'fix-broken-links',
      'summarize-note',
    ]);

    // prompts/get for /summarize-note
    const summarize = await client.getPrompt({
      name: 'summarize-note',
      arguments: { path: 'notes/foo.md' },
    });
    expect(summarize.messages).toHaveLength(1);
    const sumText = (summarize.messages[0].content as { type: 'text'; text: string }).text;
    expect(sumText).toContain('notes/foo.md');
    expect(sumText).toContain('vault_read');

    // prompts/get for /expand-template (placeholder discovery in the message)
    const expand = await client.getPrompt({
      name: 'expand-template',
      arguments: { template: 'templates/weekly.md' },
    });
    const expText = (expand.messages[0].content as { type: 'text'; text: string }).text;
    expect(expText).toContain('week');
    expect(expText).toContain('notes');

    // completion/complete for /expand-template's `template` argument
    const completion = await client.complete({
      ref: { type: 'ref/prompt', name: 'expand-template' },
      argument: { name: 'template', value: 'week' },
    });
    expect(completion.completion.values).toContain('templates/weekly.md');

    // prompts/get for /daily-note — needs the daily-notes plugin enabled
    // in the mock so the underlying tool wouldn't throw if Claude called it.
    adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: '', template: '' });
    const daily = await client.getPrompt({
      name: 'daily-note',
      arguments: { date: '2026-05-05' },
    });
    const dailyText = (daily.messages[0].content as { type: 'text'; text: string }).text;
    expect(dailyText).toContain('vault_daily_note');
    expect(dailyText).toContain('workspace_open_file');
    expect(dailyText).toContain('2026-05-05');

    // prompts/get for /fix-broken-links — no path → vault-wide body
    const fixVaultWide = await client.getPrompt({
      name: 'fix-broken-links',
      arguments: {},
    });
    expect(fixVaultWide.messages).toHaveLength(1);
    const fixVaultWideText = (fixVaultWide.messages[0].content as { type: 'text'; text: string }).text;
    expect(fixVaultWideText).toContain('Fix broken links across the vault');
    expect(fixVaultWideText).toContain('search_unresolved_links');

    // prompts/get for /fix-broken-links — with path → single-note body
    const fixOne = await client.getPrompt({
      name: 'fix-broken-links',
      arguments: { path: 'notes/foo.md' },
    });
    const fixOneText = (fixOne.messages[0].content as { type: 'text'; text: string }).text;
    expect(fixOneText).toContain('notes/foo.md');
    expect(fixOneText).toContain('search_unresolved_links');

    // completion/complete for /fix-broken-links's `path` argument.
    // Pre-populate the mock with a note whose link metadata points at a
    // non-existent target, so getUnresolvedLinks() reports it.
    adapter.addFile('notes/with-broken-link.md', '');
    adapter.setMetadata('notes/with-broken-link.md', { links: [{ link: 'does-not-exist' }] });
    const fixCompletion = await client.complete({
      ref: { type: 'ref/prompt', name: 'fix-broken-links' },
      argument: { name: 'path', value: 'broken' },
    });
    expect(fixCompletion.completion.values).toContain('notes/with-broken-link.md');

    await client.close();
    await server.close();
  });
});
