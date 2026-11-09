import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
  type InferredParams,
} from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import {
  PluginApiUnavailableError,
  PluginNotInstalledError,
  handleToolError,
} from '../shared/errors';
import { describeTool } from '../shared/describe';
import {
  confirmWithStructured,
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';
import { fitItems } from '../shared/pagination';
import type { ModuleOptions } from '../index';

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
    .describe('Dataview DQL query text. JavaScript queries are not executed by this tool — see plugin_dataview_describe_js_query.'),
  ...responseFormatField,
};

const dataviewJsSchema = {
  query: z
    .string()
    .min(1)
    .max(10_000)
    .describe('Dataview-JS source; returned unchanged, never executed.'),
  ...responseFormatField,
};

const templaterSchema = {
  templatePath: z
    .string()
    .min(1)
    .max(4096)
    .describe('Template path; returned unchanged, not checked or read.'),
  ...responseFormatField,
};

const executeCommandSchema = {
  commandId: z
    .string()
    .min(1)
    .max(200)
    .describe('Obsidian command id (e.g. "editor:save-file"); must be on the user\'s allowlist.'),
};

/**
 * Output schemas for the plugin-interop read tools that emit
 * `structuredContent` (Batch D of #248). Each shape mirrors what the
 * corresponding handler in this file puts on `result.structuredContent`.
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

const pluginDataviewQueryOutputSchema = {
  query: z.string().describe('Dataview DQL query that was executed.'),
  markdown: z.string().describe('Markdown rendering produced by Dataview, without HTML: list and object values in TABLE cells are plain text (e.g. "a, b").'),
  truncated: z
    .boolean()
    .optional()
    .describe('True when only the first lines fit in the response; narrow the query with WHERE or LIMIT.'),
};

const pluginDescribeOutputSchema = {
  query: z.string().describe('Dataview-JS source that was passed in.'),
  note: z.string().describe('Note explaining that this server does not execute the source.'),
};

const pluginTemplaterDescribeOutputSchema = {
  templatePath: z.string().describe('Vault-relative Templater template path that was queried.'),
  note: z.string().describe('Note explaining that this server does not execute the template.'),
};

const executeCommandOutputSchema = {
  commandId: z.string().describe('Command id that was executed.'),
  executed: z.boolean().describe('Always true on success.'),
};

interface PluginInteropHandlers {
  listPlugins: (params: InferredParams<typeof listSchema>) => Promise<CallToolResult>;
  checkPlugin: (params: InferredParams<typeof checkSchema>) => Promise<CallToolResult>;
  dataviewQuery: (params: InferredParams<typeof dataviewSchema>) => Promise<CallToolResult>;
  dataviewDescribeJsQuery: (
    params: InferredParams<typeof dataviewJsSchema>,
  ) => Promise<CallToolResult>;
  templaterDescribeTemplate: (
    params: InferredParams<typeof templaterSchema>,
  ) => Promise<CallToolResult>;
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
    dataviewQuery: async (params): Promise<CallToolResult> => {
      try {
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
          return err(`Dataview query failed: ${result.error}`);
        }
        // Over CHARACTER_LIMIT: fewer whole lines (table rows), never a cut
        // line, so the table header and every row shown stay intact (#464).
        const lines = result.value.split('\n');
        const format = readResponseFormat(params);
        return fitItems(lines.length, (n) => {
          const truncated = n < lines.length;
          return makeResponse(
            {
              query: params.query,
              markdown: truncated ? lines.slice(0, n).join('\n') : result.value,
              ...(truncated ? { truncated } : {}),
            },
            (v) =>
              truncated
                ? `${v.markdown}\n\n[TRUNCATED: Showing ${String(n)} of ${String(lines.length)} lines. Narrow the query with WHERE or LIMIT.]`
                : v.markdown,
            format,
          );
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
    dataviewDescribeJsQuery: (params): Promise<CallToolResult> => {
      // Stub-only: return the JS source verbatim plus a note. We do NOT
      // evaluate Dataview-JS — that would arbitrary-eval user input
      // against the Obsidian app handle.
      const payload = {
        query: params.query,
        note: 'Dataview JS execution is intentionally not performed by this server. Run the source against the Dataview API on the host that owns the vault.',
      };
      return Promise.resolve(
        makeResponse(
          payload,
          (v) => `_${v.note}_\n\n\`\`\`dataviewjs\n${v.query}\n\`\`\``,
          readResponseFormat(params),
        ),
      );
    },
    templaterDescribeTemplate: (params): Promise<CallToolResult> => {
      // Stub-only: echo the template path. We do NOT call Templater's
      // execution surface — Templater can run arbitrary user JS, so
      // execution must stay client-side.
      const payload = {
        templatePath: params.templatePath,
        note: 'Templater execution is intentionally not performed by this server. The host client must run the template via the Templater API.',
      };
      return Promise.resolve(
        makeResponse(
          payload,
          (v) => `_${v.note}_\n\nTemplate path: \`${v.templatePath}\``,
          readResponseFormat(params),
        ),
      );
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
          ? confirmWithStructured(`Executed command: ${params.commandId}`, {
              commandId: params.commandId,
              executed: true,
            })
          : err(`Command not found: ${params.commandId}`),
      );
    },
  };
}

export function createPluginInteropModule(
  adapter: ObsidianAdapter,
  options: ModuleOptions = {},
): ToolModule {
  const getAllowlist = options.getExecuteCommandAllowlist ?? ((): string[] => []);
  const h = createHandlers(adapter, getAllowlist);
  return {
    metadata: { id: 'plugin-interop', name: 'Plugin Interop', description: 'List plugins, check status, execute commands, and integrate with Dataview/Templater' },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'plugin_list',
          title: 'List plugins',
          description: describeTool({
            summary: 'List every installed community plugin with its enabled flag.',
          }),
          schema: listSchema,
          outputSchema: pluginListOutputSchema,
          handler: h.listPlugins,
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
          handler: h.checkPlugin,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'plugin_dataview_query',
          title: 'Run Dataview query',
          description: describeTool({
            summary: 'Execute a Dataview DQL query and return the rendered markdown. List fields in TABLE cells come back as plain text ("a, b"), not HTML.',
            errors: [
              '"Plugin not installed or disabled: dataview" if Dataview is missing.',
              '"Plugin API unavailable for dataview" if Dataview is loaded but its API is not yet exposed.',
              '"Dataview query failed: <reason>" if the query parses but does not execute cleanly.',
            ],
          }),
          schema: dataviewSchema,
          outputSchema: pluginDataviewQueryOutputSchema,
          handler: h.dataviewQuery,
          annotations: annotations.read,
          // Listed only while Dataview is enabled (#469).
          isAvailable: (): boolean => adapter.isPluginEnabled('dataview'),
        }),
        defineTool({
          name: 'plugin_dataview_describe_js_query',
          title: 'Describe Dataview JS query',
          description: describeTool({
            summary:
              'Does not run anything: returns the given Dataview-JS source unchanged with a note that this server never executes Dataview-JS.',
            seeAlso: ['plugin_dataview_query — to run a Dataview DQL query.'],
          }),
          schema: dataviewJsSchema,
          outputSchema: pluginDescribeOutputSchema,
          handler: h.dataviewDescribeJsQuery,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'plugin_templater_describe_template',
          title: 'Describe Templater template',
          description: describeTool({
            summary:
              'Does not run anything: returns the given template path unchanged with a note that this server never executes Templater. ' +
              'To read the template text, use vault_read.',
          }),
          schema: templaterSchema,
          outputSchema: pluginTemplaterDescribeOutputSchema,
          handler: h.templaterDescribeTemplate,
          annotations: annotations.read,
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
          handler: h.executeCommand,
          annotations: annotations.destructiveExternal,
          // Listed only while the allowlist has an entry (#469).
          isAvailable: (): boolean => getAllowlist().length > 0,
        }),
      ];
    },
  };
}
