import { describe, it, expect } from 'vitest';
import { expandPlaceholders } from '../../../src/tools/shared/placeholders';

describe('expandPlaceholders', () => {
  it('substitutes built-in date/time/title from a Date', () => {
    const out = expandPlaceholders(
      '# {{title}}\n\nDate: {{date}}\nTime: {{time}}',
      {},
      new Date('2026-03-14T15:09:26Z'),
    );
    // We don't pin the exact local time format (it's locale-sensitive); we
    // pin the date and the title fallback.
    expect(out).toContain('Date: 2026-03-14');
    expect(out).toContain('# Untitled');
    expect(out).toMatch(/Time: \S+/);
  });

  it('user-provided variables override built-ins', () => {
    const out = expandPlaceholders(
      '{{date}} {{title}} {{custom}}',
      { date: '2026-05-05', title: 'Hello', custom: 'World' },
      new Date('2026-03-14T15:09:26Z'),
    );
    expect(out).toBe('2026-05-05 Hello World');
  });

  it('leaves placeholders for unknown keys untouched', () => {
    const out = expandPlaceholders('{{foo}} {{bar}}', { foo: 'x' }, new Date());
    expect(out).toBe('x {{bar}}');
  });

  it('replaces every occurrence of a key', () => {
    const out = expandPlaceholders('{{a}}{{a}}{{a}}', { a: 'x' }, new Date());
    expect(out).toBe('xxx');
  });

  it('leaves the body unchanged when there are no placeholders', () => {
    const out = expandPlaceholders('plain text', {}, new Date());
    expect(out).toBe('plain text');
  });

  it('matches placeholder keys literally (regex metacharacters do not break matching)', () => {
    // The Zod schema upstream allows arbitrary string keys. A naive
    // RegExp-based substitution would throw on '{{foo(}}' or silently
    // mismatch on '{{a.b}}'. The split/join implementation matches
    // literally, so both work.
    expect(expandPlaceholders('{{a.b}} {{a.b}}', { 'a.b': 'x' }, new Date())).toBe('x x');
    expect(
      expandPlaceholders('start {{foo(}} end', { 'foo(': 'X' }, new Date()),
    ).toBe('start X end');
  });

  it('returns an empty string when given an empty body', () => {
    expect(expandPlaceholders('', { a: 'x' }, new Date())).toBe('');
  });
});
