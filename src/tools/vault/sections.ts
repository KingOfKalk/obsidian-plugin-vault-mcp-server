import { ValidationError } from '../shared/errors';

/**
 * Markdown section helpers shared by `vault_insert` and `vault_read` with
 * `heading` (#428). Only ATX headings (`# …` to `###### …`) count; lines
 * inside fenced code blocks and the YAML frontmatter are ignored.
 */

/** One heading found in a note. `index` is the 0-based line number. */
export interface ParsedHeading {
  index: number;
  level: number;
  text: string;
}

/** A resolved section: heading line `start` up to (not including) line `end`. */
export interface Section {
  heading: ParsedHeading;
  /** 0-based index of the heading line. */
  start: number;
  /** 0-based index of the first line after the section (line count at EOF). */
  end: number;
}

/** Most headings listed in a "not found" error before the list is cut. */
const MAX_LISTED_HEADINGS = 50;

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Split text into lines on `\n`, dropping a trailing `\r` from each. */
export function splitLines(content: string): string[] {
  return content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** Collapse runs of whitespace and trim, for heading comparison. */
function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Characters Obsidian's `stripHeading` replaces with a space (checked in the
 * app code of 1.5.3 and 1.15.0, #515).
 */
const LINK_FORM_STRIP = /[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g;

/**
 * A heading as Obsidian compares it when resolving a `[[note#heading]]`
 * subpath (`resolveSubpath`): `stripHeading` (the characters above become
 * spaces, whitespace runs collapse, trim), then lower-cased.
 */
export function linkFormHeading(text: string): string {
  return text.replace(LINK_FORM_STRIP, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Strip an ATX closing sequence (`## Title ##` -> `Title`). */
function stripClosingHashes(text: string): string {
  if (/^#+$/.test(text)) return '';
  return text.replace(/[ \t]+#+$/, '');
}

/** Index of the first line after the frontmatter block, or 0 if there is none. */
function frontmatterEnd(lines: string[]): number {
  if (lines.length === 0 || lines[0].trimEnd() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (line === '---' || line === '...') return i + 1;
  }
  // An unclosed block is not frontmatter (Obsidian treats it as text).
  return 0;
}

/**
 * All ATX headings of a note in document order, skipping the frontmatter
 * and fenced code blocks (``` or ~~~, closed by a fence of the same
 * character that is at least as long; an unclosed fence runs to EOF).
 */
export function parseHeadings(lines: string[]): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  let fence: { char: string; length: number } | null = null;
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE_OPEN.exec(line);
    if (fence !== null) {
      if (
        fenceMatch !== null &&
        fenceMatch[1][0] === fence.char &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ''
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch !== null) {
      const marker = fenceMatch[1];
      // A backtick fence's info string may not contain backticks.
      if (!(marker[0] === '`' && fenceMatch[2].includes('`'))) {
        fence = { char: marker[0], length: marker.length };
        continue;
      }
    }
    const match = ATX_HEADING.exec(line);
    if (match === null) continue;
    headings.push({
      index: i,
      level: match[1].length,
      text: normalizeHeadingText(stripClosingHashes(match[2] ?? '')),
    });
  }
  return headings;
}

/** Parse a `heading` argument: `Log` (any level) or `## Log` (level 2 only). */
export function parseHeadingQuery(query: string): { level?: number; text: string } {
  const trimmed = query.trim();
  const match = /^(#{1,6})[ \t]+(.*)$/.exec(trimmed);
  if (match === null) return { text: normalizeHeadingText(trimmed) };
  return { level: match[1].length, text: normalizeHeadingText(stripClosingHashes(match[2])) };
}

/** `## Log` — a heading as written, for messages. */
export function formatHeading(heading: ParsedHeading): string {
  return `${'#'.repeat(heading.level)} ${heading.text}`;
}

function describeHeadings(headings: ParsedHeading[]): string {
  const listed = headings
    .slice(0, MAX_LISTED_HEADINGS)
    .map((h) => `line ${String(h.index + 1)} "${formatHeading(h)}"`);
  const rest = headings.length - listed.length;
  return listed.join(', ') + (rest > 0 ? `, … and ${String(rest)} more` : '');
}

/**
 * Find the one section whose heading matches `query`: by its exact text
 * first; if none matches, by Obsidian's link form (`linkFormHeading` of both
 * sides), so the anchor of a `[[note#heading]]` link works too. Obsidian
 * takes the first match; here several matches are an error, as for exact
 * text. A section runs from
 * its heading line up to the next heading of the same or a higher level
 * (fewer `#`), or to the end of the file. Throws a ValidationError that
 * lists the available headings when nothing matches, or the matches with
 * line numbers when more than one does; `suffix` is appended to both.
 */
export function findSection(
  lines: string[],
  query: string,
  path: string,
  suffix = '',
): Section {
  const headings = parseHeadings(lines);
  const wanted = parseHeadingQuery(query);
  const atLevel = (h: ParsedHeading): boolean =>
    wanted.level === undefined || h.level === wanted.level;
  let matches = headings.filter((h) => h.text === wanted.text && atLevel(h));
  if (matches.length === 0) {
    // Obsidian's #heading link form (#515), e.g. "2026-11-10 - Call" for
    // "[[2026-11-10]] - Call"; also takes "#Heading" copied from a link.
    const linkForm = linkFormHeading(wanted.text);
    if (linkForm !== '') {
      matches = headings.filter((h) => linkFormHeading(h.text) === linkForm && atLevel(h));
    }
  }
  if (matches.length === 0) {
    const available =
      headings.length === 0
        ? `${path} has no headings.`
        : `Available headings: ${describeHeadings(headings)}.`;
    throw new ValidationError(
      `Heading not found in ${path}: "${query.trim()}". ${available}${suffix}`,
    );
  }
  if (matches.length > 1) {
    throw new ValidationError(
      `Heading "${query.trim()}" is ambiguous in ${path} (${String(matches.length)} matches): ` +
        `${describeHeadings(matches)}. Add the level (e.g. "${formatHeading(matches[0])}") ` +
        `if the matches differ in level, or rename one of them.${suffix}`,
    );
  }
  const heading = matches[0];
  const next = headings.find((h) => h.index > heading.index && h.level <= heading.level);
  return { heading, start: heading.index, end: next === undefined ? lines.length : next.index };
}

/** Character offset where 0-based line `index` starts in `content`. */
export function lineOffset(content: string, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    const next = content.indexOf('\n', offset);
    if (next === -1) return content.length;
    offset = next + 1;
  }
  return offset;
}

/** The raw text of a section, heading line included, as it is in the file. */
export function sectionText(content: string, section: Section): string {
  return content.slice(lineOffset(content, section.start), lineOffset(content, section.end));
}

/**
 * Insert `text` into a section and return the new content plus the
 * 0-based line where the inserted text starts.
 *
 * - `start`: after the heading line and any blank lines right below it, so
 *   a blank line between heading and body stays there.
 * - `end`: after the last non-blank line of the section, so the blank
 *   lines before the next heading stay there.
 * - An empty section (only blank lines) gets the text right after the
 *   heading line; its blank lines follow the text.
 *
 * The text goes in as whole lines: one trailing newline is dropped and the
 * file's line ending (LF or CRLF) is used.
 */
export function insertIntoSection(
  content: string,
  lines: string[],
  section: Section,
  position: 'start' | 'end',
  text: string,
): { content: string; line: number } {
  const body: number[] = [];
  for (let i = section.start + 1; i < section.end; i++) {
    if (lines[i].trim() !== '') body.push(i);
  }
  let at: number;
  if (body.length === 0) {
    at = section.start + 1;
  } else if (position === 'start') {
    at = body[0];
  } else {
    at = body[body.length - 1] + 1;
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const insertLines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const block = insertLines.join(eol);

  if (at >= lines.length) {
    // After the last line, which has no newline: start a new line.
    return { content: content + eol + block, line: lines.length };
  }
  const offset = lineOffset(content, at);
  return {
    content: content.slice(0, offset) + block + eol + content.slice(offset),
    line: at,
  };
}

const H1_PARTS = /^( {0,3}#[ \t]+)(.*?)((?:[ \t]+#+)?[ \t]*)$/;

/**
 * `vault_rename` with `updateTitle` (#520): if the note's first H1 (after
 * the frontmatter, outside code fences) is `oldTitle`, return the content
 * with that heading's text replaced by `newTitle`; otherwise `null`.
 * Indentation, closing hashes and line endings are kept.
 */
export function replaceTitleHeading(
  content: string,
  oldTitle: string,
  newTitle: string,
): string | null {
  const lines = splitLines(content);
  const h1 = parseHeadings(lines).find((heading) => heading.level === 1);
  if (h1 === undefined || h1.text !== normalizeHeadingText(oldTitle)) return null;
  const match = H1_PARTS.exec(lines[h1.index]);
  if (match === null) return null;
  const raw = content.split('\n');
  const cr = raw[h1.index].endsWith('\r') ? '\r' : '';
  raw[h1.index] = `${match[1]}${newTitle}${match[3]}${cr}`;
  return raw.join('\n');
}
