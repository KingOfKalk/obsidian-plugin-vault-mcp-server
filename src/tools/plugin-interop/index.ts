import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition, annotations } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

function createHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  return {
    listPlugins: (): Promise<CallToolResult> => {
      const plugins = adapter.getInstalledPlugins();
      return Promise.resolve(text(JSON.stringify(plugins)));
    },
    checkPlugin: (params): Promise<CallToolResult> => {
      const pluginId = params.pluginId as string;
      const enabled = adapter.isPluginEnabled(pluginId);
      const plugins = adapter.getInstalledPlugins();
      const installed = plugins.some((p) => p.id === pluginId);
      return Promise.resolve(text(JSON.stringify({ pluginId, installed, enabled })));
    },
    dataviewQuery: (params): Promise<CallToolResult> => {
      if (!adapter.isPluginEnabled('dataview')) {
        return Promise.resolve(err('Dataview plugin is not installed or enabled'));
      }
      // Dataview integration requires the Dataview API which is only available at runtime
      return Promise.resolve(text(JSON.stringify({
        note: 'Dataview query execution requires the Dataview plugin API at runtime',
        query: params.query as string,
      })));
    },
    templaterExecute: (params): Promise<CallToolResult> => {
      if (!adapter.isPluginEnabled('templater-obsidian')) {
        return Promise.resolve(err('Templater plugin is not installed or enabled'));
      }
      return Promise.resolve(text(JSON.stringify({
        note: 'Templater execution requires the Templater plugin API at runtime',
        templatePath: params.templatePath as string,
      })));
    },
    executeCommand: (params): Promise<CallToolResult> => {
      const commandId = params.commandId as string;
      const ok = adapter.executeCommand(commandId);
      return Promise.resolve(ok ? text(`Executed command: ${commandId}`) : err(`Command not found: ${commandId}`));
    },
  };
}

export function createPluginInteropModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'plugin-interop', name: 'Plugin Interop', description: 'List plugins, check status, execute commands, and integrate with Dataview/Templater' },
    tools(): ToolDefinition[] {
      return [
        {
          name: 'plugin_list',
          description: describeTool({
            summary: 'List every installed community plugin with its enabled flag.',
            returns: 'JSON: [{ id, name, enabled, ... }].',
          }),
          schema: {},
          handler: h.listPlugins,
          annotations: annotations.readExternal,
        },
        {
          name: 'plugin_check',
          description: describeTool({
            summary: 'Check whether a plugin is installed and enabled.',
            args: ['pluginId (string, 1..200): Plugin id, e.g. "dataview".'],
            returns: 'JSON: { pluginId, installed, enabled }.',
          }),
          schema: {
            pluginId: z
              .string()
              .min(1)
              .max(200)
              .describe('Community plugin id (e.g. "dataview")'),
          },
          handler: h.checkPlugin,
          annotations: annotations.readExternal,
        },
        {
          name: 'plugin_dataview_query',
          description: describeTool({
            summary: 'Execute a Dataview (DQL / dataview-js) query.',
            args: ['query (string, 1..10000): Dataview query text.'],
            returns: 'JSON envelope with the query echoed; full execution requires the Dataview plugin at runtime.',
            errors: ['"Dataview plugin is not installed or enabled" if the plugin is missing.'],
          }),
          schema: {
            query: z
              .string()
              .min(1)
              .max(10_000)
              .describe('Dataview query (DQL or Dataview-js)'),
          },
          handler: h.dataviewQuery,
          annotations: annotations.readExternal,
        },
        {
          name: 'plugin_templater_execute',
          description: describeTool({
            summary: 'Execute a Templater template file.',
            args: ['templatePath (string): Vault-relative path to the Templater template.'],
            returns: 'JSON envelope noting the template path; full execution requires the Templater plugin.',
            errors: ['"Templater plugin is not installed or enabled" if the plugin is missing.'],
          }),
          schema: {
            templatePath: z
              .string()
              .min(1)
              .max(4096)
              .describe('Vault-relative path to the Templater template'),
          },
          handler: h.templaterExecute,
          annotations: annotations.destructiveExternal,
        },
        {
          name: 'plugin_execute_command',
          description: describeTool({
            summary: 'Execute any Obsidian command by its id.',
            args: ['commandId (string, 1..200): Command id, e.g. "app:reload".'],
            returns: 'Plain text "Executed command: <id>" or an error if the command is unknown.',
            examples: ['Use when: triggering "editor:save-file" programmatically.'],
            errors: ['"Command not found" if the id is not registered.'],
          }),
          schema: {
            commandId: z
              .string()
              .min(1)
              .max(200)
              .describe('Obsidian command id (e.g. "app:reload")'),
          },
          handler: h.executeCommand,
          annotations: annotations.destructiveExternal,
        },
      ];
    },
  };
}
