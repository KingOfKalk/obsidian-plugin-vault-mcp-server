import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { ModuleRegistry } from '../registry/module-registry';
import { ToolDefinition } from '../registry/types';

export function createMcpServer(
  registry: ModuleRegistry,
  logger: Logger,
): McpServer {
  const server = new McpServer(
    {
      name: 'obsidian-mcp',
      version: '0.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
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
    let parsed: Record<string, unknown>;
    try {
      parsed = inputSchema.parse(params ?? {});
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.issues
          .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
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
      throw error;
    }
    try {
      return await tool.handler(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Tool "${tool.name}" error: ${message}`);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
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
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
      },
      createToolDispatcher(tool, logger),
    );
  }
  logger.info(`Registered ${String(tools.length)} tools from ${String(registry.getModules().filter((m) => m.enabled).length)} modules`);
}
