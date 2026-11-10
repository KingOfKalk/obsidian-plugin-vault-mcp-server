import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { PLUGIN_ID, connectClient, startMcpServer } from '../helpers';

/**
 * #518: Obsidian updates a plugin by unloading the old instance and loading
 * the new one, without waiting for `onunload`'s async work. With auto-start
 * on, the new instance must get the port back and answer again, even while
 * a client still holds an open session (and its SSE stream).
 */
describe('plugin reload (#518)', function () {
  let client: Client | null = null;

  before(async function () {
    await startMcpServer();
    // Auto-start, as a user with a running server has it.
    await browser.executeObsidian(
      async ({ app }, pluginId) => {
        const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
          .plugins.plugins[pluginId] as {
          settings: { autoStart: boolean };
          saveSettings(): Promise<void>;
        };
        plugin.settings.autoStart = true;
        await plugin.saveSettings();
      },
      PLUGIN_ID,
    );
    client = await connectClient();
    await client.listTools();
  });

  after(async function () {
    await client?.close().catch(() => undefined);
  });

  it('answers again after the plugin is disabled and enabled', async function () {
    await browser.executeObsidian(
      async ({ app }, pluginId) => {
        const plugins = (
          app as unknown as {
            plugins: {
              disablePlugin(id: string): Promise<void>;
              enablePlugin(id: string): Promise<void>;
            };
          }
        ).plugins;
        await plugins.disablePlugin(pluginId);
        await plugins.enablePlugin(pluginId);
      },
      PLUGIN_ID,
    );

    // The new instance auto-starts; wait for it to be listening.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(({ app }, pluginId) => {
          const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
            .plugins.plugins[pluginId] as
            | { httpServer: { isRunning: boolean } | null }
            | undefined;
          return plugin?.httpServer?.isRunning === true;
        }, PLUGIN_ID),
      { timeout: 10000, timeoutMsg: 'the reloaded plugin did not start its server' },
    );

    const startError = await browser.executeObsidian(({ app }, pluginId) => {
      const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
        .plugins.plugins[pluginId] as { lastStartError: { message: string } | null };
      return plugin.lastStartError?.message ?? null;
    }, PLUGIN_ID);
    expect(startError).toBeNull();

    await client?.close().catch(() => undefined);
    client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('server_info');
  });
});
