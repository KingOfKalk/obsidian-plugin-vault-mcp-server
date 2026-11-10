/**
 * Plugin tools follow their plugin (#469): `plugin_dataview_query` is listed
 * only while Dataview is enabled, `plugin_execute_command` only while the
 * command allowlist has an entry. Both appear and disappear in sessions that
 * are already open, with `notifications/tools/list_changed`, through the
 * live switching of #448.
 *
 * Runs the real `HttpMcpServer` and the SDK client over Streamable HTTP.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { HttpMcpServer } from '../../src/server/http-server';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { startAvailabilityPolling } from '../../src/registry/availability';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { discoverModules } from '../../src/tools';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

const BASE_PORT = 38880;
let testIndex = 0;
let URL_MCP: URL;

class QuietLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
}

interface Connected {
  client: Client;
  listChanged: () => number;
  nextListChanged: () => Promise<void>;
}

let adapter: MockObsidianAdapter;
let allowlist: string[];
let registry: ModuleRegistry;
let server: HttpMcpServer;
let clients: Client[];

beforeEach(async () => {
  const port = BASE_PORT + testIndex++;
  URL_MCP = new URL(`http://127.0.0.1:${String(port)}/mcp`);
  adapter = new MockObsidianAdapter();
  adapter.addInstalledPlugin('dataview', 'Dataview', false);
  adapter.setDataviewApi({
    queryMarkdown: (): Promise<{ successful: true; value: string }> =>
      Promise.resolve({ successful: true, value: '- [[note]]' }),
  });
  allowlist = [];
  const logger = new QuietLogger('test', { debugMode: false, accessKey: '' });
  registry = new ModuleRegistry(logger);
  for (const m of discoverModules(adapter, { getExecuteCommandAllowlist: () => allowlist })) {
    registry.registerModule(m);
  }
  clients = [];
  server = new HttpMcpServer(
    () => createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger),
    logger,
    { host: '127.0.0.1', port, authEnabled: false, accessKey: '', sessionSweepIntervalMs: 0 },
  );
  await server.start();
});

afterEach(async () => {
  vi.useRealTimers();
  for (const c of clients) await c.close().catch(() => undefined);
  await server.stop();
});

/** Connect and wait for the standalone SSE stream notifications travel on. */
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
  const client = new Client({ name: 'conditional-tools-test', version: '0' });
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

describe('plugin tools follow their plugin (#469)', () => {
  it('hides both tools while Dataview is disabled and the allowlist is empty', async () => {
    const { client } = await connect();
    const names = await toolNames(client);
    expect(names).not.toContain('plugin_dataview_query');
    expect(names).not.toContain('plugin_execute_command');
    // The rest of the module stays.
    expect(names).toContain('plugin_list');
    expect(names).toContain('plugin_check');
    expect(names).not.toContain('plugin_dataview_describe_js_query');
    await expect(
      client.callTool({ name: 'plugin_execute_command', arguments: { commandId: 'x' } }),
    ).rejects.toThrow(/plugin_execute_command (disabled|not found)/);
  });

  it('a session started after Dataview was enabled lists the query tool without waiting for a poll', async () => {
    adapter.setPluginEnabled('dataview', true);
    const { client } = await connect();
    expect(await toolNames(client)).toContain('plugin_dataview_query');
  });

  it('Dataview enabled and disabled while a session is open: the tool appears and goes, with list_changed', async () => {
    const c = await connect();
    expect(await toolNames(c.client)).not.toContain('plugin_dataview_query');

    let notified = c.nextListChanged();
    adapter.setPluginEnabled('dataview', true);
    expect(registry.refreshAvailability()).toBe(true);
    await notified;
    expect(await toolNames(c.client)).toContain('plugin_dataview_query');
    const result = await c.client.callTool({
      name: 'plugin_dataview_query',
      arguments: { query: 'LIST' },
    });
    expect(result.isError).not.toBe(true);

    notified = c.nextListChanged();
    adapter.setPluginEnabled('dataview', false);
    registry.refreshAvailability();
    await notified;
    expect(await toolNames(c.client)).not.toContain('plugin_dataview_query');
    expect(c.listChanged()).toBe(2);
  });

  it('the availability poll picks up a late Dataview load', async () => {
    const c = await connect();
    const stop = startAvailabilityPolling(registry, 20);
    try {
      const notified = c.nextListChanged();
      // Dataview finishes loading after this plugin and the session.
      adapter.setPluginEnabled('dataview', true);
      await notified;
      expect(await toolNames(c.client)).toContain('plugin_dataview_query');
    } finally {
      stop();
    }
  });

  it('filling and emptying the allowlist shows and hides plugin_execute_command, with list_changed', async () => {
    const c = await connect();
    expect(await toolNames(c.client)).not.toContain('plugin_execute_command');

    let notified = c.nextListChanged();
    // What the settings tab does on save.
    allowlist = ['editor:save-file'];
    registry.refreshAvailability();
    await notified;
    expect(await toolNames(c.client)).toContain('plugin_execute_command');

    notified = c.nextListChanged();
    allowlist = [];
    registry.refreshAvailability();
    await notified;
    expect(await toolNames(c.client)).not.toContain('plugin_execute_command');
    expect(c.listChanged()).toBe(2);
  });

  it('a poll without a change sends no notification', async () => {
    const c = await connect();
    expect(registry.refreshAvailability()).toBe(false);
    await c.client.listTools();
    expect(c.listChanged()).toBe(0);
  });

  it('switching plugin-interop off hides the tools even when they are available', async () => {
    adapter.setPluginEnabled('dataview', true);
    allowlist = ['editor:save-file'];
    const { client } = await connect();
    expect(await toolNames(client)).toEqual(
      expect.arrayContaining(['plugin_dataview_query', 'plugin_execute_command']),
    );
    registry.disableModule('plugin-interop');
    const names = await toolNames(client);
    expect(names).not.toContain('plugin_dataview_query');
    expect(names).not.toContain('plugin_execute_command');
  });

  it('a new install lists no editor, workspace or ui tools', async () => {
    const { client } = await connect();
    const names = await toolNames(client);
    expect(names.some((n) => n.startsWith('editor_'))).toBe(false);
    expect(names.some((n) => n.startsWith('workspace_'))).toBe(false);
    expect(names.some((n) => n.startsWith('ui_'))).toBe(false);
    expect(names).toContain('vault_read');
    expect(names).toContain('search_fulltext');
    expect(names).toContain('template_list');
  });
});
