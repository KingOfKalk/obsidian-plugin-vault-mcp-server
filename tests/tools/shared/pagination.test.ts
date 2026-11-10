import { describe, it, expect, vi } from 'vitest';
import {
  fitItems,
  fitPage,
  paginate,
  paginationFields,
  readPagination,
  resultTextLength,
  shrinkPage,
} from '../../../src/tools/shared/pagination';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../helpers/mock-adapter';
import { createSearchHandlers } from '../../../src/tools/search/handlers';

function getText(r: CallToolResult): string {
  return r.content[0].type === 'text' ? r.content[0].text : '';
}

describe('paginate()', () => {
  const data = Array.from({ length: 25 }, (_, i) => i);

  it('returns the whole set when limit ≥ total', () => {
    const page = paginate(data, { limit: 100, offset: 0 });
    expect(page.total).toBe(25);
    expect(page.count).toBe(25);
    expect(page.hasMore).toBe(false);
    expect(page.nextOffset).toBeUndefined();
    expect(page.items).toEqual(data);
  });

  it('slices according to limit/offset', () => {
    const page = paginate(data, { limit: 10, offset: 5 });
    expect(page.total).toBe(25);
    expect(page.count).toBe(10);
    expect(page.items).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(15);
  });

  it('clamps offset beyond the total to an empty page', () => {
    const page = paginate(data, { limit: 10, offset: 100 });
    expect(page.total).toBe(25);
    expect(page.count).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('readPagination narrows unknown params to {limit, offset}', () => {
    expect(readPagination({ limit: 5, offset: 10, other: 'x' })).toEqual({
      limit: 5,
      offset: 10,
    });
  });
});

describe('search_fulltext pagination end-to-end', () => {
  it('walks a paginated result set across successive calls', async () => {
    const adapter = new MockObsidianAdapter();
    // 25 files all matching the query
    for (let i = 0; i < 25; i++) {
      adapter.addFile(`notes/file-${String(i).padStart(2, '0')}.md`, 'match');
    }
    const handlers = createSearchHandlers(adapter);

    const r1 = await handlers.searchFulltext({
      query: 'match',
      limit: 10,
      offset: 0,
    });
    const p1 = JSON.parse(getText(r1)) as {
      total: number;
      count: number;
      hasMore: boolean;
      nextOffset?: number;
      items: unknown[];
    };
    expect(p1.total).toBe(25);
    expect(p1.count).toBe(10);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextOffset).toBe(10);

    const r2 = await handlers.searchFulltext({
      query: 'match',
      limit: 10,
      offset: p1.nextOffset,
    });
    const p2 = JSON.parse(getText(r2)) as typeof p1;
    expect(p2.count).toBe(10);
    expect(p2.hasMore).toBe(true);
    expect(p2.nextOffset).toBe(20);

    const r3 = await handlers.searchFulltext({
      query: 'match',
      limit: 10,
      offset: p2.nextOffset,
    });
    const p3 = JSON.parse(getText(r3)) as typeof p1;
    expect(p3.count).toBe(5);
    expect(p3.hasMore).toBe(false);
    expect(p3.nextOffset).toBeUndefined();
  });
});

describe('fitting a page into CHARACTER_LIMIT (#464)', () => {
  const textResult = (text: string): CallToolResult => ({
    content: [{ type: 'text', text }],
  });

  it('fitItems keeps every item when the text fits', () => {
    const render = vi.fn((n: number) => textResult('x'.repeat(n)));
    expect(getText(fitItems(10, render, 100))).toHaveLength(10);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('fitItems renders fewer items until the text fits', () => {
    const result = fitItems(100, (n) => textResult('x'.repeat(n * 10)), 255);
    expect(getText(result)).toHaveLength(250);
  });

  it('fitItems stops at one item even when it is too large', () => {
    const result = fitItems(5, (n) => textResult('x'.repeat(n * 1000)), 10);
    expect(getText(result)).toHaveLength(1000);
  });

  it('shrinkPage points nextOffset at the first item left out', () => {
    const page = paginate(['a', 'b', 'c', 'd'], { limit: 3, offset: 1 });
    expect(shrinkPage(page, 1)).toEqual({
      total: 4,
      count: 1,
      offset: 1,
      items: ['b'],
      hasMore: true,
      nextOffset: 2,
    });
    expect(shrinkPage(page, 3)).toBe(page);
  });

  it('fitPage keeps the JSON text valid and in step with the page', () => {
    const page = paginate(
      Array.from({ length: 50 }, (_, i) => `item-${String(i)}`.padEnd(100, '.')),
      { limit: 50, offset: 0 },
    );
    const result = fitPage(
      page,
      (p) => ({ content: [{ type: 'text', text: JSON.stringify(p) }], structuredContent: { ...p } }),
      2_000,
    );
    const parsed = JSON.parse(getText(result)) as { count: number; nextOffset: number };
    expect(getText(result).length).toBeLessThanOrEqual(2_000);
    expect(parsed).toEqual(result.structuredContent);
    expect(parsed.nextOffset).toBe(parsed.count);
  });

  it('resultTextLength counts text blocks only', () => {
    expect(
      resultTextLength({
        content: [
          { type: 'text', text: 'abc' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
          { type: 'text', text: 'de' },
        ],
      }),
    ).toBe(5);
  });

  it('defaults to one page size of 50, max 100, for every paged tool (#490)', () => {
    expect(readPagination({})).toEqual({ limit: 50, offset: 0 });
    expect(paginationFields.limit.parse(undefined)).toBe(50);
    expect(paginationFields.limit.safeParse(100).success).toBe(true);
    expect(paginationFields.limit.safeParse(101).success).toBe(false);
  });
});
