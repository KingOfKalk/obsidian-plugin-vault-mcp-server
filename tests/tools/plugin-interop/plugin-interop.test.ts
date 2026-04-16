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

  it('should register 5 tools', () => {
    const module = createPluginInteropModule(adapter);
    expect(module.tools()).toHaveLength(5);
  });

  it('should list installed plugins', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.addInstalledPlugin('templater-obsidian', 'Templater', false);
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_list')!;
    const result = await tool.handler({});
    const data = JSON.parse(getText(result)) as Array<{ id: string }>;
    expect(data).toHaveLength(2);
  });

  it('should check plugin status', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_check')!;
    const result = await tool.handler({ pluginId: 'dataview' });
    const data = JSON.parse(getText(result)) as { installed: boolean; enabled: boolean };
    expect(data.installed).toBe(true);
    expect(data.enabled).toBe(true);
  });

  it('should return error for Dataview query when not installed', async () => {
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_dataview_query')!;
    const result = await tool.handler({ query: 'TABLE file.name FROM "notes"' });
    expect(result.isError).toBe(true);
  });

  it('should execute a command', async () => {
    const module = createPluginInteropModule(adapter);
    const tool = module.tools().find((t) => t.name === 'plugin_execute_command')!;
    const result = await tool.handler({ commandId: 'app:toggle-left-sidebar' });
    expect(result.isError).toBeUndefined();
    expect(adapter.getExecutedCommands()).toContain('app:toggle-left-sidebar');
  });
});
