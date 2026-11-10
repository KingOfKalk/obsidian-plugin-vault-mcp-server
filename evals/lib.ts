/**
 * Deterministic helpers for the eval runner (#393): reading the qa_pair XML
 * file, pulling the tagged answer out of a model reply, comparing it with
 * the expected answer, loading `.env`, and the provider interface shared by
 * the Anthropic and OpenAI-compatible providers (#483). Covered by
 * tests/evals/lib.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { Tool } from '@modelcontextprotocol/client';

export interface QaPair {
  question: string;
  answer: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function innerText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!m) return null;
  const raw = m[1];
  // CDATA content is literal; everything else gets entity-decoded.
  return (raw.includes('<![CDATA[') ? stripCdata(raw) : decodeEntities(raw)).trim();
}

/**
 * Parse an mcp-builder evaluation file:
 * `<evaluation><qa_pair><question/><answer/></qa_pair>...</evaluation>`.
 * Throws on a qa_pair missing either field, so a typo never silently drops
 * a question.
 */
export function parseEvaluationXml(xml: string): QaPair[] {
  // Strip comments until none are left, so overlapping fragments such as
  // `<!<!---->--` cannot reassemble into a new `<!--` after one pass.
  let withoutComments = xml;
  let previous: string;
  do {
    previous = withoutComments;
    withoutComments = withoutComments.replace(/<!--[\s\S]*?-->/g, '');
  } while (withoutComments !== previous);
  if (!/<evaluation>[\s\S]*<\/evaluation>/.test(withoutComments)) {
    throw new Error('Evaluation file has no <evaluation> root element.');
  }
  const pairs: QaPair[] = [];
  const re = /<qa_pair>([\s\S]*?)<\/qa_pair>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const question = innerText(m[1], 'question');
    const answer = innerText(m[1], 'answer');
    if (!question || !answer) {
      throw new Error(`qa_pair #${String(pairs.length + 1)} needs a non-empty <question> and <answer>.`);
    }
    pairs.push({ question, answer });
  }
  return pairs;
}

/** Last `<tag>...</tag>` in `text`, trimmed, or null when absent. */
export function extractTagged(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last === null ? null : last.trim();
}

/**
 * Normalise an answer for comparison: Unicode NFKC, case-folded, inner
 * whitespace collapsed, wrapping quotes/backticks/bold and one trailing
 * period removed. Deliberately small; anything looser belongs in the
 * question's format instruction, not here.
 */
export function normaliseAnswer(value: string): string {
  let s = value.normalize('NFKC').trim();
  for (;;) {
    const before = s;
    s = s.replace(/\.$/, '').trim();
    s = s.replace(/^\*\*(.*)\*\*$/s, '$1').trim();
    s = s.replace(/^(["'`])(.*)\1$/s, '$2').trim();
    if (s === before) break;
  }
  return s.replace(/\s+/g, ' ').toLowerCase();
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/** True when `actual` matches `expected` after normalisation (numbers by value). */
export function answersMatch(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const a = normaliseAnswer(actual);
  const e = normaliseAnswer(expected);
  if (a === e) return true;
  return NUMBER_RE.test(a) && NUMBER_RE.test(e) && Number(a) === Number(e);
}

/**
 * Load a `.env` file into `env` if it exists, the way `process.loadEnvFile`
 * does: variables that are already set win over the file. Returns the
 * names it set.
 */
export function loadDotEnv(path: string, env: NodeJS.ProcessEnv): string[] {
  if (!existsSync(path)) return [];
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  const set: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (value === undefined || env[name] !== undefined) continue;
    env[name] = value;
    set.push(name);
  }
  return set;
}

/**
 * A function to await before every model API request so that requests
 * start at least `minIntervalMs` apart (EVAL_MIN_INTERVAL_MS, #483). With 0
 * it never waits.
 */
export function createPacer(
  minIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number = Date.now,
): () => Promise<void> {
  let last: number | null = null;
  return async (): Promise<void> => {
    if (minIntervalMs > 0 && last !== null) {
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    last = now();
  };
}

export type ProviderName = 'anthropic' | 'openai';

/** A tool call the model asked for, in provider-neutral form. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Set when the arguments could not be parsed; the tool is then not called. */
  inputError?: string;
}

/** The result of one tool call, as text for the model. */
export interface ToolOutcome {
  call: ToolCall;
  text: string;
  isError: boolean;
}

/** What one model turn produced. */
export type TurnResult =
  | { kind: 'tool_calls'; calls: ToolCall[] }
  | { kind: 'final'; text: string; stopReason: string }
  /** The model paused (Anthropic `pause_turn`); send again without results. */
  | { kind: 'continue' };

/** One question's conversation: send the previous turn's tool results, get the next turn. */
export interface ChatSession {
  send(results: ToolOutcome[]): Promise<TurnResult>;
}

export interface Provider {
  name: ProviderName;
  start(setup: { tools: Tool[]; system: string; question: string }): ChatSession;
  /** Errors that stop the whole run (bad key) instead of failing one question. */
  isFatal(error: unknown): boolean;
}
