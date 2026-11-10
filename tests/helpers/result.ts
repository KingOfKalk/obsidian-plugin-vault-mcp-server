/**
 * Readers for the two tool result formats (#467), shared by the tests.
 * See src/tools/shared/response.ts.
 */

interface ResultLike {
  content: ReadonlyArray<{ type: string; text?: string }>;
  structuredContent?: unknown;
}

/** Text of the first text block, or '' when there is none. */
export function textOf(result: ResultLike): string {
  const block = result.content.find((b) => b.type === 'text');
  return block?.text ?? '';
}

/** A data tool result's JSON text, parsed. */
export function jsonOf<T = Record<string, unknown>>(result: ResultLike): T {
  return JSON.parse(textOf(result)) as T;
}

export interface ParsedDocument {
  /** Header fields as written (all values are strings). */
  meta: Record<string, string>;
  /** Everything after the blank line that ends the header. */
  body: string;
}

/**
 * Split a document result's text into its `key: value` header and body.
 * The header ends at the first blank line; a text without a header line
 * (`key: value` with a simple key) is all body.
 */
export function parseDocument(result: ResultLike | string): ParsedDocument {
  const text = typeof result === 'string' ? result : textOf(result);
  const end = text.indexOf('\n\n');
  const head = end === -1 ? text : text.slice(0, end);
  const lines = head.split('\n');
  if (!lines.every((line) => /^[A-Za-z]+: /.test(line))) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(': ');
    meta[line.slice(0, i)] = line.slice(i + 2);
  }
  return { meta, body: end === -1 ? '' : text.slice(end + 2) };
}

/** A text window read back from a document result (vault_read, editor_get_content, …). */
export interface ParsedWindow {
  meta: Record<string, string>;
  totalLength: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
  /** The window text, without the "[TRUNCATED: …]" footer. */
  content: string;
}

/** Read a windowed document result: header numbers parsed, footer removed. */
export function windowOf(result: ResultLike | string): ParsedWindow {
  const { meta, body } = parseDocument(result);
  const hasMore = meta.hasMore === 'true';
  const footer = body.lastIndexOf('\n\n[TRUNCATED: ');
  return {
    meta,
    totalLength: Number(meta.totalLength),
    offset: Number(meta.offset),
    hasMore,
    ...(meta.nextOffset !== undefined ? { nextOffset: Number(meta.nextOffset) } : {}),
    content: hasMore && footer !== -1 ? body.slice(0, footer) : body,
  };
}
