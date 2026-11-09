import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
} from '../../registry/types';
import { describeTool } from '../shared/describe';
import { makeResponse } from '../shared/response';
import { AGENT_CHANGES, type AgentChangeEntry } from '../../server/agent-changes';

/**
 * Name the server reports to the model in `server_info` and in the first
 * line of the server instructions (#402). Matches the plugin id.
 */
export const SERVER_DISPLAY_NAME = 'vault-mcp-server';

export const SERVER_MODULE_ID = 'server';

export interface ServerModuleOptions {
  /** Plugin version shown in the tool description and result. */
  version: string;
  /** Ids of the modules that currently contribute at least one tool. */
  getEnabledModules: () => string[];
  /** Agent-relevant changes; defaults to {@link AGENT_CHANGES}. */
  changes?: readonly AgentChangeEntry[];
}

const serverInfoOutputSchema = {
  name: z.string().describe('Server name, e.g. "vault-mcp-server".'),
  version: z.string().describe('Plugin version, e.g. "3.2.0".'),
  enabledModules: z
    .array(z.string())
    .describe('Ids of the tool modules that are enabled, e.g. ["vault", "search"].'),
  changes: z
    .array(
      z.object({
        version: z.string().describe('Version that shipped these changes.'),
        notes: z.array(z.string()).describe('One line per agent-relevant change.'),
      }),
    )
    .describe('Agent-relevant changes per version, newest first.'),
};

interface ServerInfo {
  name: string;
  version: string;
  enabledModules: string[];
  changes: AgentChangeEntry[];
}

function renderMarkdown(info: ServerInfo): string {
  const lines = [
    `${info.name} v${info.version}`,
    '',
    `Enabled modules: ${info.enabledModules.length > 0 ? info.enabledModules.join(', ') : '(none)'}`,
  ];
  for (const entry of info.changes) {
    lines.push('', `## ${entry.version}`);
    for (const note of entry.notes) lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

/**
 * The always-on `server` module holding `server_info` (#402). It is not in
 * `MODULE_FACTORIES` and never enters the `ModuleRegistry`, so it has no
 * settings toggle: `createMcpServer` registers its tools on every server.
 */
export function createServerModule(options: ServerModuleOptions): ToolModule {
  const { version, getEnabledModules } = options;
  const changes = options.changes ?? AGENT_CHANGES;
  return {
    metadata: {
      id: SERVER_MODULE_ID,
      name: 'Server',
      description:
        'Server version and agent-relevant changes. Always enabled; cannot be turned off.',
    },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'server_info',
          title: 'Get server info',
          description: describeTool({
            summary: `Get the ${SERVER_DISPLAY_NAME} version (running: v${version}), the enabled tool modules and agent-relevant changes per version (renamed parameters or output fields, new tools).`,
            examples: [
              'Use when: a tool rejects a parameter or returns fields you did not expect, to check what changed.',
            ],
          }),
          schema: {},
          outputSchema: serverInfoOutputSchema,
          handler: (): Promise<CallToolResult> => {
            const info: ServerInfo = {
              name: SERVER_DISPLAY_NAME,
              version,
              enabledModules: getEnabledModules(),
              changes: changes.map((c) => ({ version: c.version, notes: [...c.notes] })),
            };
            return Promise.resolve(makeResponse(info, renderMarkdown));
          },
          annotations: annotations.read,
        }),
      ];
    },
  };
}
