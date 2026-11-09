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
