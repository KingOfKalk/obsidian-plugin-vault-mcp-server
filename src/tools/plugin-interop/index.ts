import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return { content: [{ type: 'text', text: `Error: ${m}` }], isError: true }; }

function createHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  return {
    listPlugins: () => {
      const plugins = adapter.getInstalledPlugins();
      return Promise.resolve(text(JSON.stringify(plugins)));
    },
    checkPlugin: (params) => {
      const pluginId = params.pluginId as string;
      const enabled = adapter.isPluginEnabled(pluginId);
      const plugins = adapter.getInstalledPlugins();
      const installed = plugins.some((p) => p.id === pluginId);
      return Promise.resolve(text(JSON.stringify({ pluginId, installed, enabled })));
    },
    dataviewQuery: (params) => {
      if (!adapter.isPluginEnabled('dataview')) {
        return Promise.resolve(err('Dataview plugin is not installed or enabled'));
      }
      // Dataview integration requires the Dataview API which is only available at runtime
      return Promise.resolve(text(JSON.stringify({
        note: 'Dataview query execution requires the Dataview plugin API at runtime',
        query: params.query as string,
      })));
    },
    templaterExecute: (params) => {
      if (!adapter.isPluginEnabled('templater-obsidian')) {
        return Promise.resolve(err('Templater plugin is not installed or enabled'));
      }
      return Promise.resolve(text(JSON.stringify({
        note: 'Templater execution requires the Templater plugin API at runtime',
        templatePath: params.templatePath as string,
      })));
    },
    executeCommand: (params) => {
      const commandId = params.commandId as string;
      const ok = adapter.executeCommand(commandId);
      return Promise.resolve(ok ? text(`Executed command: ${commandId}`) : err(`Command not found: ${commandId}`));
    },
  };
}

export function createPluginInteropModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'plugin-interop', name: 'Plugin Interop', description: 'List plugins, check status, execute commands, and integrate with Dataview/Templater', supportsReadOnly: false },
    tools(): ToolDefinition[] {
      return [
        { name: 'plugin_list', description: 'List installed plugins with status', schema: {}, handler: h.listPlugins, isReadOnly: true },
        { name: 'plugin_check', description: 'Check if a plugin is installed and enabled', schema: { pluginId: z.string().min(1) }, handler: h.checkPlugin, isReadOnly: true },
        { name: 'plugin_dataview_query', description: 'Execute a Dataview query', schema: { query: z.string().min(1) }, handler: h.dataviewQuery, isReadOnly: true },
        { name: 'plugin_templater_execute', description: 'Execute a Templater template', schema: { templatePath: z.string().min(1) }, handler: h.templaterExecute, isReadOnly: false },
        { name: 'plugin_execute_command', description: 'Execute an Obsidian command by ID', schema: { commandId: z.string().min(1) }, handler: h.executeCommand, isReadOnly: false },
      ];
    },
  };
}
