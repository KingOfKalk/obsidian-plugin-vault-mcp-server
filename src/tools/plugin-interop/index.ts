import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
  type InferredParams,
} from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';
import {
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';
import type { ModuleOptions } from '../index';

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

const listSchema = { ...responseFormatField };

const checkSchema = {
  pluginId: z
    .string()
    .min(1)
    .max(200)
    .describe('Community plugin id (e.g. "dataview")'),
  ...responseFormatField,
};

const dataviewSchema = {
  query: z
    .string()
    .min(1)
    .max(10_000)
    .describe('Dataview query (DQL or Dataview-js)'),
  ...responseFormatField,
};

const templaterSchema = {
  templatePath: z
    .string()
    .min(1)
    .max(4096)
    .describe('Vault-relative path to the Templater template'),
};

const executeCommandSchema = {
  commandId: z
    .string()
    .min(1)
    .max(200)
    .describe('Obsidian command id (e.g. "app:reload")'),
};

interface PluginInteropHandlers {
  listPlugins: (params: InferredParams<typeof listSchema>) => Promise<CallToolResult>;
  checkPlugin: (params: InferredParams<typeof checkSchema>) => Promise<CallToolResult>;
  dataviewQuery: (params: InferredParams<typeof dataviewSchema>) => Promise<CallToolResult>;
  templaterExecute: (params: InferredParams<typeof templaterSchema>) => Promise<CallToolResult>;
  executeCommand: (params: InferredParams<typeof executeCommandSchema>) => Promise<CallToolResult>;
}

function createHandlers(
  adapter: ObsidianAdapter,
  getExecuteCommandAllowlist: () => string[],
): PluginInteropHandlers {
  return {
    listPlugins: (params): Promise<CallToolResult> => {
      const plugins = adapter.getInstalledPlugins();
      return Promise.resolve(
        makeResponse(
          { plugins },
          (v) =>
            v.plugins.length === 0
              ? 'No community plugins installed.'
              : v.plugins
                  .map(
                    (p) =>
                      `- **${p.name ?? p.id}** (\`${p.id}\`) — ${p.enabled ? 'enabled' : 'disabled'}`,
                  )
                  .join('\n'),
          readResponseFormat(params),
        ),
      );
    },
    checkPlugin: (params): Promise<CallToolResult> => {
      const enabled = adapter.isPluginEnabled(params.pluginId);
      const plugins = adapter.getInstalledPlugins();
      const installed = plugins.some((p) => p.id === params.pluginId);
      return Promise.resolve(
        makeResponse(
          { pluginId: params.pluginId, installed, enabled },
          (v) =>
            `**${v.pluginId}** — ${v.installed ? 'installed' : 'not installed'}, ${v.enabled ? 'enabled' : 'disabled'}`,
          readResponseFormat(params),
        ),
      );
    },
    dataviewQuery: (params): Promise<CallToolResult> => {
      if (!adapter.isPluginEnabled('dataview')) {
        return Promise.resolve(err('Dataview plugin is not installed or enabled'));
      }
      const payload = {
        note: 'Dataview query execution requires the Dataview plugin API at runtime',
        query: params.query,
      };
      return Promise.resolve(
        makeResponse(
          payload,
          (v) => `_${v.note}_\n\n\`\`\`dataview\n${v.query}\n\`\`\``,
          readResponseFormat(params),
        ),
      );
    },
    templaterExecute: (params): Promise<CallToolResult> => {
      if (!adapter.isPluginEnabled('templater-obsidian')) {
        return Promise.resolve(err('Templater plugin is not installed or enabled'));
      }
      return Promise.resolve(text(JSON.stringify({
        note: 'Templater execution requires the Templater plugin API at runtime',
        templatePath: params.templatePath,
      })));
    },
    executeCommand: (params): Promise<CallToolResult> => {
      const allowlist = getExecuteCommandAllowlist();
      if (allowlist.length === 0) {
        return Promise.resolve(
          err(
            'Command execution disabled — enable commands individually in Obsidian MCP settings.',
          ),
        );
      }
      if (!allowlist.includes(params.commandId)) {
        return Promise.resolve(
          err(
            `Command "${params.commandId}" is not on the executeCommand allowlist. Add it in Obsidian MCP settings if you trust it.`,
          ),
        );
      }
      const ok = adapter.executeCommand(params.commandId);
      return Promise.resolve(
        ok
          ? text(`Executed command: ${params.commandId}`)
          : err(`Command not found: ${params.commandId}`),
      );
    },
  };
}

export function createPluginInteropModule(
  adapter: ObsidianAdapter,
  options: ModuleOptions = {},
): ToolModule {
  const h = createHandlers(
    adapter,
    options.getExecuteCommandAllowlist ?? ((): string[] => []),
  );
  return {
    metadata: { id: 'plugin-interop', name: 'Plugin Interop', description: 'List plugins, check status, execute commands, and integrate with Dataview/Templater' },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'plugin_list',
          description: describeTool({
            summary: 'List every installed community plugin with its enabled flag.',
            returns: 'JSON: [{ id, name, enabled, ... }].',
          }, listSchema),
          schema: listSchema,
          handler: h.listPlugins,
          annotations: annotations.readExternal,
        }),
        defineTool({
          name: 'plugin_check',
          description: describeTool({
            summary: 'Check whether a plugin is installed and enabled.',
            args: ['pluginId (string, 1..200): Plugin id, e.g. "dataview".'],
            returns: 'JSON: { pluginId, installed, enabled }.',
          }, checkSchema),
          schema: checkSchema,
          handler: h.checkPlugin,
          annotations: annotations.readExternal,
        }),
        defineTool({
          name: 'plugin_dataview_query',
          description: describeTool({
            summary: 'Execute a Dataview (DQL / dataview-js) query.',
            args: ['query (string, 1..10000): Dataview query text.'],
            returns: 'JSON envelope with the query echoed; full execution requires the Dataview plugin at runtime.',
            errors: ['"Dataview plugin is not installed or enabled" if the plugin is missing.'],
          }, dataviewSchema),
          schema: dataviewSchema,
          handler: h.dataviewQuery,
          annotations: annotations.readExternal,
        }),
        defineTool({
          name: 'plugin_templater_execute',
          description: describeTool({
            summary: 'Execute a Templater template file.',
            args: ['templatePath (string): Vault-relative path to the Templater template.'],
            returns: 'JSON envelope noting the template path; full execution requires the Templater plugin.',
            errors: ['"Templater plugin is not installed or enabled" if the plugin is missing.'],
          }),
          schema: templaterSchema,
          handler: h.templaterExecute,
          annotations: annotations.destructiveExternal,
        }),
        defineTool({
          name: 'plugin_execute_command',
          description: describeTool({
            summary: 'Execute any Obsidian command by its id.',
            args: ['commandId (string, 1..200): Command id, e.g. "app:reload".'],
            returns: 'Plain text "Executed command: <id>" or an error if the command is unknown.',
            examples: ['Use when: triggering "editor:save-file" programmatically.'],
            errors: ['"Command not found" if the id is not registered.'],
          }),
          schema: executeCommandSchema,
          handler: h.executeCommand,
          annotations: annotations.destructiveExternal,
        }),
      ];
    },
  };
}
