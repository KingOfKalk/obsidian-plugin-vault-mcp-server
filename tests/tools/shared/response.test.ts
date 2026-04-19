import { describe, it, expect } from 'vitest';
import {
  makeResponse,
  readResponseFormat,
  toStructuredContent,
} from '../../../src/tools/shared/response';

describe('response helper', () => {
  it('renders markdown by default and attaches structuredContent', () => {
    const result = makeResponse(
      { a: 1, b: 'two' },
      (v) => `a=${String(v.a)}, b=${v.b}`,
    );
    expect(result.content[0].type).toBe('text');
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toBe('a=1, b=two');
    expect(result.structuredContent).toEqual({ a: 1, b: 'two' });
  });

  it('renders JSON when format is "json"', () => {
    const result = makeResponse(
      { a: 1, b: 'two' },
      (v) => `a=${String(v.a)}, b=${v.b}`,
      'json',
    );
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(JSON.parse(text)).toEqual({ a: 1, b: 'two' });
  });

  it('toStructuredContent wraps arrays in { items }', () => {
    expect(toStructuredContent([1, 2, 3])).toEqual({ items: [1, 2, 3] });
  });

  it('toStructuredContent wraps scalars in { value }', () => {
    expect(toStructuredContent('hi')).toEqual({ value: 'hi' });
  });

  it('toStructuredContent passes plain objects through', () => {
    expect(toStructuredContent({ a: 1 })).toEqual({ a: 1 });
  });

  it('readResponseFormat defaults to markdown for missing or unknown values', () => {
    expect(readResponseFormat({})).toBe('markdown');
    expect(readResponseFormat({ response_format: 'xml' })).toBe('markdown');
  });

  it('readResponseFormat returns json when requested', () => {
    expect(readResponseFormat({ response_format: 'json' })).toBe('json');
  });
});
