import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
} from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import {
  PluginApiUnavailableError,
  PluginNotInstalledError,
  errorResult,
} from '../shared/errors';
import { describeTool } from '../shared/describe';
import { safeHandler } from '../shared/handler';
import { noParamsSchema } from '../shared/schemas';
import { dataResponse, documentResponse } from '../shared/response';
import { fitItems } from '../shared/pagination';
import type { ModuleOptions } from '../index';

const checkSchema = {
  pluginId: z
    .string()
    .min(1)
    .max(200)
    .describe('Community plugin id (e.g. "dataview")'),
};

const dataviewSchema = {
  query: z
    .string()
    .min(1)
    .max(10_000)
    .describe('Dataview DQL query text. DataviewJS is never executed.'),
};

const executeCommandSchema = {
  commandId: z
    .string()
    .min(1)
    .max(200)
    .describe('Obsidian command id (e.g. "editor:save-file"); must be on the user\'s allowlist.'),
};

/**
 * Output schemas of the plugin-interop data tools (#467): each shape
 * mirrors what the handler puts on `structuredContent`, which is also the
 * JSON text. plugin_dataview_query is a document tool and has none.
 */
const pluginListOutputSchema = {
  plugins: z
    .array(
      z.object({
        id: z.string().describe('Plugin id (e.g. "dataview").'),
        name: z.string().describe('Human-readable plugin name.'),
        enabled: z.boolean().describe('Whether the plugin is currently enabled.'),
      }),
    )
    .describe('All installed community plugins.'),
};

const pluginCheckOutputSchema = {
  pluginId: z.string().describe('Plugin id that was queried.'),
  installed: z.boolean().describe('Whether the plugin is installed in this vault.'),
  enabled: z.boolean().describe('Whether the plugin is enabled (false when not installed).'),
};

const executeCommandOutputSchema = {
  commandId: z.string().describe('Command id that was executed.'),
  executed: z.boolean().describe('Always true on success.'),
};

export function createPluginInteropModule(
  adapter: ObsidianAdapter,
  options: ModuleOptions = {},
): ToolModule {
  const getAllowlist = options.getExecuteCommandAllowlist ?? ((): string[] => []);
  return {
    metadata: { id: 'plugin-interop', name: 'Plugin interop', description: 'List plugins, check status, execute commands, and run Dataview queries' },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'plugin_list',
          title: 'List plugins',
          description: describeTool({
            summary: 'List every installed community plugin with its enabled flag.',
          }),
          schema: noParamsSchema,
          outputSchema: pluginListOutputSchema,
          handler: safeHandler((): CallToolResult => {
            const plugins = adapter.getInstalledPlugins();
            return dataResponse({ plugins });
          }),
          annotations: annotations.read,
        }),
        defineTool({
          name: 'plugin_check',
          title: 'Check plugin enabled',
          description: describeTool({
            summary: 'Check whether a plugin is installed and enabled.',
          }),
          schema: checkSchema,
          outputSchema: pluginCheckOutputSchema,
          handler: safeHandler((params): CallToolResult => {
            const enabled = adapter.isPluginEnabled(params.pluginId);
            const plugins = adapter.getInstalledPlugins();
            const installed = plugins.some((p) => p.id === params.pluginId);
            return dataResponse({ pluginId: params.pluginId, installed, enabled });
          }),
          annotations: annotations.read,
        }),
        defineTool({
          name: 'plugin_dataview_query',
          title: 'Run Dataview query',
          description: describeTool({
            summary: 'Execute a Dataview DQL query and return the rendered markdown. List fields in TABLE cells come back as plain text ("a, b"), not HTML.',
            returns:
              'Too long a result returns its first whole lines, after "lines: N of M" and "truncated: true" header lines; narrow the query with WHERE or LIMIT.',
            errors: [
              '"Plugin not installed or disabled: dataview" if Dataview is missing.',
              '"Plugin API unavailable for dataview" if Dataview is loaded but its API is not yet exposed.',
              '"Dataview query failed: <reason>" if the query parses but does not execute cleanly.',
            ],
          }),
          schema: dataviewSchema,
          handler: safeHandler(async (params): Promise<CallToolResult> => {
            if (!adapter.isPluginEnabled('dataview')) {
              throw new PluginNotInstalledError('dataview');
            }
            const api = adapter.getDataviewApi();
            if (!api) {
              throw new PluginApiUnavailableError(
                'dataview',
                'queryMarkdown is not exposed',
              );
            }
            const result = await api.queryMarkdown(params.query);
            if (!result.successful) {
              return errorResult(`Dataview query failed: ${result.error}`);
            }
            // Over CHARACTER_LIMIT: fewer whole lines (table rows), never a cut
            // line, so the table header and every row shown stay intact (#464).
            const lines = result.value.split('\n');
            return fitItems(lines.length, (n) => {
              const truncated = n < lines.length;
              return documentResponse(
                truncated ? { lines: `${String(n)} of ${String(lines.length)}`, truncated } : {},
                truncated
                  ? `${lines.slice(0, n).join('\n')}\n\n[TRUNCATED: Showing ${String(n)} of ${String(lines.length)} lines. Narrow the query with WHERE or LIMIT.]`
                  : result.value,
              );
            });
          }),
          annotations: annotations.read,
          // Listed only while Dataview is enabled (#469).
          isAvailable: (): boolean => adapter.isPluginEnabled('dataview'),
        }),
        defineTool({
          name: 'plugin_execute_command',
          title: 'Execute command',
          description: describeTool({
            summary:
              'Run an Obsidian command by id. Only ids the user put on the Execute Command Allowlist in the plugin settings run.',
            errors: [
              '"Command "<id>" is not on the executeCommand allowlist" if the id is not listed; ask the user to add it in the plugin settings.',
              '"Command not found" if the id is listed but no such command exists.',
            ],
          }),
          schema: executeCommandSchema,
          outputSchema: executeCommandOutputSchema,
          handler: safeHandler((params): CallToolResult => {
            const allowlist = getAllowlist();
            if (allowlist.length === 0) {
              return errorResult(
                'Command execution disabled — add commands under "Command allowlist" in the Vault MCP Server settings.',
              );
            }
            if (!allowlist.includes(params.commandId)) {
              return errorResult(
                `Command "${params.commandId}" is not on the executeCommand allowlist. Add it under "Command allowlist" in the Vault MCP Server settings if you trust it.`,
              );
            }
            const ok = adapter.executeCommand(params.commandId);
            return ok
              ? dataResponse({
                  commandId: params.commandId,
                  executed: true,
                })
              : errorResult(`Command not found: ${params.commandId}`);
          }),
          annotations: annotations.destructiveExternal,
          // Listed only while the allowlist has an entry (#469).
          isAvailable: (): boolean => getAllowlist().length > 0,
        }),
      ];
    },
  };
}
