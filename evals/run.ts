/**
 * LLM evaluation runner for the vault MCP tools (#393).
 *
 * For every qa_pair in the evaluation file it starts a fresh headless server
 * on the fixture vault, connects an MCP client over Streamable HTTP, offers
 * the server's tools to the model, runs a tool-use loop until the model
 * gives a final answer, and compares that answer with the expected one.
 *
 * Two providers (#483): `anthropic` (Claude Messages API) and `openai` (any
 * OpenAI-compatible Chat Completions API: Mistral, OpenAI, OpenRouter,
 * Ollama, ...). Settings come from flags, the environment and `.env`.
 *
 *   npm run eval                       # all questions
 *   npm run eval -- --only 3,7         # a subset (1-based)
 *   npm run eval -- --dry-run          # everything except the model calls
 *   npm run eval -- --report out.json  # also write a JSON report
 *
 * See evals/README.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { CallToolResult, Client, Tool } from '@modelcontextprotocol/client';
import { BULK_SEED } from './fixture-generator';
import { connectClient, startHarness } from './harness';
import {
  answersMatch,
  extractTagged,
  createPacer,
  loadDotEnv,
  parseEvaluationXml,
  type ChatSession,
  type Provider,
  type ProviderName,
  type QaPair,
  type ToolCall,
  type ToolOutcome,
  type TurnResult,
} from './lib';
import { ProviderAuthError, openAIProvider, toOpenAITool } from './openai';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_EFFORT: Effort = 'high';
export const DEFAULT_MAX_TURNS = 30;
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_KEY_ENV = 'ANTHROPIC_API_KEY';
export const OPENAI_DEFAULT_KEY_ENV = 'EVAL_API_KEY';
const PROVIDERS: readonly ProviderName[] = ['anthropic', 'openai'];
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
  provider: ProviderName;
  /** Anthropic: ANTHROPIC_BASE_URL or the API default; openai: required. */
  baseUrl: string;
  /** Name of the env variable the key is read from. */
  apiKeyEnv: string;
  apiKey: string | null;
  model: string;
  /** Anthropic only; the openai provider sends no effort. */
  effort: Effort;
  maxTurns: number;
  /** Extra JSON Schema keywords dropped from openai tool parameters (EVAL_SCHEMA_DROP). */
  schemaDrop: string[];
  /** Minimum gap between two model API requests in ms (EVAL_MIN_INTERVAL_MS); 0 = none. */
  minIntervalMs: number;
}

/** Provider settings given as CLI flags; each wins over its env variable. */
export interface ProviderFlags {
  provider?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  model?: string;
  minIntervalMs?: string;
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/**
 * `--provider` or EVAL_PROVIDER; otherwise `openai` when a base URL is
 * given (`--base-url` or EVAL_BASE_URL), else `anthropic`.
 */
export function selectProvider(env: NodeJS.ProcessEnv, flags: ProviderFlags = {}): ProviderName {
  const explicit = trimmed(flags.provider) ?? trimmed(env.EVAL_PROVIDER);
  if (explicit !== undefined) {
    if ((PROVIDERS as readonly string[]).includes(explicit)) return explicit as ProviderName;
    throw new Error(`Provider must be one of ${PROVIDERS.join(', ')} (got "${explicit}").`);
  }
  return trimmed(flags.baseUrl) ?? trimmed(env.EVAL_BASE_URL) ? 'openai' : 'anthropic';
}

export const MISSING_BASE_URL_MESSAGE =
  'The openai provider needs a base URL: set EVAL_BASE_URL (in .env or the environment) or pass --base-url, ' +
  'e.g. EVAL_BASE_URL=https://api.mistral.ai/v1';

export const MISSING_MODEL_MESSAGE =
  'The openai provider needs a model: set EVAL_MODEL (in .env or the environment) or pass --model, ' +
  'e.g. EVAL_MODEL=mistral-large-latest';

function validBaseUrl(url: string, source: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${source} is not a valid URL (got "${url}").`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${source} must be an http or https URL (got "${url}").`);
  }
  return url.replace(/\/+$/, '');
}

