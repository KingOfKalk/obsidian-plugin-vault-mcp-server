import { z } from 'zod';

/**
 * Shared Zod fragment for `limit`/`offset` pagination inputs.
 * - `limit` caps at 100 and defaults to 20 — enough for a useful page without
 *   blowing past CHARACTER_LIMIT.
 * - `offset` starts at 0 and can advance arbitrarily far as long as the
 *   underlying dataset is walkable.
 */
export const paginationFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum items to return (1..100, default 20).'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Number of items to skip before returning results (default 0).'),
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
  has_more: boolean;
  next_offset?: number;
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
  const has_more = end < total;
  return {
    total,
    count: page.length,
    offset,
    items: page,
    has_more,
    ...(has_more ? { next_offset: end } : {}),
  };
}

/**
 * Convenience: pull a valid `{ limit, offset }` pair out of a raw params
 * object. The dispatcher-level `schema.parse()` normally injects the defaults,
 * but handlers are also exercised directly in unit tests with ad-hoc
 * argument objects — in that case fall back to the documented defaults so
 * the tests don't all have to carry pagination boilerplate.
 */
const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;

export function readPagination(
  params: Record<string, unknown>,
): PaginationInput {
  const limit =
    typeof params.limit === 'number' && Number.isFinite(params.limit)
      ? params.limit
      : DEFAULT_LIMIT;
  const offset =
    typeof params.offset === 'number' && Number.isFinite(params.offset)
      ? params.offset
      : DEFAULT_OFFSET;
  return { limit, offset };
}
