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

/** Switch "Read and edit only" the way the settings toggle does (#517). */
async function setReadAndEditOnly(enabled: boolean): Promise<void> {
  await browser.executeObsidian(
    ({ app }, pluginId, on) => {
      const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins;
      const plugin = plugins[pluginId] as {
        settings: { readAndEditOnly: boolean };
        registry: { setReadAndEditOnly(on: boolean): void };
      };
      plugin.settings.readAndEditOnly = on;
      plugin.registry.setReadAndEditOnly(on);
    },
    PLUGIN_ID,
    enabled,
  );
}

/**
 * #517: "Read and edit only" hides the tools that delete or overwrite whole
 * files from clients that are already connected, and leaves editing on.
 */
describe('"Read and edit only" reaches open sessions', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    await writeNotes({ 'keep.md': '# Keep\n\nbody\n' });
    client = await connectClient();
  });

  after(async function () {
    await setReadAndEditOnly(false);
    await client.close();
  });

  it('hides delete and overwrite tools and rejects calls to them', async function () {
    expect(await toolNames(client)).toContain('vault_delete');

    await setReadAndEditOnly(true);

    const names = await toolNames(client);
    for (const hidden of ['vault_delete', 'vault_delete_folder', 'vault_update', 'vault_write_binary']) {
      expect(names).not.toContain(hidden);
    }
    expect(names).toContain('vault_replace');
    await expect(
      client.callTool({ name: 'vault_delete', arguments: { path: 'keep.md' } }),
    ).rejects.toThrow(/vault_delete disabled/);
    const read = await client.callTool({ name: 'vault_read', arguments: { path: 'keep.md' } });
    expect(read.isError).not.toBe(true);
  });

  it('editing in place still works', async function () {
    const result = await client.callTool({
      name: 'vault_append',
      arguments: { path: 'keep.md', content: '\nmore\n' },
    });
    expect(result.isError).not.toBe(true);
  });

  it('switching it off lists the tools again', async function () {
    await setReadAndEditOnly(false);
    expect(await toolNames(client)).toContain('vault_delete');
  });
});
