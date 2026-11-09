import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { CHARACTER_LIMIT } from '../../constants';

const DEFAULT_LIMIT_VALUE = 20;

/**
 * Shared Zod fragment for `limit`/`offset` pagination inputs.
 * - `limit` caps at 100 and defaults to 20 — enough for a useful page without
 *   blowing past CHARACTER_LIMIT.
 * - `offset` starts at 0 and can advance arbitrarily far as long as the
 *   underlying dataset is walkable.
 */
export function paginationFieldsWithDefault(defaultLimit: number): {
  limit: z.ZodDefault<z.ZodNumber>;
  offset: z.ZodDefault<z.ZodNumber>;
} {
  return {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(defaultLimit)
      .describe('Maximum items per page.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Items to skip; pass nextOffset to get the next page.'),
  };
}

export const paginationFields = paginationFieldsWithDefault(DEFAULT_LIMIT_VALUE);

/**
 * Output-schema fields of a page (#464), for tools whose items sit in a
 * field of their own (e.g. `links`, `files`) rather than in `items`.
 */
export const pageOutputFields = {
  total: z.number().describe('Total number of items before paging.'),
  count: z.number().describe('Number of items in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  hasMore: z.boolean().describe('True when more items follow this page.'),
  nextOffset: z
    .number()
    .optional()
    .describe('Offset to pass in the next call when hasMore is true.'),
};

export interface PaginationInput {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  hasMore: boolean;
  nextOffset?: number;
}

/**
 * Apply a validated (limit, offset) window to a fully-materialised array and
 * produce the standard response envelope.
 *
 * Callers that can push the window down into the source (e.g. a database or
 * vault adapter) should prefer that — this helper is the correct shape for
 * the cheap in-memory case.
 */
export function paginate<T>(
  items: readonly T[],
  { limit, offset }: PaginationInput,
): PaginatedResponse<T> {
  const total = items.length;
  const start = Math.min(offset, total);
  const end = Math.min(offset + limit, total);
  const page = items.slice(start, end);
  const hasMore = end < total;
  return {
    total,
    count: page.length,
    offset,
    items: page,
    hasMore,
    ...(hasMore ? { nextOffset: end } : {}),
  };
}

/**
 * Convenience: pull a valid `{ limit, offset }` pair out of a raw params
 * object. The dispatcher-level `schema.parse()` normally injects the defaults,
 * but handlers are also exercised directly in unit tests with ad-hoc
 * argument objects — in that case fall back to the documented defaults so
 * the tests don't all have to carry pagination boilerplate.
 */
const DEFAULT_OFFSET = 0;

export function readPagination(
  params: Record<string, unknown>,
  defaultLimit = DEFAULT_LIMIT_VALUE,
): PaginationInput {
  const limit =
    typeof params.limit === 'number' && Number.isFinite(params.limit)
      ? params.limit
      : defaultLimit;
  const offset =
    typeof params.offset === 'number' && Number.isFinite(params.offset)
      ? params.offset
      : DEFAULT_OFFSET;
  return { limit, offset };
}

/** Characters of all text blocks in a tool result. */
export function resultTextLength(result: CallToolResult): number {
  let size = 0;
  for (const block of result.content) {
    if (block.type === 'text') size += block.text.length;
  }
  return size;
}

/**
 * Stay under `limit` by returning fewer items, never by cutting text (#464):
 * `render(n)` builds the whole result (text and structuredContent) for the
 * first `n` of `count` items, and this re-renders with fewer items until the
 * text fits. Each round keeps the share of items that would fit at the
 * current average size, so it ends in a few rounds. One item that is too
 * large on its own is returned as is; the dispatcher's safety net caps it.
 */
export function fitItems(
  count: number,
  render: (n: number) => CallToolResult,
  limit = CHARACTER_LIMIT,
): CallToolResult {
  let n = count;
  let result = render(n);
  let size = resultTextLength(result);
  while (size > limit && n > 1) {
    n = Math.max(1, Math.min(n - 1, Math.floor((n * limit) / size)));
    result = render(n);
    size = resultTextLength(result);
  }
  return result;
}

/**
 * The first `n` items of a page; `hasMore`/`nextOffset` then point at the
 * first item left out.
 */
export function shrinkPage<T>(page: PaginatedResponse<T>, n: number): PaginatedResponse<T> {
  if (n >= page.items.length) return page;
  const end = page.offset + n;
  return {
    ...page,
    count: n,
    items: page.items.slice(0, n),
    hasMore: true,
    nextOffset: end,
  };
}

/** {@link fitItems} over a page from {@link paginate}. */
export function fitPage<T>(
  page: PaginatedResponse<T>,
  render: (page: PaginatedResponse<T>) => CallToolResult,
  limit = CHARACTER_LIMIT,
): CallToolResult {
  return fitItems(page.items.length, (n) => render(shrinkPage(page, n)), limit);
}
