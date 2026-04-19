import { describe, it, expect } from 'vitest';
import { paginate, readPagination } from '../../../src/tools/shared/pagination';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
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
    expect(page.has_more).toBe(false);
    expect(page.next_offset).toBeUndefined();
    expect(page.items).toEqual(data);
  });

  it('slices according to limit/offset', () => {
    const page = paginate(data, { limit: 10, offset: 5 });
    expect(page.total).toBe(25);
    expect(page.count).toBe(10);
    expect(page.items).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(page.has_more).toBe(true);
    expect(page.next_offset).toBe(15);
  });

  it('clamps offset beyond the total to an empty page', () => {
    const page = paginate(data, { limit: 10, offset: 100 });
    expect(page.total).toBe(25);
    expect(page.count).toBe(0);
    expect(page.items).toEqual([]);
    expect(page.has_more).toBe(false);
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
      response_format: 'json',
    });
    const p1 = JSON.parse(getText(r1)) as {
      total: number;
      count: number;
      has_more: boolean;
      next_offset?: number;
      items: unknown[];
    };
    expect(p1.total).toBe(25);
    expect(p1.count).toBe(10);
    expect(p1.has_more).toBe(true);
    expect(p1.next_offset).toBe(10);

    const r2 = await handlers.searchFulltext({
      query: 'match',
      limit: 10,
      offset: p1.next_offset,
      response_format: 'json',
    });
    const p2 = JSON.parse(getText(r2)) as typeof p1;
    expect(p2.count).toBe(10);
    expect(p2.has_more).toBe(true);
    expect(p2.next_offset).toBe(20);

    const r3 = await handlers.searchFulltext({
      query: 'match',
      limit: 10,
      offset: p2.next_offset,
      response_format: 'json',
    });
    const p3 = JSON.parse(getText(r3)) as typeof p1;
    expect(p3.count).toBe(5);
    expect(p3.has_more).toBe(false);
    expect(p3.next_offset).toBeUndefined();
  });
});