/** Read the runner settings from the environment and flags, validating each one. */
export function readConfig(env: NodeJS.ProcessEnv, flags: ProviderFlags = {}): RunConfig {
  const effort = (env.EVAL_EFFORT ?? DEFAULT_EFFORT) as Effort;
  if (!EFFORTS.includes(effort)) {
    throw new Error(`EVAL_EFFORT must be one of ${EFFORTS.join(', ')} (got "${effort}").`);
  }
  const maxTurns = Number(env.EVAL_MAX_TURNS ?? DEFAULT_MAX_TURNS);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error(`EVAL_MAX_TURNS must be a positive integer (got "${String(env.EVAL_MAX_TURNS)}").`);
  }
  const intervalRaw = trimmed(flags.minIntervalMs) ?? trimmed(env.EVAL_MIN_INTERVAL_MS) ?? '0';
  const minIntervalMs = Number(intervalRaw);
  if (!Number.isInteger(minIntervalMs) || minIntervalMs < 0) {
    throw new Error(`EVAL_MIN_INTERVAL_MS / --min-interval-ms must be a whole number of ms >= 0 (got "${intervalRaw}").`);
  }
  const provider = selectProvider(env, flags);
  const apiKeyEnv =
    trimmed(flags.apiKeyEnv) ?? (provider === 'anthropic' ? ANTHROPIC_KEY_ENV : OPENAI_DEFAULT_KEY_ENV);
  const model = trimmed(flags.model) ?? trimmed(env.EVAL_MODEL);
  const schemaDrop = (env.EVAL_SCHEMA_DROP ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k !== '');
  let baseUrl: string;
  if (provider === 'anthropic') {
    const flagUrl = trimmed(flags.baseUrl);
    baseUrl = flagUrl
      ? validBaseUrl(flagUrl, '--base-url')
      : (trimmed(env.ANTHROPIC_BASE_URL) ?? ANTHROPIC_DEFAULT_BASE_URL);
  } else {
    const flagUrl = trimmed(flags.baseUrl);
    const envUrl = trimmed(env.EVAL_BASE_URL);
    if (flagUrl === undefined && envUrl === undefined) throw new Error(MISSING_BASE_URL_MESSAGE);
    baseUrl = flagUrl ? validBaseUrl(flagUrl, '--base-url') : validBaseUrl(envUrl ?? '', 'EVAL_BASE_URL');
    if (model === undefined) throw new Error(MISSING_MODEL_MESSAGE);
  }
  return {
    provider,
    baseUrl,
    apiKeyEnv,
    apiKey: trimmed(env[apiKeyEnv]) ?? null,
    model: model ?? DEFAULT_MODEL,
    effort,
    maxTurns,
    schemaDrop,
    minIntervalMs,
  };
}

/** Host of the base URL, for the baseline table (e.g. api.mistral.ai, localhost:11434). */
export function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export const MISSING_KEY_MESSAGE =
  'ANTHROPIC_API_KEY is not set. The eval calls the Claude API and needs a key:\n' +
  '  ANTHROPIC_API_KEY=sk-ant-... npm run eval\n' +
  'To use an OpenAI-compatible API instead (Mistral, OpenAI, OpenRouter, Ollama), set EVAL_BASE_URL and ' +
  'EVAL_MODEL, see evals/README.md.\n' +
  'Use `npm run eval -- --dry-run` to check the harness and questions without a key.';

