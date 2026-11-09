/**
 * Module and tool switches reach MCP sessions that are already open (#448).
 *
 * Runs the real `HttpMcpServer` and the SDK client over Streamable HTTP, the
 * same path a real client takes. Each session gets its own `McpServer`, so
 * every open session has to follow the registry on its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { HttpMcpServer } from '../../src/server/http-server';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { discoverModules } from '../../src/tools';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

// A fresh port per test: fetch keeps connections alive, and a pooled
// connection to the previous test's (stopped) server fails with
// "other side closed".
const BASE_PORT = 38760;
let testIndex = 0;
let TEST_PORT = BASE_PORT;
let URL_MCP = new URL(`http://127.0.0.1:${String(TEST_PORT)}/mcp`);

class QuietLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
}

interface Connected {
  client: Client;
  /** Number of `notifications/tools/list_changed` received so far. */
  listChanged: () => number;
  /** Resolves on the next `notifications/tools/list_changed`. */
  nextListChanged: () => Promise<void>;
}

let registry: ModuleRegistry;
let server: HttpMcpServer;
let clients: Client[];

beforeEach(async () => {
  TEST_PORT = BASE_PORT + testIndex++;
  URL_MCP = new URL(`http://127.0.0.1:${String(TEST_PORT)}/mcp`);
  const adapter = new MockObsidianAdapter();
  adapter.addFile('note.md', '# Note');
  const logger = new QuietLogger('test', { debugMode: false, accessKey: '' });
  registry = new ModuleRegistry(logger);
  for (const m of discoverModules(adapter)) registry.registerModule(m);
  clients = [];
  server = new HttpMcpServer(
    () => createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger),
    logger,
    {
      host: '127.0.0.1',
      port: TEST_PORT,
      authEnabled: false,
      accessKey: '',
      sessionSweepIntervalMs: 0,
    },
  );
  await server.start();
});

afterEach(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await server.stop();
});

/**
 * Connect a client and wait until its standalone GET SSE stream is open:
 * server-initiated notifications travel on that stream, and the client
 * opens it in the background after `initialize`.
 */
async function connect(): Promise<Connected> {
  let resolveStream: () => void = () => undefined;
  const streamOpen = new Promise<void>((resolve) => {
    resolveStream = resolve;
  });
  const transport = new StreamableHTTPClientTransport(URL_MCP, {
    fetch: async (input, init): Promise<Response> => {
      const response = await fetch(input, init);
      if ((init?.method ?? 'GET') === 'GET' && response.ok) resolveStream();
      return response;
    },
  });
  const client = new Client({ name: 'live-switch-test', version: '0' });
  let count = 0;
  let waiters: Array<() => void> = [];
  client.setNotificationHandler('notifications/tools/list_changed', () => {
    count++;
    const pending = waiters;
    waiters = [];
    for (const w of pending) w();
  });
  await client.connect(transport);
  clients.push(client);
  await streamOpen;
  return {
    client,
    listChanged: () => count,
    nextListChanged: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
      }),
  };
}

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

