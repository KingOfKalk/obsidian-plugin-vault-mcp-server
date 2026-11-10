/**
 * OpenAI-compatible provider for the eval runner (#483): any API that speaks
 * the Chat Completions format with function calling (Mistral, OpenAI,
 * OpenRouter, Ollama, LM Studio, ...). Plain `fetch`, no vendor SDK, so
 * every compatible API is driven the same way. Covered by
 * tests/evals/openai.test.ts against a mocked fetch.
 */
import type { Tool } from '@modelcontextprotocol/client';
import { createPacer, type ChatSession, type Provider, type ToolCall, type ToolOutcome, type TurnResult } from './lib';

/** JSON Schema keywords always dropped from function parameters: metadata no model needs. */
export const ALWAYS_DROPPED_KEYWORDS: readonly string[] = ['$schema'];

/** Retries after HTTP 429/503, and the cap of one wait (backoff 2, 4, 8, 16, 32, 60 s). */
export const MAX_RETRIES = 6;
const MAX_RETRY_WAIT_MS = 60_000;
const RETRY_STATUSES = new Set([429, 503]);
/** One request may take long on a slow local model, but never hang forever. */
const REQUEST_TIMEOUT_MS = 300_000;

export interface OpenAIFunctionTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface OpenAIToolCallParam {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCallParam[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools: OpenAIFunctionTool[];
  tool_choice: 'auto';
}

export interface OpenAIOptions {
  /** e.g. https://api.mistral.ai/v1; `/chat/completions` is appended. */
  baseUrl: string;
  /** null sends no Authorization header (local servers). */
  apiKey: string | null;
  /** Name of the env variable the key came from, for error messages. */
  apiKeyEnv: string;
  model: string;
  /** Extra JSON Schema keywords to drop from tool parameters (EVAL_SCHEMA_DROP). */
  schemaDrop?: readonly string[];
  /** Minimum gap between two requests in ms (EVAL_MIN_INTERVAL_MS); 0 sends at once. */
  minIntervalMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Where retry notes go; defaults to stderr. */
  log?: (line: string) => void;
}

/** 401/403 from the provider: stops the whole run instead of failing every question. */
export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keywords whose value is one subschema. */
const SUBSCHEMA_KEYS = new Set(['items', 'additionalProperties', 'not', 'contains', 'if', 'then', 'else']);
/** Keywords whose value is a list of subschemas. */
const SUBSCHEMA_LIST_KEYS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
/** Keywords whose value maps names to subschemas (the names are not keywords). */
const SUBSCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

/**
 * Copy of a JSON Schema without the given keywords. Only schema positions
 * are walked, so a property that happens to be named like a keyword stays.
 */
export function sanitizeSchema(schema: unknown, drop: ReadonlySet<string>): unknown {
  if (Array.isArray(schema)) return schema.map((s) => sanitizeSchema(s, drop));
  if (!isRecord(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (drop.has(key)) continue;
    if (SUBSCHEMA_KEYS.has(key) || SUBSCHEMA_LIST_KEYS.has(key)) {
      out[key] = sanitizeSchema(value, drop);
    } else if (SUBSCHEMA_MAP_KEYS.has(key) && isRecord(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeSchema(v, drop)]));
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** MCP tool definition -> OpenAI `tools` entry. */
export function toOpenAITool(tool: Tool, schemaDrop: readonly string[] = []): OpenAIFunctionTool {
  const drop = new Set([...ALWAYS_DROPPED_KEYWORDS, ...schemaDrop]);
  const parameters = sanitizeSchema(tool.inputSchema, drop);
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? tool.title ?? tool.name,
      parameters: isRecord(parameters) ? parameters : { type: 'object', properties: {} },
    },
  };
}

/** `arguments` as a JSON string (the standard) or an object (some servers). */
export function parseToolArguments(raw: unknown): { input: Record<string, unknown>; error?: string } {
  if (isRecord(raw)) return { input: raw };
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { input: {} };
  if (typeof raw !== 'string') return { input: {}, error: 'Tool arguments must be a JSON object.' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) return { input: parsed };
    return { input: {}, error: 'Tool arguments must be a JSON object.' };
  } catch (error) {
    return {
      input: {},
      error: `Tool arguments are not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
}

/** Text of an assistant message: a string, or Mistral-style content chunks. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c): c is { type: 'text'; text: string } => isRecord(c) && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

function excerpt(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

/**
 * Wait before retry `attempt` (1-based): Retry-After in seconds when the
 * server sends it, else exponential backoff 2, 4, 8, 16, 32 s; capped at 60 s.
 */
export function retryWaitMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null || retryAfter.trim() === '' ? NaN : Number(retryAfter);
  const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2 ** attempt * 1000;
  return Math.min(wait, MAX_RETRY_WAIT_MS);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

/**
 * One Chat Completions request. Retries up to MAX_RETRIES times after HTTP
 * 429 or 503 (Retry-After or exponential backoff, at most 60 s per wait),
 * logging one line per wait; 401/403 throw ProviderAuthError naming the
 * base URL and the env variable the key came from. `pace` runs before every
 * request, retries included (minimum interval, see createPacer).
 */
export async function postChatCompletion(
  opts: OpenAIOptions,
  body: OpenAIRequest,
  pace: () => Promise<void> = (): Promise<void> => Promise.resolve(),
): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const url = chatCompletionsUrl(opts.baseUrl);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.apiKey !== null) headers.authorization = `Bearer ${opts.apiKey}`;
  for (let retry = 0; ; retry++) {
    await pace();
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `openai provider: request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (RETRY_STATUSES.has(res.status) && retry < MAX_RETRIES) {
      await res.text().catch(() => '');
      const wait = retryWaitMs(retry + 1, res.headers.get('retry-after'));
      const what = res.status === 429 ? 'rate limited' : 'service unavailable (HTTP 503)';
      log(`  ${what}, waiting ${String(Math.round(wait / 1000))}s (attempt ${String(retry + 1)}/${String(MAX_RETRIES)})`);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      const keyState = opts.apiKey === null ? 'is not set' : 'is set';
      throw new ProviderAuthError(
        `openai provider: HTTP ${String(res.status)} from ${opts.baseUrl} (model ${opts.model}). ` +
          `The API key comes from ${opts.apiKeyEnv}, which ${keyState}. ` +
          `Check the key in .env or the environment, or pick another variable with --api-key-env.` +
          (text ? ` Response: ${excerpt(text, 200)}` : ''),
      );
    }
    if (!res.ok) {
      const after = RETRY_STATUSES.has(res.status) ? ` after ${String(MAX_RETRIES)} retries` : '';
      throw new Error(`openai provider: HTTP ${String(res.status)} from ${url}${after}: ${excerpt(text)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`openai provider: response from ${url} is not JSON: ${excerpt(text)}`);
    }
  }
}

/** Interpret one Chat Completions response as a turn of the agent loop. */
export function parseCompletion(response: unknown, nextId: () => string): {
  turn: TurnResult;
  assistant: OpenAIMessage;
} {
  const choice = isRecord(response) && Array.isArray(response.choices) ? (response.choices[0] as unknown) : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  if (!isRecord(choice) || !isRecord(message)) {
    throw new Error(`openai provider: response has no choices[0].message: ${excerpt(JSON.stringify(response))}`);
  }
  const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'unknown';
  const rawCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as unknown[]) : [];
  const text = messageText(message.content);
  const calls: ToolCall[] = [];
  const echoed: OpenAIToolCallParam[] = [];
  for (const raw of rawCalls) {
    if (!isRecord(raw) || !isRecord(raw.function)) continue;
    const fn = raw.function;
    const name = typeof fn.name === 'string' ? fn.name : '';
    const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : nextId();
    const args = parseToolArguments(fn.arguments);
    calls.push({ id, name, input: args.input, ...(args.error ? { inputError: args.error } : {}) });
    echoed.push({
      id,
      type: 'function',
      function: {
        name,
        arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      },
    });
  }
  if (calls.length > 0) {
    return {
      turn: { kind: 'tool_calls', calls },
      assistant: { role: 'assistant', content: text === '' ? null : text, tool_calls: echoed },
    };
  }
  return { turn: { kind: 'final', text, stopReason: finish }, assistant: { role: 'assistant', content: text } };
}

/** The OpenAI-compatible provider: one message history per question. */
export function openAIProvider(opts: OpenAIOptions): Provider {
  // One pacer for the whole run, so the gap holds across questions too.
  const pace = createPacer(opts.minIntervalMs ?? 0, opts.sleep ?? defaultSleep);
  return {
    name: 'openai',
    isFatal: (error) => error instanceof ProviderAuthError,
    start({ tools, system, question }): ChatSession {
      const openAITools = tools.map((t) => toOpenAITool(t, opts.schemaDrop));
      const messages: OpenAIMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: question },
      ];
      let idCounter = 0;
      // Mistral wants 9 alphanumeric characters; only used when a server sends no id.
      const nextId = (): string => `call${String(++idCounter).padStart(5, '0')}`;
      return {
        async send(results: ToolOutcome[]): Promise<TurnResult> {
          for (const r of results) {
            messages.push({
              role: 'tool',
              tool_call_id: r.call.id,
              name: r.call.name,
              content: r.isError ? `Error: ${r.text || '(no message)'}` : r.text || '(empty result)',
            });
          }
          const response = await postChatCompletion(
            opts,
            { model: opts.model, messages, tools: openAITools, tool_choice: 'auto' },
            pace,
          );
          const { turn, assistant } = parseCompletion(response, nextId);
          messages.push(assistant);
          return turn;
        },
      };
    },
  };
}