export interface CliArgs extends ProviderFlags {
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
    else if (arg === '--provider') args.provider = next();
    else if (arg === '--base-url') args.baseUrl = next();
    else if (arg === '--api-key-env') args.apiKeyEnv = next();
    else if (arg === '--min-interval-ms') args.minIntervalMs = next();
    else if (arg === '--model') args.model = next();
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
  /** `error`: the question ended on an API or harness error (rate limit, network, 5xx), not on a wrong answer. */
  outcome: 'pass' | 'fail' | 'error';
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

/** The Anthropic provider: Messages API with adaptive thinking and effort. */
export function anthropicProvider(
  createMessage: CreateMessage,
  config: Pick<RunConfig, 'model' | 'effort'>,
): Provider {
  return {
    name: 'anthropic',
    isFatal: (error) => error instanceof Anthropic.AuthenticationError,
    start({ tools, system, question }): ChatSession {
      const claudeTools = tools.map(toClaudeTool);
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: question }];
      const fallback = FALLBACK_MODELS.has(config.model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {};
      return {
        async send(results: ToolOutcome[]): Promise<TurnResult> {
          if (results.length > 0) {
            messages.push({
              role: 'user',
              content: results.map(
                (r): Anthropic.Beta.BetaToolResultBlockParam => ({
                  type: 'tool_result',
                  tool_use_id: r.call.id,
                  content: r.text,
                  ...(r.isError ? { is_error: true } : {}),
                }),
              ),
            });
          }
          const response = await createMessage({
            model: config.model,
            max_tokens: MAX_TOKENS,
            system,
            tools: claudeTools,
            messages,
            thinking: { type: 'adaptive' },
            output_config: { effort: config.effort },
            ...fallback,
          });
          messages.push({ role: 'assistant', content: response.content });
          if (response.stop_reason === 'pause_turn') return { kind: 'continue' };
          const uses = response.content.filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
          );
          if (response.stop_reason !== 'tool_use' || uses.length === 0) {
            return {
              kind: 'final',
              stopReason: response.stop_reason ?? 'unknown',
              text: response.content
                .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('\n'),
            };
          }
          return {
            kind: 'tool_calls',
            calls: uses.map((use) => ({ id: use.id, name: use.name, input: use.input as Record<string, unknown> })),
          };
        },
      };
    },
  };
}

/** Key in `toolCalls` for calls to tools the server does not have (some models invent names). */
export const UNKNOWN_TOOL = '(unknown tool)';

/**
 * Run one tool call against the MCP server; failures become error results for the model.
 * A name the server does not list is counted under UNKNOWN_TOOL and never sent to MCP:
 * models sometimes put a made-up tool result in the name, which would garble the summary.
 */
