/**
 * LLM evaluation runner for the vault MCP tools (#393).
 *
 * For every qa_pair in the evaluation file it starts a fresh headless server
 * on the fixture vault, connects an MCP client over Streamable HTTP, offers
 * the server's tools to Claude, runs a tool-use loop until Claude gives a
 * final answer, and compares that answer with the expected one.
 *
 *   npm run eval                       # all questions
 *   npm run eval -- --only 3,7         # a subset (1-based)
 *   npm run eval -- --dry-run          # everything except the model calls
 *   npm run eval -- --report out.json  # also write a JSON report
 *
 * Needs ANTHROPIC_API_KEY (except with --dry-run). See evals/README.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { connectClient, startHarness } from './harness';
import { answersMatch, extractTagged, parseEvaluationXml, type QaPair } from './lib';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_EFFORT: Effort = 'high';
export const DEFAULT_MAX_TURNS = 30;
const MAX_TOKENS = 16000;

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Models that accept the server-side refusal fallback in its "default" form. */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

export const SYSTEM_PROMPT = `You are an AI assistant connected to an Obsidian vault through MCP tools.

Answer the user's question using only what the tools return. Use as many tool calls as you need; do not guess.

When you are done, reply with:
1. A short <summary> of the steps and tools you used.
2. <feedback> on the tools: unclear names, descriptions or parameters, unhelpful errors, or results that were too large or too small. Be specific.
3. Your final answer in <response> tags, last. Give only the value asked for: a number as just the number, a name or title as its exact text. If you cannot find the answer, reply <response>NOT_FOUND</response>.`;

export interface RunConfig {
  apiKey: string | null;
  model: string;
  effort: Effort;
  maxTurns: number;
}

/** Read the runner settings from the environment, validating each one. */
export function readConfig(env: NodeJS.ProcessEnv): RunConfig {
  const effort = (env.EVAL_EFFORT ?? DEFAULT_EFFORT) as Effort;
  if (!EFFORTS.includes(effort)) {
    throw new Error(`EVAL_EFFORT must be one of ${EFFORTS.join(', ')} (got "${effort}").`);
  }
  const maxTurns = Number(env.EVAL_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error(`EVAL_MAX_TURNS must be a positive integer (got "${String(env.EVAL_MAX_TURNS)}").`);
  }
  const key = env.ANTHROPIC_API_KEY?.trim();
  return {
    apiKey: key ? key : null,
    model: env.EVAL_MODEL?.trim() || DEFAULT_MODEL,
    effort,
    maxTurns,
  };
}

export const MISSING_KEY_MESSAGE =
  'ANTHROPIC_API_KEY is not set. The eval calls the Claude API and needs a key:\n' +
  '  ANTHROPIC_API_KEY=sk-ant-... npm run eval\n' +
  'Use `npm run eval -- --dry-run` to check the harness and questions without a key.';

