import { ValidationError } from '../shared/errors';

/** One literal edit of `vault_replace`'s multi-edit form (#429). */
export interface ReplaceEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface AppliedEdits {
  /** The content after every edit. */
  content: string;
  /** Occurrences replaced per edit, in the order of `edits`. */
  replacements: number[];
}

interface MatchSpan {
  start: number;
  end: number;
  index: number;
}

/** Start offsets of the non-overlapping occurrences of `needle` (non-empty). */
export function findOccurrences(haystack: string, needle: string): number[] {
  const starts: number[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    starts.push(index);
    index = haystack.indexOf(needle, index + needle.length);
  }
  return starts;
}

function matchLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'match' : 'matches'}`;
}

/**
 * Apply several literal edits to `content`, all or nothing (#429).
 *
 * Every edit is matched against the original `content`, never against the
 * output of an earlier edit, so the counts checked here are exactly the
 * counts replaced. Validation runs first, in this order, and throws a
 * `ValidationError` on the first problem:
 *
 * 1. per edit, in index order: 0 matches, or more than one without
 *    `replaceAll`;
 * 2. overlap: a match of one edit shares a character with a match of
 *    another (matches that only touch are fine).
 *
 * Only then is the new content built, in one pass over the sorted matches.
 */
export function applyReplaceEdits(
  content: string,
  edits: readonly ReplaceEdit[],
  path: string,
): AppliedEdits {
  const spans: MatchSpan[] = [];
  const replacements: number[] = [];

  edits.forEach((edit, index) => {
    const starts = findOccurrences(content, edit.oldString);
    if (starts.length === 0) {
      throw new ValidationError(
        `edits[${String(index)}].oldString not found in ${path} (0 matches). Nothing was written.`,
      );
    }
    if (starts.length > 1 && edit.replaceAll !== true) {
      throw new ValidationError(
        `edits[${String(index)}].oldString is ambiguous in ${path} (${matchLabel(starts.length)}). ` +
          'Include more surrounding text so it matches exactly once, or set replaceAll: true on that edit. ' +
          'Nothing was written.',
      );
    }
    replacements.push(starts.length);
    for (const start of starts) {
      spans.push({ start, end: start + edit.oldString.length, index });
    }
  });

  spans.sort((a, b) => a.start - b.start || a.index - b.index);

  // Track the span reaching furthest right so far: a later span starting
  // before its end overlaps it, even when spans in between do not.
  let furthest: MatchSpan | undefined;
  for (const span of spans) {
    if (furthest && span.start < furthest.end) {
      const [first, second] =
        furthest.index < span.index ? [furthest.index, span.index] : [span.index, furthest.index];
      throw new ValidationError(
        `edits[${String(first)}] and edits[${String(second)}] overlap in ${path} at character ` +
          `${String(span.start)} (edits[${String(first)}]: ${matchLabel(replacements[first])}, ` +
          `edits[${String(second)}]: ${matchLabel(replacements[second])}). ` +
          'Merge them into one edit or make the oldStrings more specific. Nothing was written.',
      );
    }
    if (!furthest || span.end > furthest.end) furthest = span;
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    parts.push(content.slice(cursor, span.start), edits[span.index].newString);
    cursor = span.end;
  }
  parts.push(content.slice(cursor));
  return { content: parts.join(''), replacements };
}
