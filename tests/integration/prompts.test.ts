import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

describe('prompts surface — end-to-end', () => {
  it('lists all three prompts and serves prompts/get + completion/complete via the SDK transport', async () => {
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
      'expand-template',
      'find-related',
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

    await client.close();
    await server.close();
  });
});
