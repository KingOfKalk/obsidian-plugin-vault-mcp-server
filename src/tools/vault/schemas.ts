import { z } from 'zod';
import { base64Schema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { responseFormatField } from '../shared/response';
import { frontmatterKeySchema } from '../shared/frontmatter';
import {
  ENTRY_PATH_DESC,
  EXPECTED_MTIME_DESC,
  FILE_PATH_DESC,
  FOLDER_PATH_DESC,
  vaultPathField,
} from '../shared/descriptions';

const path = vaultPathField(FILE_PATH_DESC);

/**
 * Parse an `expectedMtime` value into epoch milliseconds: an ISO-8601
 * timestamp (the `modified` field of a read or write result) or a
 * string of digits (epoch milliseconds). Returns NaN when it is neither.
 */
export function parseExpectedMtime(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  return Date.parse(value);
}

/**
 * Optional optimistic-concurrency guard shared by the write tools (#406).
 * The handler compares it with the file's current mtime and refuses to
 * write when they differ.
 */
const expectedMtime = z
  .string()
  .max(64)
  .refine(
    (value) => !Number.isNaN(parseExpectedMtime(value)),
    'expectedMtime must be an ISO-8601 timestamp or epoch milliseconds',
  )
  .optional()
  .describe(EXPECTED_MTIME_DESC);

export const createFileSchema = {
  path,
  content: z
    .string()
    .max(5_000_000)
    .describe('Initial UTF-8 text content of the new file'),
};

/**
 * Largest window `vault_read` returns in one call, in characters. Kept
 * below CHARACTER_LIMIT so the content plus the "continue at offset=…"
 * footer fits without being cut by the response truncation.
 */
export const READ_MAX_LENGTH = 24_000;

/**
 * A heading to address a section by (#428): its text without the `#`
 * marks, or with them to pin the level.
 */
const heading = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.trim().length > 0, 'heading must not be blank');

export const readFileSchema = {
  path,
  heading: heading
    .optional()
    .describe(
      'Optional: return only this section — the heading line up to the next heading of the same or a higher level. ' +
        'Heading text without the # marks (e.g. "Log"), or with them to pin the level (e.g. "## Log"). ' +
        'offset/length then page within the section.',
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      'Character offset to start reading at (default 0). Use nextOffset from the previous call to continue a large file.',
    ),
  length: z
    .number()
    .int()
    .min(1)
    .max(READ_MAX_LENGTH)
    .optional()
    .describe(
      `Maximum characters to return (1..${String(READ_MAX_LENGTH)}, default ${String(READ_MAX_LENGTH)}). Files that fit are returned whole.`,
    ),
  ...responseFormatField,
};

export const updateFileSchema = {
  path,
  content: z
    .string()
    .max(5_000_000)
    .describe('Replacement content for the file'),
  expectedMtime,
};

export const deleteFileSchema = {
  path,
};

export const appendFileSchema = {
  path,
  content: z
    .string()
    .min(1)
    .max(5_000_000)
    .describe('Content to append to the end of the file'),
  expectedMtime,
};

/** Most edits one `vault_replace` call may carry (#429). */
export const MAX_REPLACE_EDITS = 100;

const replaceOldString = z.string().min(1).max(5_000_000);
const replaceNewString = z.string().max(5_000_000);

/**
 * One entry of `vault_replace`'s `edits` array (#429). Strict, so a typo
 * such as `old_string` inside an edit is rejected instead of ignored.
 */
const replaceEdit = z.strictObject({
  oldString: replaceOldString.describe(
    'Exact text to find (literal, case-sensitive, no regex). Must occur exactly once unless replaceAll is true.',
  ),
  newString: replaceNewString.describe(
    'Replacement text (literal; may be empty to delete oldString).',
  ),
  replaceAll: z
    .boolean()
    .default(false)
    .describe("Replace every occurrence of this edit's oldString (default false)."),
});

/**
 * Input schema for `vault_replace`. Takes either the single-edit form
 * (`oldString` + `newString`) or `edits` (#429). A raw shape cannot
 * express "exactly one of", so the handler enforces it.
 */
export const replaceInFileSchema = {
  path,
  oldString: replaceOldString
    .optional()
    .describe(
      'Single-edit form: exact text to find (literal, case-sensitive, no regex). ' +
        'Must occur exactly once unless replaceAll is true. Give it with newString, or use edits instead.',
    ),
  newString: replaceNewString
    .optional()
    .describe(
      'Single-edit form: replacement text (literal; may be empty to delete oldString). Give it with oldString.',
    ),
  replaceAll: z
    .boolean()
    .default(false)
    .describe(
      'Single-edit form: replace every occurrence instead of requiring exactly one (default false). ' +
        'With edits, set replaceAll on each edit instead.',
    ),
  edits: z
    .array(replaceEdit)
    .min(1)
    .max(MAX_REPLACE_EDITS)
    .optional()
    .describe(
      'Multi-edit form, instead of oldString/newString: up to 100 { oldString, newString, replaceAll? } edits, ' +
        'all or nothing. Every edit is matched against the file as it was before the call (text inserted by one edit ' +
        'is never matched by another), and the matches of different edits must not overlap. ' +
        'If any edit fails, nothing is written.',
    ),
  expectedMtime,
};

