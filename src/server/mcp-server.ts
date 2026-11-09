import { McpServer, CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { ModuleRegistry } from '../registry/module-registry';
import { ToolDefinition } from '../registry/types';
import { handleToolError } from '../tools/shared/errors';
import { createToolContext, type SdkExtra } from '../registry/tool-context';
import { buildInputSchema } from '../registry/input-schema';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { McpPluginSettings } from '../types';
import manifest from '../../manifest.json';
import { createServerModule, SERVER_DISPLAY_NAME } from '../tools/server';

/**
 * Tool-use hints injected into Claude's session-long system prompt via the
 * MCP protocol-level `instructions` field. These tokens are paid every turn,
 * so the string is intentionally short and limited to hints that the per-tool
 * descriptions cannot convey on their own. See
 * docs/superpowers/specs/2026-05-03-mcp-server-instructions-field-design.md.
 */
export function buildServerInstructions(version: string): string {
  return `${SERVER_DISPLAY_NAME} v${version}
Call \`server_info\` for agent-relevant changes (renamed parameters or fields, new tools).

This server exposes an Obsidian vault as MCP tools.

- Prefer \`search_fulltext\` (or other \`search_*\` tools) before \`vault_read\` when you don't already know the file path.
- \`editor_*\` tools operate on the **active** file only — open one with \`workspace_open_file\` first if needed.
- Paths are vault-relative with forward slashes (e.g. \`notes/foo.md\`); never absolute filesystem paths.
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed via the \`vault_get_aspect\` tool (call it with the matching \`aspect\` enum value) — don't parse them out of \`vault_read\` output.`;
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
      instructions: buildServerInstructions(version),
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
export function createToolDispatcher(
  tool: ToolDefinition,
  logger: Logger,
): (params: unknown, extra: SdkExtra) => Promise<CallToolResult> {
  const inputSchema = buildInputSchema(tool.schema);
  return async (params: unknown, extra: SdkExtra): Promise<CallToolResult> => {
    try {
      const parsed = inputSchema.parse(params ?? {});
      const ctx = createToolContext(extra, tool.name, logger);
      return await tool.handler(parsed, ctx);
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
  const tools = [...serverModule.tools(), ...registry.getActiveTools()];
  for (const tool of tools) {
    logger.debug(`Registering tool: ${tool.name}`);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // Strict object (not the raw shape): the SDK validates before our
        // dispatcher runs, and a raw shape would make it strip unknown keys.
        inputSchema: buildInputSchema(tool.schema),
        outputSchema: toOutputSchema(tool.outputSchema),
        annotations: tool.title
          ? { ...tool.annotations, title: tool.title }
          : tool.annotations,
      },
      createToolDispatcher(tool, logger),
    );
  }
  logger.info(`Registered ${String(tools.length)} tools from ${String(registry.getModules().filter((m) => m.enabled).length)} modules`);
}
