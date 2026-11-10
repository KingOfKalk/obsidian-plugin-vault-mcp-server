/**
 * Command-line MCP client for the eval harness (#483): lets a coding agent
 * (or a person) answer the eval questions with the real tools when no model
 * API key is at hand. Start the harness on a fixed port first:
 *
 *   EVAL_PORT=47811 npx tsx evals/harness.ts
 *
 * then, in another shell:
 *
 *   npx tsx evals/tool-cli.ts instructions
 *   npx tsx evals/tool-cli.ts tools
 *   npx tsx evals/tool-cli.ts schema search_by_frontmatter
 *   npx tsx evals/tool-cli.ts call vault_get_aspect '{"path":"Home.md","aspect":"backlinks"}'
 *
 * The URL defaults to http://127.0.0.1:47811/mcp; EVAL_MCP_URL overrides it.
 * Results print as the eval runner shows them to the model, so an agent sees
 * what Mistral or Claude see in `npm run eval`.
 */
import type { Client, Tool } from '@modelcontextprotocol/client';
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { EVAL_TOKEN } from './harness';
import { toolResultText } from './run';

export const DEFAULT_CLI_PORT = 47811;

const USAGE = `Usage: npx tsx evals/tool-cli.ts <command>

  instructions             the server instructions
  tools                    one line per tool: name and the first sentence of its description
  schema <tool>            the full description and input schema of one tool
  call <tool> [json-args]  call a tool; arguments as a JSON object (default {})

Start the harness first: EVAL_PORT=${String(DEFAULT_CLI_PORT)} npx tsx evals/harness.ts
EVAL_MCP_URL overrides the URL (default http://127.0.0.1:${String(DEFAULT_CLI_PORT)}/mcp).`;

/** First sentence (or first line) of a description, for the compact tool list. */
export function firstSentence(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  const match = /^(.*?[.!?])(\s|$)/.exec(line);
  return (match ? match[1] : line).trim();
}

export function formatToolList(tools: Tool[]): string {
  return tools.map((t) => `${t.name}: ${firstSentence(t.description ?? t.title ?? '')}`).join('\n');
}

export function formatToolSchema(tool: Tool): string {
  return `${tool.name}\n\n${tool.description ?? ''}\n\ninput schema:\n${JSON.stringify(tool.inputSchema, null, 2)}`;
}

/**
 * Run one CLI command against a connected client. Returns the exit code:
 * 0 on success, 1 when the tool returned an error result, 2 on bad usage.
 */
export async function runCli(argv: string[], client: Client, print: (text: string) => void): Promise<number> {
  const [command, name, rawArgs] = argv;
  if (command === 'instructions') {
    print(client.getInstructions() ?? '(the server sent no instructions)');
    return 0;
  }
  if (command === 'tools' || command === 'schema') {
    const { tools } = await client.listTools();
    if (command === 'tools') {
      print(formatToolList(tools));
      return 0;
    }
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      print(`Unknown tool "${name ?? ''}". Run "tools" for the list.`);
      return 2;
    }
    print(formatToolSchema(tool));
    return 0;
  }
  if (command === 'call' && name) {
    let args: Record<string, unknown> = {};
    if (rawArgs !== undefined && rawArgs.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        args = parsed as Record<string, unknown>;
      } catch {
        print(`Arguments must be a JSON object, e.g. '{"path":"Home.md"}'.`);
        return 2;
      }
    }
    const result = await client.callTool({ name, arguments: args });
    const text = toolResultText(result);
    if (result.isError === true) {
      print(`Error: ${text}`);
      return 1;
    }
    print(text);
    return 0;
  }
  print(USAGE);
  return 2;
}

async function main(): Promise<number> {
  const url = process.env.EVAL_MCP_URL ?? `http://127.0.0.1:${String(DEFAULT_CLI_PORT)}/mcp`;
  const client = new McpClient({ name: 'vault-mcp-eval-cli', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${EVAL_TOKEN}` } },
      }),
    );
  } catch (error) {
    process.stderr.write(
      `Cannot reach the eval harness at ${url} (${error instanceof Error ? error.message : String(error)}).\n` +
        `Start it with: EVAL_PORT=${String(DEFAULT_CLI_PORT)} npx tsx evals/harness.ts\n`,
    );
    return 1;
  }
  try {
    return await runCli(process.argv.slice(2), client, (text) => void process.stdout.write(`${text}\n`));
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.endsWith('tool-cli.ts')) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
