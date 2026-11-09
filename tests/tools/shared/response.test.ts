import { describe, it, expect } from 'vitest';
import {
  dataResponse,
  documentResponse,
  documentText,
} from '../../../src/tools/shared/response';

describe('response helpers (#467)', () => {
  describe('dataResponse', () => {
    it('returns structuredContent and the same data as compact JSON text', () => {
      const result = dataResponse({ a: 1, b: 'two', c: [true, null] });
      expect(result.structuredContent).toEqual({ a: 1, b: 'two', c: [true, null] });
      expect(result.content).toHaveLength(1);
      const block = result.content[0];
      expect(block.type).toBe('text');
      const text = block.type === 'text' ? block.text : '';
      expect(text).toBe('{"a":1,"b":"two","c":[true,null]}');
      expect(JSON.parse(text)).toEqual(result.structuredContent);
    });

    it('leaves out undefined fields in both representations alike', () => {
      const result = dataResponse({ a: 1, b: undefined });
      const text = result.content[0].type === 'text' ? result.content[0].text : '';
      expect(JSON.parse(text)).toEqual({ a: 1 });
    });
  });

  describe('documentText', () => {
    it('puts key: value lines, a blank line, then the body', () => {
      expect(documentText({ path: 'a.md', offset: 0, hasMore: false }, '# Title\nbody')).toBe(
        'path: a.md\noffset: 0\nhasMore: false\n\n# Title\nbody',
      );
    });

    it('leaves out undefined fields', () => {
      expect(documentText({ path: 'a.md', nextOffset: undefined }, 'x')).toBe('path: a.md\n\nx');
    });

    it('is just the body without fields', () => {
      expect(documentText({}, '---\ntitle: x\n---\n')).toBe('---\ntitle: x\n---\n');
    });

    it('replaces line breaks inside values so the first blank line ends the header', () => {
      expect(documentText({ heading: 'a\nb\r\nc' }, 'body')).toBe('heading: a b c\n\nbody');
    });

    it('never escapes the body', () => {
      const body = 'quote " backslash \\ tab \t newline \n end';
      expect(documentText({ path: 'a.md' }, body).endsWith(`\n\n${body}`)).toBe(true);
    });
  });

  describe('documentResponse', () => {
    it('returns one text block and no structuredContent', () => {
      const result = documentResponse({ path: 'a.md' }, 'hello');
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([{ type: 'text', text: 'path: a.md\n\nhello' }]);
    });
  });
});
