import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { callTool, connectClient, startMcpServer, writeNotes } from '../helpers';

/** The `options` object of a core plugin, as Obsidian keeps it in memory. */
type CoreOptions = Record<string, unknown>;

/**
 * Set (or with `undefined`, remove) one option of a core plugin, such as
 * the Templates plugin's `folder`, and optionally switch the plugin off.
 * Returns the previous value.
 */
async function setCoreOption(
  pluginId: string,
  key: string,
  value: string | undefined,
): Promise<string | undefined> {
  return browser.executeObsidian(
    ({ app }, id, k, v) => {
      const plugins = (
        app as unknown as {
          internalPlugins: { plugins: Record<string, { instance: { options: CoreOptions } }> };
        }
      ).internalPlugins.plugins;
      const options = plugins[id].instance.options;
      const previous = options[k];
      if (v === undefined) delete options[k];
      else options[k] = v;
      return typeof previous === 'string' ? previous : undefined;
    },
    pluginId,
    key,
    value,
  );
}

async function setCorePluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, id, on) => {
      const plugin = (
        app as unknown as {
          internalPlugins: {
            plugins: Record<string, { enable(b: boolean): Promise<void>; disable(b: boolean): Promise<void> }>;
          };
        }
      ).internalPlugins.plugins[id];
      if (on) await plugin.enable(true);
      else await plugin.disable(true);
    },
    pluginId,
    enabled,
  );
}

/**
 * template_list reads the folder set in Obsidian's core Templates plugin
 * (`instance.options.folder`), falls back to `templates`, and lists
 * subfolders too (#470).
 */
describe('templates: configured folder', function () {
  let client: Client;
  let previousFolder: string | undefined;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({
      'Meta/Tpl/Daily.md': '# {{title}}\n',
      'Meta/Tpl/work/Meeting.md': '# Meeting {{date}}\n',
      'templates/Fallback.md': 'fallback\n',
    });
    previousFolder = await setCoreOption('templates', 'folder', 'Meta/Tpl');
  });

  after(async function () {
    await setCoreOption('templates', 'folder', previousFolder);
    await setCorePluginEnabled('templates', true);
    await client.close();
  });

  it('lists the configured folder recursively', async function () {
    const result = await callTool<{ folder: string; files: string[] }>(client, 'template_list');
    expect(result.folder).toBe('Meta/Tpl');
    expect([...result.files].sort()).toEqual(['Meta/Tpl/Daily.md', 'Meta/Tpl/work/Meeting.md']);
  });

  it('keeps using the configured folder while the Templates plugin is off', async function () {
    await setCorePluginEnabled('templates', false);
    const result = await callTool<{ folder: string }>(client, 'template_list');
    expect(result.folder).toBe('Meta/Tpl');
    await setCorePluginEnabled('templates', true);
  });

  it('falls back to "templates" when no folder is set', async function () {
    await setCoreOption('templates', 'folder', undefined);
    const result = await callTool<{ folder: string; files: string[] }>(client, 'template_list');
    expect(result).toEqual({ folder: 'templates', files: ['templates/Fallback.md'] });
    await setCoreOption('templates', 'folder', 'Meta/Tpl');
  });

  it('template_create_from fills {{title}} with the new file name', async function () {
    const result = await callTool<{ path: string }>(client, 'template_create_from', {
      templatePath: 'Meta/Tpl/Daily.md',
      destPath: 'tplout/Ada Lovelace.md',
    });
    expect(result.path).toBe('tplout/Ada Lovelace.md');
    const content = await browser.executeObsidian(
      ({ app }, p) => app.vault.adapter.read(p),
      'tplout/Ada Lovelace.md',
    );
    expect(content).toBe('# Ada Lovelace\n');
  });
});

/**
 * vault_daily_note warns when the template set in the Daily notes plugin is
 * missing, and finds one stored without `.md` as Obsidian does (#470).
 */
describe('daily note: configured template', function () {
  let client: Client;
  let previousTemplate: string | undefined;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({ 'Meta/Daily template.md': 'Day {{title}}\n' });
    previousTemplate = await setCoreOption('daily-notes', 'template', 'Meta/Missing');
  });

  after(async function () {
    await setCoreOption('daily-notes', 'template', previousTemplate);
    await client.close();
  });

  it('returns a warning when the template file is missing', async function () {
    const result = await callTool<{ path: string; created: boolean; warning?: string; content: string }>(
      client,
      'vault_daily_note',
      { date: '2020-01-01', create: true },
    );
    expect(result.created).toBe(true);
    expect(result.content).toBe('');
    expect(result.warning).toContain('Meta/Missing');
  });

  it('expands a template configured without .md', async function () {
    await setCoreOption('daily-notes', 'template', 'Meta/Daily template');
    const result = await callTool<{ path: string; warning?: string; content: string }>(
      client,
      'vault_daily_note',
      { date: '2020-01-02', create: true },
    );
    expect(result.warning).toBeUndefined();
    expect(result.content).toBe('Day 2020-01-02\n');
  });
});
