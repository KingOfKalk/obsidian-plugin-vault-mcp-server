import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { ModuleRegistry } from '../registry/module-registry';
import { ToolDefinition } from '../registry/types';
import { handleToolError } from '../tools/shared/errors';
import manifest from '../../manifest.json';

/**
 * Tool-use hints injected into Claude's session-long system prompt via the
 * MCP protocol-level `instructions` field. These tokens are paid every turn,
 * so the string is intentionally short and limited to hints that the per-tool
 * descriptions cannot convey on their own. See
 * docs/superpowers/specs/2026-05-03-mcp-server-instructions-field-design.md.
 */
export const SERVER_INSTRUCTIONS = `This server exposes an Obsidian vault as MCP tools.

- Prefer \`search_fulltext\` (or other \`search_*\` tools) before \`vault_read\` when you don't already know the file path.
- \`editor_*\` tools operate on the **active** file only — open one with \`workspace_open_file\` first if needed.
- Paths are vault-relative with forward slashes (e.g. \`notes/foo.md\`); never absolute filesystem paths.
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate \`vault_get_*\` tools — don't parse them out of \`vault_read\` output.`;

export function createMcpServer(
  registry: ModuleRegistry,
  logger: Logger,
): McpServer {
  const server = new McpServer(
    {
      // {service}-mcp-server naming convention for the MCP protocol
      // handshake. This is internal to the protocol and intentionally
      // distinct from the npm package name and Obsidian plugin id.
      name: 'obsidian-mcp-server',
      version: manifest.version,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server, registry, logger);

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
): (params: unknown) => Promise<CallToolResult> {
  const inputSchema = z.object(tool.schema).strict();
  return async (params: unknown): Promise<CallToolResult> => {
    try {
      const parsed = inputSchema.parse(params ?? {});
      return await tool.handler(parsed);
    } catch (error) {
      // ZodError keeps the dispatcher's friendlier path-joined format —
      // richer than handleToolError's ZodError branch, and a `warn` not
      // `error` because invalid input is a client problem, not a server one.
      if (error instanceof z.ZodError) {
        const message = error.issues
          .map((issue) => {
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

function registerTools(
  server: McpServer,
  registry: ModuleRegistry,
  logger: Logger,
): void {
  const tools = registry.getActiveTools();
  for (const tool of tools) {
    logger.debug(`Registering tool: ${tool.name}`);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        outputSchema: tool.outputSchema,
        annotations: tool.title
          ? { ...tool.annotations, title: tool.title }
          : tool.annotations,
      },
      createToolDispatcher(tool, logger),
    );
  }
  logger.info(`Registered ${String(tools.length)} tools from ${String(registry.getModules().filter((m) => m.enabled).length)} modules`);
}
