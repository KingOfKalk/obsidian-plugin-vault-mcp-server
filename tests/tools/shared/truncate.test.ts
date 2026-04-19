import { describe, it, expect } from 'vitest';
import { truncateText } from '../../../src/tools/shared/truncate';
import { CHARACTER_LIMIT } from '../../../src/constants';

describe('truncateText', () => {
  it('returns the input unchanged when below the limit', () => {
    const result = truncateText('hello world');
    expect(result.truncated).toBe(false);
    expect(result.text).toBe('hello world');
    expect(result.truncation_message).toBeUndefined();
  });

  it('truncates and appends a [TRUNCATED: ...] footer when over the limit', () => {
    const oversized = 'x'.repeat(CHARACTER_LIMIT + 500);
    const result = truncateText(oversized);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(result.text).toContain('[TRUNCATED:');
    expect(result.truncation_message).toContain(String(CHARACTER_LIMIT));
  });

  it('honours a custom limit and hint', () => {
    const result = truncateText('abcdefghij', {
      limit: 5,
      hint: 'Use search_fulltext with a narrower query.',
    });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[TRUNCATED:');
    expect(result.truncation_message).toContain(
      'Use search_fulltext with a narrower query.',
    );
  });
});