export interface CliArgs {
  file: string;
  only: number[] | null;
  dryRun: boolean;
  report: string | null;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    file: resolve(process.cwd(), 'evals', 'vault.xml'),
    only: null,
    dryRun: false,
    report: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value.`);
      return v;
    };
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--file') args.file = resolve(next());
    else if (arg === '--report') args.report = resolve(next());
    else if (arg === '--only') {
      args.only = next()
        .split(',')
        .map((s) => Number(s.trim()));
      if (args.only.some((n) => !Number.isInteger(n) || n < 1)) {
        throw new Error('--only takes 1-based question numbers, e.g. --only 1,4');
      }
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/** MCP tool definition -> Claude tool definition. */
export function toClaudeTool(tool: Tool): Anthropic.Beta.BetaTool {
  return {
    name: tool.name,
    description: tool.description ?? tool.title ?? tool.name,
    input_schema: tool.inputSchema,
  };
}

/** The text a client shows the model for a tool result. */
export function toolResultText(result: CallToolResult): string {
  const parts = result.content.map((block) =>
    block.type === 'text' ? block.text : `[${block.type} content omitted]`,
  );
  if (parts.length === 0 && result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  return parts.join('\n');
}

export function buildSystemPrompt(instructions: string | undefined): string {
  return instructions
    ? `${SYSTEM_PROMPT}\n\nInstructions from the MCP server:\n\n${instructions}`
    : SYSTEM_PROMPT;
}

export interface QuestionResult {
  index: number;
  question: string;
  expected: string;
  actual: string | null;
  passed: boolean;
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  turns: number;
  stopReason: string;
  durationMs: number;
  summary: string | null;
  feedback: string | null;
  error?: string;
}

/** One Messages API call; injectable so tests can script the model's turns. */
export type CreateMessage = (
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Beta.BetaMessage>;

/** Run one question on a fresh harness and grade the answer. */
export async function runQuestion(
  createMessage: CreateMessage,
  config: RunConfig,
  qa: QaPair,
  index: number,
): Promise<QuestionResult> {
  const started = Date.now();
  const toolCalls: Record<string, number> = {};
  const harness = await startHarness();
  const mcp = await connectClient(harness);
  const base: Omit<QuestionResult, 'actual' | 'passed' | 'turns' | 'stopReason' | 'summary' | 'feedback'> = {
    index,
    question: qa.question,
    expected: qa.answer,
    toolCalls,
    totalToolCalls: 0,
    durationMs: 0,
  };
  try {
    const tools = (await mcp.listTools()).tools.map(toClaudeTool);
    const system = buildSystemPrompt(mcp.getInstructions());
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: qa.question }];
    const fallback = FALLBACK_MODELS.has(config.model)
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {};
    let finalText = '';
    let stopReason = 'max_turns';
    let turns = 0;
    while (turns < config.maxTurns) {
      turns++;
      const response = await createMessage({
        model: config.model,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: config.effort },
        ...fallback,
      });
      messages.push({ role: 'assistant', content: response.content });
      if (response.stop_reason === 'pause_turn') continue;
      const uses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        stopReason = response.stop_reason ?? 'unknown';
        finalText = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        break;
      }
      // Run every tool call of this turn and send all results back together.
      const results = await Promise.all(
        uses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          toolCalls[use.name] = (toolCalls[use.name] ?? 0) + 1;
          try {
            const result = await mcp.callTool({
              name: use.name,
              arguments: use.input as Record<string, unknown>,
            });
            return {
              type: 'tool_result',
              tool_use_id: use.id,
              content: toolResultText(result),
              ...(result.isError === true ? { is_error: true } : {}),
            };
          } catch (error) {
            return {
              type: 'tool_result',
              tool_use_id: use.id,
              content: `Tool call failed: ${error instanceof Error ? error.message : String(error)}`,
              is_error: true,
            };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
    }
    const actual = extractTagged(finalText, 'response');
    return {
      ...base,
      actual,
      passed: answersMatch(actual, qa.answer),
      totalToolCalls: Object.values(toolCalls).reduce((a, b) => a + b, 0),
      turns,
      stopReason,
      durationMs: Date.now() - started,
      summary: extractTagged(finalText, 'summary'),
      feedback: extractTagged(finalText, 'feedback'),
    };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw error;
    return {
      ...base,
      actual: null,
      passed: false,
      totalToolCalls: Object.values(toolCalls).reduce((a, b) => a + b, 0),
      turns: 0,
      stopReason: 'error',
      durationMs: Date.now() - started,
      summary: null,
      feedback: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await mcp.close();
    await harness.close();
  }
}

function formatToolCalls(calls: Record<string, number>): string {
  const entries = Object.entries(calls).sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? 'none' : entries.map(([n, c]) => `${n}×${String(c)}`).join(', ');
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function dryRun(pairs: Array<{ qa: QaPair; index: number }>): Promise<void> {
  const harness = await startHarness();
  const mcp = await connectClient(harness);
  try {
    const tools = (await mcp.listTools()).tools.map(toClaudeTool);
    print(`Dry run: harness at ${harness.url}, ${String(tools.length)} tools converted for Claude.`);
    print(`Server instructions: ${String(mcp.getInstructions()?.length ?? 0)} characters.`);
    for (const { qa, index } of pairs) {
      print(`  Q${String(index)}: ${qa.question}\n       expected: ${qa.answer}`);
    }
    print('No model calls were made.');
  } finally {
    await mcp.close();
    await harness.close();
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseArgs(argv);
  const config = readConfig(env);
  const all = parseEvaluationXml(readFileSync(args.file, 'utf8'));
  const selected = all
    .map((qa, i) => ({ qa, index: i + 1 }))
    .filter(({ index }) => args.only === null || args.only.includes(index));
  if (selected.length === 0) throw new Error('No questions selected.');

  if (args.dryRun) {
    await dryRun(selected);
    return 0;
  }
  if (config.apiKey === null) {
    process.stderr.write(`${MISSING_KEY_MESSAGE}\n`);
    return 2;
  }

  const anthropic = new Anthropic({ apiKey: config.apiKey });
  const createMessage: CreateMessage = (params) => anthropic.beta.messages.create(params);
  print(
    `Running ${String(selected.length)} question(s) with ${config.model} ` +
      `(effort ${config.effort}, max ${String(config.maxTurns)} turns)\n`,
  );
  const results: QuestionResult[] = [];
  for (const { qa, index } of selected) {
    const r = await runQuestion(createMessage, config, qa, index);
    results.push(r);
    print(
      `${r.passed ? 'PASS' : 'FAIL'}  Q${String(index)}  ` +
        `${String(r.totalToolCalls)} tool calls (${formatToolCalls(r.toolCalls)}), ` +
        `${String(r.turns)} turns, ${(r.durationMs / 1000).toFixed(1)}s`,
    );
    if (!r.passed) {
      print(`      expected: ${r.expected}`);
      print(`      got:      ${r.actual ?? '(no <response> tag)'}  [stop: ${r.stopReason}]`);
      if (r.error) print(`      error:    ${r.error}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const totalCalls = results.reduce((a, r) => a + r.totalToolCalls, 0);
  print('');
  print(`Accuracy: ${String(passed)}/${String(results.length)} (${((passed / results.length) * 100).toFixed(1)}%)`);
  print(`Tool calls: ${String(totalCalls)} total, ${(totalCalls / results.length).toFixed(1)} per question`);

  if (args.report) {
    writeFileSync(
      args.report,
      JSON.stringify({ model: config.model, effort: config.effort, passed, total: results.length, results }, null, 2),
    );
    print(`Report written to ${args.report}`);
  }
  return results.some((r) => r.error !== undefined) ? 1 : 0;
}

if (process.argv[1]?.endsWith('run.ts')) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
