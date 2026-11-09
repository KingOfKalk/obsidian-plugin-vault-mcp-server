import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { PLUGIN_ID, connectClient, startMcpServer, writeNotes } from '../helpers';

/** Switch a module on or off the way the settings toggle does. */
async function setModuleEnabled(moduleId: string, enabled: boolean): Promise<void> {
  await browser.executeObsidian(
    ({ app }, pluginId, id, on) => {
      const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins;
      const plugin = plugins[pluginId] as {
        registry: { enableModule(id: string): void; disableModule(id: string): void };
      };
      if (on) plugin.registry.enableModule(id);
      else plugin.registry.disableModule(id);
    },
    PLUGIN_ID,
    moduleId,
    enabled,
  );
}

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

/**
 * #448: a module switched off in the settings is off for clients that are
 * already connected, and switching it back on reaches them too.
 */
describe('module switches reach open sessions', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    await writeNotes({ 'switch.md': '# Switch' });
    client = await connectClient();
  });

  after(async function () {
    await setModuleEnabled('vault', true);
    await client.close();
  });

  it('switching the vault module off drops its tools and rejects calls', async function () {
    expect(await toolNames(client)).toContain('vault_read');

    await setModuleEnabled('vault', false);

    const names = await toolNames(client);
    expect(names).not.toContain('vault_read');
    expect(names).toContain('server_info');
    await expect(
      client.callTool({ name: 'vault_read', arguments: { path: 'switch.md' } }),
    ).rejects.toThrow(/vault_read disabled/);
  });

  it('switching it back on makes the tools callable again', async function () {
    await setModuleEnabled('vault', true);

    expect(await toolNames(client)).toContain('vault_read');
    const result = await client.callTool({ name: 'vault_read', arguments: { path: 'switch.md' } });
    expect(result.isError).not.toBe(true);
  });
});
