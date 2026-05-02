import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createPluginInteropModule } from '../../../src/tools/plugin-interop/index';

function getText(r: CallToolResult): string {
  return r.content[0].type === 'text' ? r.content[0].text : '';
}

describe('plugin interop module', () => {
  let adapter: MockObsidianAdapter;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
  });

  it('should register 6 tools', () => {
    const module = createPluginInteropModule(adapter);
    expect(module.tools()).toHaveLength(6);
  });

  it('registers the renamed dataview-js and templater describe tools', () => {
    const module = createPluginInteropModule(adapter);
    const names = module.tools().map((t) => t.name).sort();
    expect(names).toEqual([
      'plugin_check',
      'plugin_dataview_describe_js_query',
      'plugin_dataview_query',
      'plugin_execute_command',
      'plugin_list',
      'plugin_templater_describe_template',
    ]);
  });

  it('should list installed plugins (json)', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.addInstalledPlugin('templater-obsidian', 'Templater', false);
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_list')!;
    const result = await tool.handler({ response_format: 'json' });
    const data = JSON.parse(getText(result)) as { plugins: Array<{ id: string }> };
    expect(data.plugins).toHaveLength(2);
  });

  it('should check plugin status (json)', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_check')!;
    const result = await tool.handler({ pluginId: 'dataview', response_format: 'json' });
    const data = JSON.parse(getText(result)) as { installed: boolean; enabled: boolean };
    expect(data.installed).toBe(true);
    expect(data.enabled).toBe(true);
  });

  it('should return error for Dataview query when the plugin is not installed', async () => {
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_dataview_query')!;
    const result = await tool.handler({ query: 'TABLE file.name FROM "notes"' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Plugin not installed or disabled: dataview');
  });

  it('should return error for Dataview query when the plugin is enabled but the API is unavailable', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    // No setDataviewApi() call — getDataviewApi() returns null.
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_dataview_query')!;
    const result = await tool.handler({ query: 'TABLE file.name FROM "notes"' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Plugin API unavailable for dataview');
  });

  it('should execute a Dataview DQL query and return rendered markdown', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.setDataviewApi({
      queryMarkdown: async (query: string) => {
        expect(query).toBe('TABLE file.name FROM "notes"');
        return Promise.resolve({
          successful: true as const,
          value: '| file.name |\n|---|\n| a.md |\n| b.md |',
        });
      },
    });
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_dataview_query')!;
    const result = await tool.handler({ query: 'TABLE file.name FROM "notes"' });
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain('| file.name |');
    expect(result.structuredContent).toMatchObject({
      query: 'TABLE file.name FROM "notes"',
      markdown: expect.stringContaining('a.md') as unknown,
    });
  });

  it('surfaces queryMarkdown failures via the error envelope', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.setDataviewApi({
      queryMarkdown: async (_query: string) =>
        Promise.resolve({
          successful: false as const,
          error: 'syntax error near FROM',
        }),
    });
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_dataview_query')!;
    const result = await tool.handler({ query: 'TABLE FROM' });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Dataview query failed: syntax error near FROM');
  });

  it('plugin_dataview_describe_js_query echoes the source verbatim and never executes it', async () => {
    const module = createPluginInteropModule(adapter);
    const tool = module
      .tools()
      .find((t) => t.name === 'plugin_dataview_describe_js_query')!;
    const result = await tool.handler({
      query: 'dv.pages("#projects").file.name',
      response_format: 'json',
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      query: 'dv.pages("#projects").file.name',
    });
    const data = JSON.parse(getText(result)) as { note: string; query: string };
    expect(data.note).toContain('intentionally not performed');
  });

  it('plugin_templater_describe_template echoes the path and never executes it', async () => {
    const module = createPluginInteropModule(adapter);
    const tool = module
      .tools()
      .find((t) => t.name === 'plugin_templater_describe_template')!;
    const result = await tool.handler({
      templatePath: 'Templates/daily.md',
      response_format: 'json',
    });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(getText(result)) as {
      templatePath: string;
      note: string;
    };
    expect(data.templatePath).toBe('Templates/daily.md');
    expect(data.note).toContain('intentionally not performed');
  });

  describe('plugin_execute_command allowlist', () => {
    it('refuses every call when the allowlist is empty (default)', async () => {
      const module = createPluginInteropModule(adapter);
      const tool = module.tools().find((t) => t.name === 'plugin_execute_command')!;
      const result = await tool.handler({ commandId: 'app:toggle-left-sidebar' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Command execution disabled');
      expect(adapter.getExecutedCommands()).not.toContain('app:toggle-left-sidebar');
    });

    it('refuses commands not on the allowlist', async () => {
      const module = createPluginInteropModule(adapter, {
        getExecuteCommandAllowlist: () => ['app:reload'],
      });
      const tool = module.tools().find((t) => t.name === 'plugin_execute_command')!;
      const result = await tool.handler({ commandId: 'app:toggle-left-sidebar' });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('not on the executeCommand allowlist');
      expect(adapter.getExecutedCommands()).not.toContain('app:toggle-left-sidebar');
    });

    it('runs commands that are on the allowlist', async () => {
      const module = createPluginInteropModule(adapter, {
        getExecuteCommandAllowlist: () => ['app:toggle-left-sidebar'],
      });
      const tool = module.tools().find((t) => t.name === 'plugin_execute_command')!;
      const result = await tool.handler({ commandId: 'app:toggle-left-sidebar' });
      expect(result.isError).toBeUndefined();
      expect(adapter.getExecutedCommands()).toContain('app:toggle-left-sidebar');
    });

    it('reads the allowlist lazily on each call', async () => {
      let allowed: string[] = [];
      const module = createPluginInteropModule(adapter, {
        getExecuteCommandAllowlist: () => allowed,
      });
      const tool = module.tools().find((t) => t.name === 'plugin_execute_command')!;

      // First call: not on list.
      const r1 = await tool.handler({ commandId: 'app:reload' });
      expect(r1.isError).toBe(true);

      // User adds the command — next call should succeed without re-creating
      // the module.
      allowed = ['app:reload'];
      const r2 = await tool.handler({ commandId: 'app:reload' });
      expect(r2.isError).toBeUndefined();
    });
  });
});
