import { z } from 'zod';

/**
 * Default and largest `length` of a text window (`vault_read`,
 * `editor_get_content`). It stays below CHARACTER_LIMIT so the content plus
 * the document header and the "continue at offset=…" footer fit in one
 * response.
 */
export const READ_MAX_LENGTH = 24_000;

/**
 * Cut the [offset, offset + length) window out of a text for paging. Never
 * ends a window between the two halves of a surrogate pair, so a multi-chunk
 * read reassembles to the exact original text.
 */
export function sliceTextWindow(
  content: string,
  offset: number,
  length: number,
): { content: string; offset: number; end: number; hasMore: boolean } {
  const start = Math.min(Math.max(0, offset), content.length);
  let end = Math.min(start + Math.max(1, length), content.length);
  if (end < content.length && end > start + 1) {
    const code = content.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return {
    content: content.slice(start, end),
    offset: start,
    end,
    hasMore: end < content.length,
  };
}

/** A window cut by {@link sliceTextWindow}. */
type TextWindow = ReturnType<typeof sliceTextWindow>;

/**
 * Paging lines of a document header (#467) for a window of a text of
 * `totalLength` characters.
 */
export function windowMeta(
  w: TextWindow,
  totalLength: number,
): { totalLength: number; offset: number; hasMore: boolean; nextOffset?: number } {
  return {
    totalLength,
    offset: w.offset,
    hasMore: w.hasMore,
    ...(w.hasMore ? { nextOffset: w.end } : {}),
  };
}

/** The window text, with {@link windowFooter} when more follows. */
export function windowBody(tool: string, w: TextWindow, totalLength: number): string {
  return w.hasMore ? `${w.content}${windowFooter(tool, w.offset, w.end, totalLength)}` : w.content;
}

/** Footer of a window that has more text, naming the tool to call again. */
function windowFooter(
  tool: string,
  offset: number,
  end: number,
  totalLength: number,
): string {
  return `\n\n[TRUNCATED: Showing characters ${String(offset)}-${String(end)} of ${String(totalLength)}. Call ${tool} again with offset=${String(end)} to continue.]`;
}

/** `offset` of a text window (#464). */
export const windowOffsetField = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe('Character offset to start at; pass nextOffset from the previous call to continue.');

/** `length` of a text window; `whole` says what is returned whole when it fits. */
export function windowLengthField(whole: string): z.ZodOptional<z.ZodNumber> {
  return z
    .number()
    .int()
    .min(1)
    .max(READ_MAX_LENGTH)
    .optional()
    .describe(
      `Maximum characters to return (default ${String(READ_MAX_LENGTH)}). ${whole} that fit are returned whole.`,
    );
}
