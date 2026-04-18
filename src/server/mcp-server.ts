import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Logger } from '../utils/logger';
import { ModuleRegistry } from '../registry/module-registry';

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
      async (params) => {
        try {
          return await tool.handler(params as Record<string, unknown>);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Tool "${tool.name}" error: ${message}`);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
  logger.info(`Registered ${String(tools.length)} tools from ${String(registry.getModules().filter(m => m.enabled).length)} modules`);
}
