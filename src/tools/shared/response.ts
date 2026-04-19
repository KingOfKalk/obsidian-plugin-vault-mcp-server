import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Output format for tool responses.
 * - `markdown` (default): human-readable text block
 * - `json`: machine-readable JSON block (pretty-printed)
 *
 * All tools that accept this field also emit `structuredContent` so modern
 * MCP clients can consume the typed payload alongside the rendered text.
 */
export const ResponseFormat = z.enum(['markdown', 'json']);
export type ResponseFormat = z.infer<typeof ResponseFormat>;

export const responseFormatField = {
  response_format: ResponseFormat.default('markdown').describe(
    'Output format: "markdown" for humans (default), "json" for machines.',
  ),
};

/**
 * Produce a CallToolResult containing both a human-readable text block and
 * a machine-readable `structuredContent`. The helper picks between a caller-
 * supplied markdown renderer and a pretty JSON rendering based on `format`.
 *
 * The structured payload is always carried on `structuredContent` — that
 * field is ignored by clients that don't understand it, so adding it is
 * backwards-compatible.
 */
export function makeResponse<T>(
  structured: T,
  renderMarkdown: (v: T) => string,
  format: ResponseFormat = 'markdown',
): CallToolResult {
  const text =
    format === 'json'
      ? JSON.stringify(structured, null, 2)
      : renderMarkdown(structured);
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: toStructuredContent(structured),
  };
}

/**
 * Coerce an arbitrary value into a safe `Record<string, unknown>` for the
 * `structuredContent` slot. Arrays are wrapped as `{ items: [...] }`, scalars
 * as `{ value }`, so callers never have to worry about the shape here.
 */
export function toStructuredContent(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  return { value };
}

export function readResponseFormat(
  params: Record<string, unknown>,
): ResponseFormat {
  const raw = params.response_format;
  return raw === 'json' ? 'json' : 'markdown';
}
