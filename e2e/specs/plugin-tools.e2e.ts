import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  PLUGIN_ID,
  callToolError,
  connectClient,
  startMcpServer,
  waitForCache,
  writeNotes,
} from '../helpers';

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

/** Wait until the open session lists (or no longer lists) a tool. */
async function waitForListed(client: Client, name: string, listed: boolean): Promise<void> {
  await browser.waitUntil(async () => (await toolNames(client)).includes(name) === listed, {
    // The plugin polls plugin state every 5 s.
    timeout: 20000,
    interval: 500,
    timeoutMsg: `${name} ${listed ? 'not listed' : 'still listed'}`,
  });
}

/** Type into the settings tab's allowlist textarea and save it, as a user does. */
async function setAllowlistInSettings(ids: string[]): Promise<string[]> {
  return browser.executeObsidian(
    async ({ app }, pluginId, value) => {
      const setting = (app as unknown as {
        setting: {
          open(): void;
          openTabById(id: string): void;
          close(): void;
          activeTab: { containerEl: HTMLElement } | null;
        };
      }).setting;
      setting.open();
      setting.openTabById(pluginId);
      try {
        // Look in the tab's own element: on newer Obsidian versions it is
        // not reachable through `document` (checked on 1.15.0).
        const textarea = setting.activeTab?.containerEl.querySelector<HTMLTextAreaElement>(
          'textarea.vault-mcp-execute-command-allowlist',
        );
        if (!textarea) throw new Error('allowlist textarea not found');
        textarea.value = value;
        textarea.dispatchEvent(new Event('change'));
      } finally {
        setting.close();
      }
      const plugins = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins;
      const plugin = plugins[pluginId] as { settings: { executeCommandAllowlist: string[] } };
      // Give saveSettings a moment; the change handler does not await it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      return plugin.settings.executeCommandAllowlist;
    },
    PLUGIN_ID,
    ids.join('\n'),
  );
}

/** Enable or disable Dataview as the Community plugins tab does. */
async function setDataviewEnabled(enabled: boolean): Promise<void> {
  await browser.executeObsidian(async ({ app }, on) => {
    const plugins = (app as unknown as {
      plugins: {
        enablePluginAndSave?(id: string): Promise<boolean>;
        disablePluginAndSave?(id: string): Promise<boolean>;
        enablePlugin(id: string): Promise<boolean>;
        disablePlugin(id: string): Promise<boolean>;
      };
    }).plugins;
    if (on) {
      await (plugins.enablePluginAndSave?.('dataview') ?? plugins.enablePlugin('dataview'));
    } else {
      await (plugins.disablePluginAndSave?.('dataview') ?? plugins.disablePlugin('dataview'));
    }
  }, enabled);
}

/**
 * #469: plugin tools follow their plugin in a session that is already open.
 * `plugin_execute_command` is listed only while the command allowlist has an
 * entry; `plugin_dataview_query` only while Dataview is enabled (installed
 * disabled by wdio.conf.mts). Editor, workspace and ui are off in a new
 * install.
 */
describe('plugin tools follow their plugin (#469)', function () {
  let client: Client;
  let listChanged = 0;

  before(async function () {
    await startMcpServer();
    client = await connectClient(() => {
      listChanged++;
    });
  });

  after(async function () {
    await setAllowlistInSettings([]);
    await setDataviewEnabled(false);
    await client.close();
  });

  it('a new install lists no editor, workspace or ui tools', async function () {
    const names = await toolNames(client);
    expect(names.some((n) => /^(editor|workspace|ui)_/.test(n))).toBe(false);
    expect(names).toContain('vault_read');
    expect(names).toContain('plugin_list');
  });

  it('plugin_execute_command is hidden while the allowlist is empty', async function () {
    expect(await toolNames(client)).not.toContain('plugin_execute_command');
  });

  it('saving an allowlist in the settings lists it, with list_changed', async function () {
    const before = listChanged;
    expect(await setAllowlistInSettings(['app:toggle-left-sidebar'])).toEqual([
      'app:toggle-left-sidebar',
    ]);
    // Saving re-checks right away; no poll needed.
    expect(await toolNames(client)).toContain('plugin_execute_command');
    await browser.waitUntil(() => listChanged > before, {
      timeout: 5000,
      timeoutMsg: 'no notifications/tools/list_changed',
    });
    const text = await callToolError(client, 'plugin_execute_command', { commandId: 'app:reload' });
    expect(text).toContain('not on the executeCommand allowlist');
  });

  it('emptying the allowlist hides it again', async function () {
    await setAllowlistInSettings([]);
    expect(await toolNames(client)).not.toContain('plugin_execute_command');
    await expect(
      client.callTool({ name: 'plugin_execute_command', arguments: { commandId: 'app:reload' } }),
    ).rejects.toThrow(/plugin_execute_command disabled/);
  });

  it('plugin_dataview_query is hidden while Dataview is disabled', async function () {
    const installed = await browser.executeObsidian(({ app }) =>
      Object.keys((app as unknown as { plugins: { manifests: Record<string, unknown> } }).plugins
        .manifests),
    );
    expect(installed).toContain('dataview');
    expect(await toolNames(client)).not.toContain('plugin_dataview_query');
  });

  it('enabling Dataview lists plugin_dataview_query in the open session', async function () {
    const before = listChanged;
    await setDataviewEnabled(true);
    await waitForListed(client, 'plugin_dataview_query', true);
    expect(listChanged).toBeGreaterThan(before);

    await writeNotes({ 'dv/one.md': '---\nstatus: open\n---\n# One\n' });
    await waitForCache(['dv/one.md']);
    await browser.waitUntil(
      async () => {
        const result = await client.callTool({
          name: 'plugin_dataview_query',
          arguments: { query: 'LIST FROM "dv"' },
        });
        const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
        return result.isError !== true && text.includes('one');
      },
      { timeout: 30000, interval: 1000, timeoutMsg: 'Dataview query never listed dv/one.md' },
    );
  });

  it('disabling Dataview hides it again', async function () {
    await setDataviewEnabled(false);
    await waitForListed(client, 'plugin_dataview_query', false);
  });
});
