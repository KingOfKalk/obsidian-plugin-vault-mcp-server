import { z } from 'zod';
import { base64Schema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { READ_MAX_LENGTH, windowLengthField, windowOffsetField } from '../shared/window';
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
    .describe('Initial UTF-8 text content.'),
};

export { READ_MAX_LENGTH };

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
      'Return only this section: the heading line up to the next heading of the same or a higher level. ' +
        'Text without the # marks (e.g. "Log"), or with them to pin the level ("## Log"); a [[note#heading]] anchor also works. offset/length then page within it.',
    ),
  offset: windowOffsetField,
  length: windowLengthField('Files'),
};

export const updateFileSchema = {
  path,
  content: z
    .string()
    .max(5_000_000)
    .describe('New content of the whole file.'),
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
    .describe('Content to append.'),
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
    'Exact text to find (literal, case-sensitive, no regex); must occur exactly once unless replaceAll.',
  ),
  newString: replaceNewString.describe('Replacement text (literal; empty deletes oldString).'),
  replaceAll: z
    .boolean()
    .default(false)
    .describe("Replace every occurrence of this edit's oldString."),
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
      'Single-edit form: exact text to find (literal, case-sensitive, no regex); must occur exactly once unless replaceAll. ' +
        'Give it with newString.',
    ),
  newString: replaceNewString
    .optional()
    .describe(
      'Single-edit form: replacement text (literal; empty deletes oldString).',
    ),
  replaceAll: z
    .boolean()
    .default(false)
    .describe(
      'Single-edit form: replace every occurrence instead of requiring exactly one. With edits, set it per edit.',
    ),
  edits: z
    .array(replaceEdit)
    .min(1)
    .max(MAX_REPLACE_EDITS)
    .optional()
    .describe(
      'Multi-edit form, instead of oldString/newString; all or nothing. Every edit is matched against the file as it was ' +
        'before the call (text one edit inserts is never matched by another); matches of different edits must not overlap.',
    ),
  expectedMtime,
};

export const insertSchema = {
  path,
  heading: heading.describe(
    'Section heading: text without the # marks (e.g. "Log"), or with them to pin the level ("## Log"); a [[note#heading]] anchor also works. ' +
      'Must match exactly one heading; headings in code blocks and frontmatter are ignored.',
  ),
  position: z
    .enum(['start', 'end'])
    .default('end')
    .describe(
      '"end": after the last non-blank line of the section, nested subsections included. ' +
        '"start": before the first non-blank line below the heading (blank lines after the heading stay above the text; ' +
        'in an empty section, right below the heading).',
    ),
  text: z
    .string()
    .min(1)
    .max(5_000_000)
    .describe(
      'Inserted as whole lines; one trailing newline is ignored. Start it with a newline to leave a blank line before it.',
    ),
  replacePlaceholder: z
    .boolean()
    .default(false)
    .describe(
      'If the section\'s only non-blank line (subsections included) is an empty list item ("-", "*", "+", "1.", "- [ ]"), ' +
        'replace that line with text instead of keeping it; position is then ignored.',
    ),
  expectedMtime,
};

export const getMetadataSchema = {
  path,
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
      'New name of the last path segment, extension included ("final.md", not "final"); the folder stays the same. No / or \\.',
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
    .describe('Also delete everything inside; when false, only an empty folder is deleted.'),
};

/**
 * Folder path for the listing tools. Unlike `folderPath` it may be empty:
 * `""`, `"/"` and `"."` all mean the vault root (#388).
 */
const listFolderPath = z.string().max(4096);

export const listFolderSchema = {
  path: listFolderPath.describe(
    'Vault-relative folder path, e.g. "projects"; "" (or "/" or ".") for the vault root.',
  ),
  ...paginationFields,
};

export const listRecursiveSchema = {
  path: listFolderPath.describe(
    'Vault-relative folder path, e.g. "projects"; "" (or "/" or ".") for the vault root.',
  ),
  ...paginationFields,
};

export const readBinarySchema = {
  path,
};

export const writeBinarySchema = {
  path,
  data: base64Schema
    .refine((val) => val.length > 0, 'Base64 content must not be empty')
    .describe(
      'Standard base64 (A-Z a-z 0-9 + /, = padding) on one line: no whitespace, no data: prefix, no base64url.',
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
      'frontmatter, headings, outgoing_links ([[...]] and [text](note.md) links), embeds (![[...]]), ' +
        'backlinks (files linking TO this file) or block_references (^block-ids). ' +
        'The result sets the matching field: frontmatter, headings, links, embeds, backlinks or blockRefs.',
    ),
  includeContext: z
    .boolean()
    .optional()
    .describe(
      'aspect=backlinks only (default false): also return backlinkContext, the 1-based line number and text ' +
        'of every line in each linking file that links here.',
    ),
  limit: paginationFields.limit.describe(
    'aspect=backlinks only: maximum linking files per page.',
  ),
  offset: paginationFields.offset,
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
    .describe('ISO date (YYYY-MM-DD); omit for today (local time).'),
  create: z
    .boolean()
    .optional()
    .describe(
      'Create the note from the template if missing (default false). Without it, a missing note returns exists: false.',
    ),
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
      'Keys to set, mapped to JSON-compatible values (string, number, boolean, null, array or object). ' +
        'Existing keys are overwritten, others left untouched. Pass {} to only remove keys.',
    ),
  remove: z
    .array(frontmatterKeySchema)
    .max(1000)
    .optional()
    .describe('Keys to delete; absent keys are ignored.'),
  expectedMtime,
};