async function executeToolCall(
  mcp: Client,
  call: ToolCall,
  toolCalls: Record<string, number>,
  known: ReadonlySet<string>,
): Promise<ToolOutcome> {
  if (!known.has(call.name)) {
    toolCalls[UNKNOWN_TOOL] = (toolCalls[UNKNOWN_TOOL] ?? 0) + 1;
    const name = call.name.length > 80 ? `${call.name.slice(0, 80)}...` : call.name;
    return {
      call,
      text: `Tool call failed: Unknown tool "${name}". Call one of the listed tools by its exact name.`,
      isError: true,
    };
  }
  toolCalls[call.name] = (toolCalls[call.name] ?? 0) + 1;
  if (call.inputError !== undefined) {
    return { call, text: `Tool call failed: ${call.inputError}`, isError: true };
  }
  try {
    const result = await mcp.callTool({ name: call.name, arguments: call.input });
    return { call, text: toolResultText(result), isError: result.isError === true };
  } catch (error) {
    return {
      call,
      text: `Tool call failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/** Run one question with any provider on a fresh harness and grade the answer. */
export async function runAgent(
  provider: Provider,
  config: Pick<RunConfig, 'maxTurns'>,
  qa: QaPair,
  index: number,
): Promise<QuestionResult> {
  const started = Date.now();
  const toolCalls: Record<string, number> = {};
  const harness = await startHarness();
  const mcp = await connectClient(harness);
  const base: Omit<
    QuestionResult,
    'actual' | 'passed' | 'outcome' | 'turns' | 'stopReason' | 'summary' | 'feedback'
  > = {
    index,
    question: qa.question,
    expected: qa.answer,
    toolCalls,
    totalToolCalls: 0,
    durationMs: 0,
  };
  let turns = 0;
  try {
    const tools = (await mcp.listTools()).tools;
    const known = new Set(tools.map((t) => t.name));
    const session = provider.start({ tools, system: buildSystemPrompt(mcp.getInstructions()), question: qa.question });
    let finalText = '';
    let stopReason = 'max_turns';
    let pending: ToolOutcome[] = [];
    while (turns < config.maxTurns) {
      turns++;
      const turn = await session.send(pending);
      pending = [];
      if (turn.kind === 'continue') continue;
      if (turn.kind === 'final') {
        // Mistral ends a generation that failed on its side with finish_reason "error":
        // an API error, not a wrong answer.
        if (turn.stopReason === 'error') {
          throw new Error('the model API ended the turn with finish_reason "error"');
        }
        stopReason = turn.stopReason;
        finalText = turn.text;
        break;
      }
      // Run every tool call of this turn; all results go back together.
      pending = await Promise.all(turn.calls.map((call) => executeToolCall(mcp, call, toolCalls, known)));
    }
    const actual = extractTagged(finalText, 'response');
    const passed = answersMatch(actual, qa.answer);
    return {
      ...base,
      actual,
      passed,
      outcome: passed ? 'pass' : 'fail',
      totalToolCalls: Object.values(toolCalls).reduce((a, b) => a + b, 0),
      turns,
      stopReason,
      durationMs: Date.now() - started,
      summary: extractTagged(finalText, 'summary'),
      feedback: extractTagged(finalText, 'feedback'),
    };
  } catch (error) {
    if (provider.isFatal(error)) throw error;
    return {
      ...base,
      actual: null,
      passed: false,
      outcome: 'error',
      totalToolCalls: Object.values(toolCalls).reduce((a, b) => a + b, 0),
      turns,
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

/** Run one question with Claude on a fresh harness and grade the answer. */
export function runQuestion(
  createMessage: CreateMessage,
  config: Pick<RunConfig, 'model' | 'effort' | 'maxTurns'>,
  qa: QaPair,
  index: number,
): Promise<QuestionResult> {
  return runAgent(anthropicProvider(createMessage, config), config, qa, index);
}

function formatToolCalls(calls: Record<string, number>): string {
  const entries = Object.entries(calls).sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? 'none' : entries.map(([n, c]) => `${n}×${String(c)}`).join(', ');
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Plugin version from package.json, for the baseline table. */
export function pluginVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? 'unknown';
}

export interface BaselineInput {
  date: string;
  version: string;
  provider: ProviderName;
  /** Host of the base URL, e.g. api.mistral.ai. */
  host: string;
  model: string;
  /** Anthropic effort; `-` for the openai provider, which sends none. */
  effort: string;
  passed: number;
  total: number;
  toolCalls: number;
}

/** One row for the baseline table in evals/README.md (#466, #483). */
export function baselineRow(b: BaselineInput): string {
  const pct = b.total === 0 ? 0 : (b.passed / b.total) * 100;
  const perQuestion = b.total === 0 ? 0 : b.toolCalls / b.total;
  return (
    `| ${b.date} | ${b.version} | ${b.provider} | ${b.host} | ${b.model} | ${b.effort} | ${String(BULK_SEED)} | ` +
    `${String(b.passed)}/${String(b.total)} (${pct.toFixed(0)}%) | ${perQuestion.toFixed(1)} |`
  );
}

/** Effort as shown in output and the baseline row. */
function effortLabel(config: RunConfig): string {
  return config.provider === 'anthropic' ? config.effort : '-';
}

function fixtureLine(f: { files: number; generated: number; seed: number | null }): string {
  return (
    `Fixture: ${String(f.files)} files (${String(f.files - f.generated)} from evals/fixture-vault/, ` +
    `${String(f.generated)} generated with seed ${String(f.seed)}).`
  );
}

/** The provider settings, never the key itself. */
function providerLines(config: RunConfig): string[] {
  const label = config.provider === 'anthropic' ? 'Claude Messages API' : 'OpenAI-compatible Chat Completions';
  return [
    `Provider: ${config.provider} (${label})`,
    `Base URL: ${config.baseUrl}`,
    `Model:    ${config.model}${config.provider === 'anthropic' ? `, effort ${config.effort}` : ''}`,
    `API key:  from ${config.apiKeyEnv} (${config.apiKey === null ? 'not set' : 'set'})`,
    `Pacing:   ${config.minIntervalMs > 0 ? `at least ${String(config.minIntervalMs)} ms between requests` : 'none'}`,
  ];
}

async function dryRun(config: RunConfig, pairs: Array<{ qa: QaPair; index: number }>): Promise<void> {
  const harness = await startHarness();
  const mcp = await connectClient(harness);
  try {
    const listed = (await mcp.listTools()).tools;
    const converted =
      config.provider === 'anthropic'
        ? listed.map(toClaudeTool).length
        : listed.map((t) => toOpenAITool(t, config.schemaDrop)).length;
    const target = config.provider === 'anthropic' ? 'Claude' : 'the OpenAI-compatible API';
    for (const line of providerLines(config)) print(line);
    if (config.provider === 'openai' && config.schemaDrop.length > 0) {
      print(`Dropped schema keywords: $schema, ${config.schemaDrop.join(', ')}`);
    }
    print(`Dry run: harness at ${harness.url}, ${String(converted)} tools converted for ${target}.`);
    print(`Server instructions: ${String(mcp.getInstructions()?.length ?? 0)} characters.`);
    print(fixtureLine(harness.fixture));
    for (const { qa, index } of pairs) {
      print(`  Q${String(index)}: ${qa.question}\n       expected: ${qa.answer}`);
    }
    print('No model calls were made.');
  } finally {
    await mcp.close();
    await harness.close();
  }
}

/** Injectable pieces for tests: the HTTP client of the openai provider, its waits and retry log. */
export interface MainDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** Retries of the Anthropic SDK on 429/5xx (it honours Retry-After), matching the openai provider. */
const ANTHROPIC_MAX_RETRIES = 6;

function createProvider(config: RunConfig, deps: MainDeps): Provider {
  if (config.provider === 'openai') {
    return openAIProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiKeyEnv: config.apiKeyEnv,
      model: config.model,
      schemaDrop: config.schemaDrop,
      minIntervalMs: config.minIntervalMs,
      fetch: deps.fetch,
      sleep: deps.sleep,
      log: deps.log,
    });
  }
  const anthropic = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    maxRetries: ANTHROPIC_MAX_RETRIES,
  });
  const pace = createPacer(
    config.minIntervalMs,
    deps.sleep ?? ((ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms))),
  );
  const createMessage: CreateMessage = async (params) => {
    await pace();
    return anthropic.beta.messages.create(params);
  };
  return anthropicProvider(createMessage, config);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, deps: MainDeps = {}): Promise<number> {
  const args = parseArgs(argv);
  const config = readConfig(env, args);
  const all = parseEvaluationXml(readFileSync(args.file, 'utf8'));
  const selected = all
    .map((qa, i) => ({ qa, index: i + 1 }))
    .filter(({ index }) => args.only === null || args.only.includes(index));
  if (selected.length === 0) throw new Error('No questions selected.');

  if (args.dryRun) {
    await dryRun(config, selected);
    return 0;
  }
  if (config.apiKey === null) {
    if (config.provider === 'anthropic') {
      process.stderr.write(`${MISSING_KEY_MESSAGE}\n`);
      return 2;
    }
    process.stderr.write(
      `Note: ${config.apiKeyEnv} is not set, so requests go without an Authorization header ` +
        `(fine for local servers such as Ollama).\n`,
    );
  }

  const provider = createProvider(config, deps);
  print(
    `Running ${String(selected.length)} question(s) with ${config.provider} ${config.model} at ` +
      `${baseUrlHost(config.baseUrl)} (` +
      (config.provider === 'anthropic' ? `effort ${config.effort}, ` : '') +
      `max ${String(config.maxTurns)} turns` +
      (config.minIntervalMs > 0 ? `, at least ${String(config.minIntervalMs)} ms between requests` : '') +
      ')\n',
  );
  const results: QuestionResult[] = [];
  for (const { qa, index } of selected) {
    let r: QuestionResult;
    try {
      r = await runAgent(provider, config, qa, index);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ProviderAuthError(
          `anthropic provider: HTTP 401 from ${config.baseUrl} (model ${config.model}). ` +
            `The API key comes from ${config.apiKeyEnv}; check it in .env or the environment. ${error.message}`,
        );
      }
      throw error;
    }
    results.push(r);
    print(
      `${r.outcome.toUpperCase()}${r.outcome === 'error' ? ' ' : '  '}Q${String(index)}  ` +
        `${String(r.totalToolCalls)} tool calls (${formatToolCalls(r.toolCalls)}), ` +
        `${String(r.turns)} turns, ${(r.durationMs / 1000).toFixed(1)}s`,
    );
    if (!r.passed) {
      print(`      expected: ${r.expected}`);
      print(`      got:      ${r.actual ?? '(no <response> tag)'}  [stop: ${r.stopReason}]`);
      if (r.error) print(`      error:    ${r.error}`);
    }
  }

  const passed = results.filter((r) => r.outcome === 'pass').length;
  const failed = results.filter((r) => r.outcome === 'fail').length;
  const errored = results.filter((r) => r.outcome === 'error');
  const totalCalls = results.reduce((a, r) => a + r.totalToolCalls, 0);
  print('');
  print(`Accuracy: ${String(passed)}/${String(results.length)} (${((passed / results.length) * 100).toFixed(1)}%)`);
  print(`Results: ${String(passed)} passed, ${String(failed)} failed, ${String(errored.length)} errored`);
  print(`Tool calls: ${String(totalCalls)} total, ${(totalCalls / results.length).toFixed(1)} per question`);
  const baseline: BaselineInput = {
    date: new Date().toISOString().slice(0, 10),
    version: pluginVersion(),
    provider: config.provider,
    host: baseUrlHost(config.baseUrl),
    model: config.model,
    effort: effortLabel(config),
    passed,
    total: results.length,
    toolCalls: totalCalls,
  };
  if (args.only === null) {
    print('');
    if (errored.length > 0) {
      const which = errored.map((r) => String(r.index)).join(',');
      print(
        `Not a valid baseline: ${String(errored.length)} question(s) errored, so no baseline row is printed. ` +
          `Re-run them with --only ${which}, or slow down with EVAL_MIN_INTERVAL_MS, and record a baseline ` +
          'only from a full run without errors.',
      );
    } else {
      print('Baseline row for evals/README.md (full run only):');
      print(baselineRow(baseline));
    }
  }

  if (args.report) {
    writeFileSync(
      args.report,
      JSON.stringify(
        {
          date: baseline.date,
          version: baseline.version,
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          effort: baseline.effort,
          bulkSeed: BULK_SEED,
          passed,
          failed,
          errored: errored.length,
          total: results.length,
          results,
        },
        null,
        2,
      ),
    );
    print(`Report written to ${args.report}`);
  }
  return results.some((r) => r.error !== undefined) ? 1 : 0;
}

if (process.argv[1]?.endsWith('run.ts')) {
  // `.env` in the repository root, if present; variables already set win (#483).
  const loaded = loadDotEnv(resolve(process.cwd(), '.env'), process.env);
  if (loaded.length > 0) process.stderr.write(`Loaded ${loaded.join(', ')} from .env\n`);
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