/** Drop the session the way an idle sweep or a client DELETE would. */
function deleteSession(sessionId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/mcp',
        method: 'DELETE',
        headers: {
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2025-11-25',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve(res.statusCode ?? 0);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('live module switches (#448)', () => {
  it('switching a module off drops its tools from tools/list and rejects calls', async () => {
    const { client } = await connect();
    expect(await toolNames(client)).toContain('vault_read');
    const before = await client.callTool({ name: 'vault_read', arguments: { path: 'note.md' } });
    expect(before.isError).not.toBe(true);

    registry.disableModule('vault');

    const names = await toolNames(client);
    expect(names).not.toContain('vault_read');
    expect(names).toContain('server_info');
    expect(names).toContain('search_fulltext');
    await expect(
      client.callTool({ name: 'vault_read', arguments: { path: 'note.md' } }),
    ).rejects.toThrow(/vault_read disabled/);
  });

  it('switching a module back on lists it again and makes it callable', async () => {
    registry.disableModule('vault');
    const { client } = await connect();
    expect(await toolNames(client)).not.toContain('vault_read');

    registry.enableModule('vault');

    expect(await toolNames(client)).toContain('vault_read');
    const result = await client.callTool({ name: 'vault_read', arguments: { path: 'note.md' } });
    expect(result.isError).not.toBe(true);
  });

  it('per-tool switches of an extras module reach the open session', async () => {
    const { client } = await connect();
    expect(await toolNames(client)).not.toContain('extras_get_date');

    registry.setToolEnabled('extras', 'extras_get_date', true);
    expect(await toolNames(client)).toContain('extras_get_date');
    // Registered only now, still with the trimmed schemas (#451).
    const { tools } = await client.listTools();
    const listed = tools.find((t) => t.name === 'extras_get_date');
    expect(JSON.stringify(listed)).not.toContain('$schema');
    expect(listed?.annotations).not.toHaveProperty('title');
    expect(listed?.inputSchema.additionalProperties).toBe(false);
    expect(listed?.outputSchema?.type).toBe('object');
    expect(listed?.outputSchema).not.toHaveProperty('additionalProperties');
    const result = await client.callTool({ name: 'extras_get_date', arguments: {} });
    expect(result.isError).not.toBe(true);

    registry.setToolEnabled('extras', 'extras_get_date', false);
    expect(await toolNames(client)).not.toContain('extras_get_date');
    await expect(client.callTool({ name: 'extras_get_date', arguments: {} })).rejects.toThrow(
      /extras_get_date disabled/,
    );
  });

  it('sends one notifications/tools/list_changed per switch', async () => {
    const c = await connect();
    const offNotified = c.nextListChanged();
    registry.disableModule('vault');
    await offNotified;
    const onNotified = c.nextListChanged();
    registry.enableModule('vault');
    await onNotified;
    // A module flips many tools at once; the SDK coalesces them.
    expect(c.listChanged()).toBe(2);
  });

  it('a change that leaves the active tools unchanged sends no notification', async () => {
    const c = await connect();
    registry.applyState(registry.getState());
    // A round trip after the change: a notification would have been written first.
    await c.client.listTools();
    expect(c.listChanged()).toBe(0);
  });

  it('a module refresh (clear and register again) keeps the tools and notifies once', async () => {
    const c = await connect();
    const before = await toolNames(c.client);
    const notified = c.nextListChanged();
    const state = registry.getState();

    // What McpPlugin.refreshModules does, in one synchronous burst.
    registry.clear();
    for (const m of discoverModules(new MockObsidianAdapter())) registry.registerModule(m);
    registry.applyState(state);

    await notified;
    expect(await toolNames(c.client)).toEqual(before);
    expect(c.listChanged()).toBe(1);
  });

  it('updates every open session', async () => {
    const a = await connect();
    const b = await connect();
    expect(server.activeSessions).toBe(2);
    const notifiedA = a.nextListChanged();
    const notifiedB = b.nextListChanged();

    registry.disableModule('vault');

    await Promise.all([notifiedA, notifiedB]);
    expect(await toolNames(a.client)).not.toContain('vault_read');
    expect(await toolNames(b.client)).not.toContain('vault_read');
  });

  it('closing a session removes its registry subscription', async () => {
    const a = await connect();
    const b = await connect();
    expect(registry.changeHandlerCount).toBe(2);

    const sessionId = (a.client.transport as StreamableHTTPClientTransport).sessionId;
    expect(sessionId).toBeDefined();
    expect(await deleteSession(sessionId ?? '')).toBe(200);
    expect(server.activeSessions).toBe(1);
    expect(registry.changeHandlerCount).toBe(1);

    // The remaining session still follows the registry.
    registry.disableModule('vault');
    expect(await toolNames(b.client)).not.toContain('vault_read');

    await server.stop();
    expect(registry.changeHandlerCount).toBe(0);
  });

  it('an idle-swept session unsubscribes too', async () => {
    let now = 0;
    await server.stop();
    const adapter = new MockObsidianAdapter();
    const logger = new QuietLogger('test', { debugMode: false, accessKey: '' });
    server = new HttpMcpServer(
      () => createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger),
      logger,
      {
        host: '127.0.0.1',
        port: TEST_PORT,
        authEnabled: false,
        accessKey: '',
        sessionIdleTimeoutMs: 1000,
        sessionSweepIntervalMs: 0,
      },
      () => now,
    );
    await server.start();
    await connect();
    expect(registry.changeHandlerCount).toBe(1);

    now = 5000;
    server.runIdleSweepNow();
    await vi.waitFor(() => {
      expect(registry.changeHandlerCount).toBe(0);
    });
  });

  it('a rejected initialize leaves no subscription behind', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Missing text/event-stream: the transport answers 406.
            Accept: 'application/json',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => {
            resolve(res.statusCode ?? 0);
          });
        },
      );
      req.on('error', reject);
      req.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'bad', version: '0' },
          },
        }),
      );
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(server.activeSessions).toBe(0);
    expect(registry.changeHandlerCount).toBe(0);
  });
});
