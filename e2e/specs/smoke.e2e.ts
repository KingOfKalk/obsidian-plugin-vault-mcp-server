import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { readFileSync } from 'node:fs';
import { PLUGIN_ID, callTool, connectClient, startMcpServer } from '../helpers';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as { version: string };

/**
 * The open question of #441: does the plugin's port inside Obsidian (under
 * Xvfb, on a CI runner) answer the Node test process? Everything else
 * builds on this spec.
 */
describe('smoke', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
  });

  after(async function () {
    await client.close();
  });

  it('plugin is enabled', async function () {
    const enabled = await browser.executeObsidian(
      ({ app }, id) =>
        id in (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins,
      PLUGIN_ID,
    );
    expect(enabled).toBe(true);
  });

  it('handshake names the server and its version', function () {
    expect(client.getServerVersion()).toMatchObject({
      name: 'vault-mcp-server',
      version: manifest.version,
    });
  });

  it('server_info returns the manifest version', async function () {
    const info = await callTool<{ version: string; enabledModules: string[] }>(
      client,
      'server_info',
    );
    expect(info.version).toBe(manifest.version);
    expect(info.enabledModules.length).toBeGreaterThan(0);
  });

  it('tools/list is not empty', async function () {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names).toContain('server_info');
    expect(names).toContain('vault_read');
  });
});
