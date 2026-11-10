import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  expandPlaceholders,
  formatLocalDate,
  formatLocalTime,
  noteTitle,
} from '../../../src/tools/shared/placeholders';

// 2026-03-14T23:30:00Z is already 2026-03-15 in Tokyo and still 03-14 in
// Los Angeles, so the expected values prove the local time zone is used.
const INSTANT = new Date('2026-03-14T23:30:00Z');

describe('expandPlaceholders', () => {
  let previousTz: string | undefined;

  beforeEach(() => {
    previousTz = process.env.TZ;
  });

  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
    vi.useRealTimers();
  });

  it('formats {{date}} and {{time}} in local time with fixed formats (#470)', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(expandPlaceholders('{{date}} {{time}}', {}, { now: INSTANT })).toBe('2026-03-15 08:30');
    process.env.TZ = 'America/Los_Angeles';
    expect(expandPlaceholders('{{date}} {{time}}', {}, { now: INSTANT })).toBe('2026-03-14 16:30');
  });

  it('pads single-digit months, days, hours and minutes', () => {
    process.env.TZ = 'UTC';
    const now = new Date('2026-01-02T03:04:05Z');
    expect(formatLocalDate(now)).toBe('2026-01-02');
    expect(formatLocalTime(now)).toBe('03:04');
  });

  it('uses the current time when no moment is given', () => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T09:10:00Z'));
    expect(expandPlaceholders('{{date}} {{time}}', {})).toBe('2026-07-08 09:10');
  });

  it('fills {{title}} from the context and leaves it as written without one (#470)', () => {
    expect(expandPlaceholders('# {{title}}', {}, { title: 'Meeting' })).toBe('# Meeting');
    expect(expandPlaceholders('# {{title}}', {}, { now: INSTANT })).toBe('# {{title}}');
  });

  it('user-provided variables override built-ins', () => {
    const out = expandPlaceholders(
      '{{date}} {{time}} {{title}} {{custom}}',
      { date: '2026-05-05', time: 'noon', title: 'Hello', custom: 'World' },
      { now: INSTANT, title: 'file' },
    );
    expect(out).toBe('2026-05-05 noon Hello World');
  });

  it('leaves placeholders for unknown keys untouched', () => {
    const out = expandPlaceholders('{{foo}} {{bar}}', { foo: 'x' });
    expect(out).toBe('x {{bar}}');
  });

  it('replaces every occurrence of a key', () => {
    const out = expandPlaceholders('{{a}}{{a}}{{a}}', { a: 'x' });
    expect(out).toBe('xxx');
  });

  it('leaves the body unchanged when there are no placeholders', () => {
    const out = expandPlaceholders('plain text', {});
    expect(out).toBe('plain text');
  });

  it('matches placeholder keys literally (regex metacharacters do not break matching)', () => {
    // The Zod schema upstream allows arbitrary string keys. A naive
    // RegExp-based substitution would throw on '{{foo(}}' or silently
    // mismatch on '{{a.b}}'. The split/join implementation matches
    // literally, so both work.
    expect(expandPlaceholders('{{a.b}} {{a.b}}', { 'a.b': 'x' })).toBe('x x');
    expect(expandPlaceholders('start {{foo(}} end', { 'foo(': 'X' })).toBe('start X end');
  });

  describe('{{date:FORMAT}} and {{time:FORMAT}} (#488)', () => {
    // 2099-01-01 is a Thursday. 14:05:09 local time in UTC.
    const THURSDAY = new Date('2099-01-01T14:05:09Z');

    beforeEach(() => {
      process.env.TZ = 'UTC';
    });

    it('formats the reference moment with moment.js formats', () => {
      expect(
        expandPlaceholders('# {{date:dddd}}, {{date:YYYY-MM-DD}}', {}, { now: THURSDAY }),
      ).toBe('# Thursday, 2099-01-01');
      expect(expandPlaceholders('{{date:D MMMM YYYY}}', {}, { now: THURSDAY })).toBe('1 January 2099');
      expect(expandPlaceholders('{{date:[Week] W}}', {}, { now: THURSDAY })).toBe('Week 1');
      expect(expandPlaceholders('{{time:HH:mm:ss}}', {}, { now: THURSDAY })).toBe('14:05:09');
      expect(expandPlaceholders('{{time:h:mm A}}', {}, { now: THURSDAY })).toBe('2:05 PM');
    });

    it('uses the text after the first colon, trimmed, as the format', () => {
      expect(expandPlaceholders('{{date: YYYY }}', {}, { now: THURSDAY })).toBe('2099');
      expect(expandPlaceholders('{{time:HH:mm}}', {}, { now: THURSDAY })).toBe('14:05');
    });

    it('falls back to the plain formats for an empty format', () => {
      expect(expandPlaceholders('{{date:}} {{time:  }}', {}, { now: THURSDAY })).toBe('2099-01-01 14:05');
    });

    it('formats in the local time zone', () => {
      process.env.TZ = 'Asia/Tokyo';
      expect(expandPlaceholders('{{date:dddd YYYY-MM-DD}} {{time:HH:mm}}', {}, { now: INSTANT }))
        .toBe('Sunday 2026-03-15 08:30');
    });

    it('lets a variable with the same full key override the formatted value', () => {
      const out = expandPlaceholders(
        '{{date:dddd}} {{date:YYYY}}',
        { 'date:dddd': 'Someday' },
        { now: THURSDAY },
      );
      expect(out).toBe('Someday 2099');
    });

    it('a plain date variable does not affect the format variants', () => {
      expect(expandPlaceholders('{{date}} {{date:YYYY}}', { date: 'x' }, { now: THURSDAY })).toBe('x 2099');
    });

    it('leaves other colon placeholders and unclosed tokens as written', () => {
      expect(expandPlaceholders('{{foo:bar}} {{date:YYYY', {}, { now: THURSDAY })).toBe('{{foo:bar}} {{date:YYYY');
    });

    it('does not span lines', () => {
      expect(expandPlaceholders('{{date:\n}}', {}, { now: THURSDAY })).toBe('{{date:\n}}');
    });
  });

  it('returns an empty string when given an empty body', () => {
    expect(expandPlaceholders('', { a: 'x' })).toBe('');
  });
});

describe('noteTitle', () => {
  it('is the file name without .md', () => {
    expect(noteTitle('notes/2026/Meeting notes.md')).toBe('Meeting notes');
    expect(noteTitle('Top.MD')).toBe('Top');
    expect(noteTitle('data/report.csv')).toBe('report.csv');
    expect(noteTitle('a.b.md')).toBe('a.b');
  });
});