export const insertSchema = {
  path,
  heading: heading.describe(
    'Heading of the target section: its text without the # marks (e.g. "Log"), or with them to pin the level (e.g. "## Log"). ' +
      'Must match exactly one heading; headings in code blocks and frontmatter are ignored.',
  ),
  position: z
    .enum(['start', 'end'])
    .default('end')
    .describe(
      '"end" (default): after the last non-blank line of the section, nested subsections included. ' +
        '"start": before the first non-blank line below the heading (blank lines after the heading stay above the text; ' +
        'in an empty section, right below the heading).',
    ),
  text: z
    .string()
    .min(1)
    .max(5_000_000)
    .describe(
      'Text to insert as whole lines; one trailing newline is ignored. Start it with a newline to leave a blank line before it.',
    ),
  expectedMtime,
};

export const getMetadataSchema = {
  path,
  ...responseFormatField,
};

export const renameFileSchema = {
  path: vaultPathField(ENTRY_PATH_DESC),
  newName: z
    .string()
    .min(1)
    .max(255)
    .regex(
      /^[^/\\\x00]+$/,
      'newName must not contain path separators or null bytes',
    )
    .describe(
      'New name for the last path segment, extension included (e.g. "final.md", not "final"); the folder stays the same. No / or \\.',
    ),
};

export const moveFileSchema = {
  path: vaultPathField(ENTRY_PATH_DESC),
  newPath: vaultPathField(ENTRY_PATH_DESC),
};

export const copyFileSchema = {
  sourcePath: vaultPathField(FILE_PATH_DESC),
  destPath: vaultPathField(FILE_PATH_DESC),
};

export const createFolderSchema = {
  path: vaultPathField(FOLDER_PATH_DESC),
};

export const deleteFolderSchema = {
  path: vaultPathField(FOLDER_PATH_DESC),
  recursive: z
    .boolean()
    .default(false)
    .describe('Also delete everything inside (default false: only an empty folder is deleted).'),
};

export const renameFolderSchema = {
  path: vaultPathField(FOLDER_PATH_DESC),
  newPath: vaultPathField(FOLDER_PATH_DESC),
};

/**
 * Folder path for the listing tools. Unlike `folderPath` it may be empty:
 * `""`, `"/"` and `"."` all mean the vault root (#388).
 */
const listFolderPath = z.string().max(4096);

export const listFolderSchema = {
  path: listFolderPath.describe(
    'Vault-relative folder path to list (non-recursive), e.g. "projects". Use "" (or "/" or ".") for the vault root.',
  ),
  ...responseFormatField,
};

export const listRecursiveSchema = {
  path: listFolderPath.describe(
    'Vault-relative folder path to list recursively, e.g. "projects". Use "" (or "/" or ".") for the vault root.',
  ),
  ...paginationFields,
  ...responseFormatField,
};

export const readBinarySchema = {
  path,
  ...responseFormatField,
};

export const writeBinarySchema = {
  path,
  data: base64Schema
    .refine((val) => val.length > 0, 'Base64 content must not be empty')
    .describe(
      'Standard base64 (A-Z a-z 0-9 + /, = padding) on one line: no whitespace or line breaks, no data: prefix, no base64url.',
    ),
  expectedMtime,
};

/**
 * Input schema for `vault_get_aspect`. Replaces six former `vault_get_*`
 * single-path getters with one tool that takes a required `aspect` enum.
 * The enum's `.describe()` carries the per-aspect documentation that used
 * to live in each tool's prose description, so Claude reads it on every
 * tool-list refresh.
 */
export const getAspectSchema = {
  path,
  aspect: z
    .enum([
      'frontmatter',
      'headings',
      'outgoing_links',
      'embeds',
      'backlinks',
      'block_references',
    ])
    .describe(
      'Which metadata aspect to return: frontmatter, headings, outgoing_links ([[...]] and [text](note.md) links), ' +
        'embeds (![[...]]), backlinks (files linking TO this file) or block_references (^block-ids). ' +
        'The result carries the matching field (frontmatter, headings, links, embeds, backlinks or blockRefs).',
    ),
  includeContext: z
    .boolean()
    .optional()
    .describe(
      'aspect=backlinks only (default false): also return backlinkContext — for each linking file, ' +
        'the 1-based line number and text of every line that links here. Ignored for other aspects.',
    ),
  ...responseFormatField,
};

/**
 * Input schema for `vault_daily_note`. Optional ISO date; omitted means
 * "today" in local time, mirroring the Obsidian daily-notes plugin's own
 * "today" behaviour. The regex rejects obvious garbage; the handler does
 * a strict moment parse to also reject out-of-calendar dates like
 * "2026-13-40".
 */
export const dailyNoteSchema = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional()
    .describe('Optional ISO date (YYYY-MM-DD). Omit for today (local time).'),
  create: z
    .boolean()
    .optional()
    .describe(
      'Create the note from the template when it is missing (default false). ' +
        'Without create=true the tool only looks the note up: a missing note returns exists=false and nothing is created.',
    ),
  ...responseFormatField,
};


/**
 * Input schema for `vault_set_frontmatter` (#407). `set` values are
 * free-form JSON (string, number, boolean, null, array or object), so they
 * are typed as `unknown`; Obsidian serialises them to YAML.
 */
export const setFrontmatterSchema = {
  path,
  set: z
    .record(frontmatterKeySchema, z.unknown())
    .describe(
      'Frontmatter keys to set, mapped to JSON-compatible values (string, number, boolean, null, array or object). ' +
        'Existing keys are overwritten; keys not listed are left untouched. Pass {} to only remove keys.',
    ),
  remove: z
    .array(frontmatterKeySchema)
    .max(1000)
    .optional()
    .describe('Frontmatter keys to delete. Keys that are not present are ignored.'),
  expectedMtime,
};
