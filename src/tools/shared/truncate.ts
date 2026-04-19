import { CHARACTER_LIMIT } from '../../constants';

export interface TruncationResult {
  /** The possibly-truncated text, with a `[TRUNCATED: ...]` footer appended when cut. */
  text: string;
  /** True when the original text exceeded the limit. */
  truncated: boolean;
  /** Present only when truncated; human-readable guidance for the caller. */
  truncation_message?: string;
}

/**
 * Cap a tool response to `limit` characters. When the payload is over the
 * limit the function slices off the tail and appends a `[TRUNCATED: ...]`
 * footer so the model sees the truncation inside the text. The returned
 * object also reports `truncated: true` and a `truncation_message` so
 * structured-content-aware callers (see #176) can surface it as data.
 */
export function truncateText(
  text: string,
  {
    limit = CHARACTER_LIMIT,
    hint = 'Narrow your query or request a specific subset.',
  }: { limit?: number; hint?: string } = {},
): TruncationResult {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  const truncation_message = `Response exceeded ${String(limit)} characters. ${hint}`;
  const footer = `\n\n[TRUNCATED: ${truncation_message}]`;
  const sliceLength = Math.max(0, limit - footer.length);
  return {
    text: text.slice(0, sliceLength) + footer,
    truncated: true,
    truncation_message,
  };
}
