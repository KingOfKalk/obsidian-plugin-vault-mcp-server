import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * Tool result formats (#467). Every successful tool result is one of two
 * kinds; errors stay plain text with `isError: true` (see errors.ts).
 *
 * - **Data tools** (lists, search, metadata, aspects, write confirmations,
 *   `server_info`, …) declare an `outputSchema` and return the payload as
 *   `structuredContent`, with the same payload serialised as compact JSON
 *   in the one text block, as the MCP spec recommends. A client that shows
 *   the model only `structuredContent`, or only the text, sees the same
 *   data either way.
 * - **Document tools** (`vault_read`, `editor_get_content`, …) have no
 *   `outputSchema` and no `structuredContent`. The text block is a short
 *   `key: value` header, a blank line, then the raw document text, never
 *   JSON-escaped. Clients that prefer `structuredContent` when it is
 *   present then fall back to this text, so the document stays readable.
 *
 * Both kinds put everything in a single text block: some clients pass only
 * the first text block to the model.
 */

/**
 * Result of a data tool: `structured` as `structuredContent`, and the same
 * value as compact JSON text. `structured` must match the tool's
 * `outputSchema`.
 */
export function dataResponse<T extends object>(structured: T): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

/** Header fields of a document result; `undefined` values are left out. */
export type DocumentMeta = Record<string, string | number | boolean | undefined>;

/**
 * The text of a document result: one `key: value` line per defined field,
 * a blank line, then `body` unchanged. Without fields it is just `body`.
 * Line breaks inside a value are replaced by spaces, so the first blank
 * line always ends the header.
 */
export function documentText(meta: DocumentMeta, body: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${String(value).replace(/\r?\n|\r/g, ' ')}`);
  }
  return lines.length === 0 ? body : `${lines.join('\n')}\n\n${body}`;
}

/** Result of a document tool: {@link documentText} only, no `structuredContent`. */
export function documentResponse(meta: DocumentMeta, body: string): CallToolResult {
  return { content: [{ type: 'text' as const, text: documentText(meta, body) }] };
}
