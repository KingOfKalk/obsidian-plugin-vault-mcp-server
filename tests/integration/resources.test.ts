import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

describe('resources surface — end-to-end', () => {
  it('reads obsidian://vault/index and a vault file via the SDK transport', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('hello.md', '# Hello');
    const logger = new Logger('test', { debugMode: false, accessKey: '' });
    const registry = new ModuleRegistry(logger);
    const server = createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const indexResp = await client.readResource({ uri: 'obsidian://vault/index' });
    expect(indexResp.contents[0].mimeType).toBe('application/json');

    const fileResp = await client.readResource({ uri: 'obsidian://vault/hello.md' });
    expect(fileResp.contents[0]).toMatchObject({
      uri: 'obsidian://vault/hello.md',
      mimeType: 'text/markdown',
      text: '# Hello',
    });

    await client.close();
    await server.close();
  });
});
