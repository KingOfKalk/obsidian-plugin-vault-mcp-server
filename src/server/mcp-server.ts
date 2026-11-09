import {
  McpServer,
  type CallToolResult,
  type RegisteredTool,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { ModuleRegistry } from '../registry/module-registry';
import { ToolDefinition } from '../registry/types';
import { handleToolError } from '../tools/shared/errors';
import { resultTextLength } from '../tools/shared/pagination';
import { truncateText } from '../tools/shared/truncate';
import { CHARACTER_LIMIT } from '../constants';
import { createToolContext, type SdkExtra } from '../registry/tool-context';
import { buildInputSchema } from '../registry/input-schema';
import { withAdvertisedSchema } from '../registry/advertised-schema';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { McpPluginSettings } from '../types';
import manifest from '../../manifest.json';
import { createServerModule, SERVER_DISPLAY_NAME } from '../tools/server';
import { PATH_RULE_HINT } from '../tools/shared/descriptions';

/**
 * Tool-use hints injected into Claude's session-long system prompt via the
 * MCP protocol-level `instructions` field. These tokens are paid every turn,
 * so the string is intentionally short and limited to hints that the per-tool
 * descriptions cannot convey on their own. See
 * docs/superpowers/specs/2026-05-03-mcp-server-instructions-field-design.md.
 *
 * `activeTools` are the names of the tools the session offers; a hint about
 * a tool that is switched off is left out (#447). Omitted, every hint is
 * included. The text is built once per session, at `initialize`.
 */
export function buildServerInstructions(
  version: string,
  activeTools?: readonly string[],
): string {
  const active = activeTools === undefined ? null : new Set(activeTools);
  const has = (name: string): boolean => active === null || active.has(name);
  const hasPrefix = (prefix: string): boolean =>
    active === null || [...active].some((name) => name.startsWith(prefix));

  const hints: string[] = [];
  if (has('search_fulltext')) {
    // search_fulltext searches note text, not file names (#449).
    hints.push(
      '- Find notes by content with `search_fulltext` (note text, not file names)' +
        (has('vault_list_recursive') ? '; by name with `vault_list_recursive`.' : '.'),
    );
  }
  if (hasPrefix('editor_')) {
    hints.push(
      '- `editor_*` tools work on the **active** file only' +
        (has('workspace_open_file') ? ' (open one with `workspace_open_file`)' : '') +
        '; no expectedMtime check; most fail with "No active editor" if no Markdown view is focused.',
    );
  }
  // The full path rule; each path parameter carries only a short form
  // (#457). Always sent, so it is there whenever a path tool is.
  hints.push(PATH_RULE_HINT);
  if (has('vault_replace')) {
    // Which write tool to use (#449); vault_update on one read window
    // truncates a large note.
    hints.push(
      '- To edit a note, prefer `vault_replace`' +
        (has('vault_insert') ? ' or `vault_insert`' : '') +
        (has('vault_update')
          ? '; `vault_update` only to rewrite a whole file read in one window.'
          : '.'),
    );
  }
  if (has('vault_get_aspect')) {
    hints.push(
      "- Frontmatter, headings, links, embeds, backlinks, block refs: use `vault_get_aspect`, don't parse `vault_read` output.",
    );
  }

  return `${SERVER_DISPLAY_NAME} v${version}
Call \`server_info\` for agent-relevant changes (renamed parameters or fields, new tools).

This server exposes an Obsidian vault as MCP tools.

${hints.join('\n')}`;
}

/** Instructions for the running plugin version (from manifest.json). */
export const SERVER_INSTRUCTIONS = buildServerInstructions(manifest.version);

export interface CreateMcpServerOptions {
  /**
   * Version reported in the handshake, the instructions and `server_info`.
   * Defaults to manifest.json's version; the docs generator passes a fixed
   * placeholder so release PRs (which only bump the version) keep the
   * generated docs unchanged (#402).
   */
  version?: string;
}

export function createMcpServer(
  registry: ModuleRegistry,
  adapter: ObsidianAdapter,
  settings: McpPluginSettings,
  logger: Logger,
  options: CreateMcpServerOptions = {},
): McpServer {
  const version = options.version ?? manifest.version;
  const capabilities: {
    tools: Record<string, never>;
    logging: Record<string, never>;
    resources?: Record<string, never>;
    prompts?: Record<string, never>;
  } = {
    tools: {},
    logging: {},
  };
  if (settings.resourcesEnabled) {
    capabilities.resources = {};
  }
  if (settings.promptsEnabled) {
    capabilities.prompts = {};
  }

  const server = new McpServer(
    {
      // Same name as the instructions' first line and `server_info`
      // (#431). Clients show it as the server's display name.
      name: SERVER_DISPLAY_NAME,
      version,
    },
    {
      capabilities,
      // Built from the tools active at `initialize` (#447) and fixed for
      // the session: sent once, so it reflects the state at connect time
      // (#448).
      instructions: buildServerInstructions(
        version,
        registry.getActiveTools().map((tool) => tool.name),
      ),
      // Toggling a module flips several tools in one synchronous burst; the
      // SDK coalesces their list_changed notifications into one (#448).
      debouncedNotificationMethods: ['notifications/tools/list_changed'],
    },
  );

  registerTools(server, registry, logger, version);
  if (settings.resourcesEnabled) {
    registerResources(server, adapter, logger);
  }
  if (settings.promptsEnabled) {
    registerPrompts(server, adapter, logger);
  }

  return server;
}

/**
 * Build the dispatch closure for a single tool. Exposed for direct unit
 * testing — the SDK's internal registration path is hard to drive from
 * tests, but the validate-then-handle logic is the important part.
 */
/**
 * Safety net (#464): tools return fewer items to stay under CHARACTER_LIMIT,
 * so a text over it is a bug in a tool. Cut it with a footer and log a
 * warning instead of flooding the agent's context. `structuredContent` is
 * left as it is.
 */
export function capResponse(
  result: CallToolResult,
  toolName: string,
  logger: Logger,
): CallToolResult {
  const size = resultTextLength(result);
  if (size <= CHARACTER_LIMIT) return result;
  logger.warn(
    `Tool "${toolName}" returned ${String(size)} characters of text, over CHARACTER_LIMIT (${String(CHARACTER_LIMIT)}); cutting it`,
  );
  const text = result.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
  const capped = truncateText(text, {
    hint: 'Narrow the request (paging, offset/length or a smaller query).',
  });
  return {
    ...result,
    content: [
      { type: 'text' as const, text: capped.text },
      ...result.content.filter((block) => block.type !== 'text'),
    ],
  };
}

export function createToolDispatcher(
  tool: ToolDefinition,
  logger: Logger,
): (params: unknown, extra: SdkExtra) => Promise<CallToolResult> {
  const inputSchema = buildInputSchema(tool.schema);
  return async (params: unknown, extra: SdkExtra): Promise<CallToolResult> => {
    try {
      const parsed = inputSchema.parse(params ?? {});
      const ctx = createToolContext(extra, tool.name, logger);
      const result = await tool.handler(parsed, ctx);
      return tool.uncapped === true ? result : capResponse(result, tool.name, logger);
    } catch (error) {
      // ZodError keeps the dispatcher's friendlier path-joined format —
      // richer than handleToolError's ZodError branch, and a `warn` not
      // `error` because invalid input is a client problem, not a server one.
      if (error instanceof z.ZodError) {
        const message = error.issues
          .map((issue) => {
            // Unknown-key issues sit at the root and already carry a
            // self-contained message naming the keys (see input-schema.ts).
            if (issue.path.length === 0 && issue.code === 'unrecognized_keys') {
              return issue.message;
            }
            const path =
              issue.path.length > 0 ? issue.path.join('.') : '<root>';
            return `${path}: ${issue.message}`;
          })
          .join('; ');
        logger.warn(`Tool "${tool.name}" rejected invalid input: ${message}`);
        return {
          content: [
            { type: 'text' as const, text: `Invalid arguments: ${message}` },
          ],
          isError: true,
        };
      }
      // Anything else — non-Zod parse-time crash (e.g. a custom .refine()
      // throwing) OR handler-time throw — gets routed through the shared
      // handleToolError so typed errors (NotFoundError, PermissionError, …)
      // produce consistent envelopes. Pass the raw Error as structured
      // log data so the stack is captured server-side; the response itself
      // never includes the stack (handleToolError uses error.message only).
      logger.error(`Tool "${tool.name}" error`, error);
      return handleToolError(error);
    }
  };
}

/**
 * Normalise a tool's `outputSchema` for `McpServer.registerTool`: raw shapes
 * are wrapped in `z.object` (as SDK v1 did implicitly), full Zod schemas pass
 * through unchanged.
 */
export function toOutputSchema(
  schema: ToolDefinition['outputSchema'],
): z.ZodType | undefined {
  if (schema === undefined) return undefined;
  if (schema instanceof z.ZodType) return schema;
  return z.object(schema);
}

/** {@link toOutputSchema}, with the trimmed JSON advertised in tools/list (#451). */
function advertisedOutputSchema(
  schema: ToolDefinition['outputSchema'],
): StandardSchemaWithJSON | undefined {
  const output = toOutputSchema(schema);
  return output === undefined ? undefined : withAdvertisedSchema(output, 'output');
}

/**
 * Register the tools and keep them in step with the registry for the
 * lifetime of this server (one MCP session, #448).
 *
 * Module and tool switches reach an open session: a tool switched off is
 * disabled (the SDK drops it from `tools/list` and rejects `tools/call` with
 * "Tool … disabled"), a tool switched on is enabled or registered, and the
 * SDK sends `notifications/tools/list_changed`. The registry subscription
 * ends when the session's transport closes.
 */
function registerTools(
  server: McpServer,
  registry: ModuleRegistry,
  logger: Logger,
  version: string,
): void {
  // The `server` module (server_info) is always on: it never enters the
  // registry, so no module toggle can switch it off (#402).
  const serverModule = createServerModule({
    version,
    getEnabledModules: () => registry.getEnabledModuleIds(),
  });
  const serverTools = serverModule.tools();
  for (const tool of serverTools) {
    registerTool(server, tool, logger);
  }

  // Handles of the registry's tools, enabled or not.
  const handles = new Map<string, RegisteredTool>();
  const sync = (): void => {
    const active = registry.getActiveTools();
    const activeNames = new Set(active.map((t) => t.name));
    for (const tool of active) {
      const handle = handles.get(tool.name);
      if (handle === undefined) {
        handles.set(tool.name, registerTool(server, tool, logger));
      } else if (!handle.enabled) {
        logger.debug(`Enabling tool: ${tool.name}`);
        handle.enable();
      }
    }
    for (const [name, handle] of handles) {
      if (handle.enabled && !activeNames.has(name)) {
        logger.debug(`Disabling tool: ${name}`);
        handle.disable();
      }
    }
  };

  sync();
  logger.info(`Registered ${String(serverTools.length + handles.size)} tools from ${String(registry.getModules().filter((m) => m.enabled).length)} modules`);

  const unsubscribe = registry.onChange(sync);
  // Protocol.onclose runs when the transport closes (session DELETE, idle
  // sweep, server stop). Chain any handler that is already set.
  const previousOnClose = server.server.onclose;
  server.server.onclose = (): void => {
    unsubscribe();
    previousOnClose?.();
  };
}

function registerTool(
  server: McpServer,
  tool: ToolDefinition,
  logger: Logger,
): RegisteredTool {
  logger.debug(`Registering tool: ${tool.name}`);
  return server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      // Strict object (not the raw shape): the SDK validates before our
      // dispatcher runs, and a raw shape would make it strip unknown keys.
      // Both schemas validate with Zod as before; only the JSON Schema
      // advertised in tools/list is trimmed (#451).
      inputSchema: withAdvertisedSchema(buildInputSchema(tool.schema), 'input'),
      outputSchema: advertisedOutputSchema(tool.outputSchema),
      // No annotations.title: the top-level `title` carries it (#451).
      annotations: tool.annotations,
    },
    createToolDispatcher(tool, logger),
  );
}
