import { z } from 'zod';
import { base64Schema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { responseFormatField } from '../shared/response';

const path = z
  .string()
  .min(1)
  .max(4096)
  .describe('File path relative to vault root (POSIX-style, no leading slash)');

const folderPath = z
  .string()
  .min(1)
  .max(4096)
  .describe('Folder path relative to vault root');

/**
 * Parse an `expectedMtime` value into epoch milliseconds: an ISO-8601
 * timestamp (the `modified` field of vault_read / vault_get_metadata) or a
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
  .describe(
    'Optional conflict check: the `modified` value from vault_read or vault_get_metadata ' +
      '(ISO-8601, or epoch milliseconds). If the file was modified since, nothing is written ' +
      'and the error reports the current mtime.',
  );

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

export const readFileSchema = {
  path,
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

export const replaceInFileSchema = {
  path,
  oldString: z
    .string()
    .min(1)
    .max(5_000_000)
    .describe(
      'Exact text to find (literal, case-sensitive, no regex). Must occur exactly once unless replaceAll is true.',
    ),
  newString: z
    .string()
    .max(5_000_000)
    .describe('Replacement text (literal; may be empty to delete oldString).'),
  replaceAll: z
    .boolean()
    .default(false)
    .describe('Replace every occurrence instead of requiring exactly one (default false).'),
  expectedMtime,
};

export const getMetadataSchema = {
  path,
  ...responseFormatField,
};

export const renameFileSchema = {
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('Current file path to rename'),
  newName: z
    .string()
    .min(1)
    .max(255)
    .regex(
      /^[^/\\\x00]+$/,
      'newName must not contain path separators or null bytes',
    )
    .describe('New file name (basename) within the same folder; must not contain / or \\'),
};

export const moveFileSchema = {
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('Current file path'),
  newPath: z
    .string()
    .min(1)
    .max(4096)
    .describe('New file path (different folder)'),
};

export const copyFileSchema = {
  sourcePath: z
    .string()
    .min(1)
    .max(4096)
    .describe('Source file path'),
  destPath: z
    .string()
    .min(1)
    .max(4096)
    .describe('Destination file path'),
};

export const createFolderSchema = {
  path: folderPath.describe('Folder path to create'),
};

export const deleteFolderSchema = {
  path: folderPath.describe('Folder path to delete'),
  recursive: z
    .boolean()
    .default(false)
    .describe('Delete non-empty folders recursively'),
};

export const renameFolderSchema = {
  path: folderPath.describe('Current folder path'),
  newPath: folderPath.describe('New folder path'),
};

/**
 * Folder path for the listing tools. Unlike `folderPath` it may be empty:
 * `""`, `"/"` and `"."` all mean the vault root (#388).
 */
const listFolderPath = z.string().max(4096);

export const listFolderSchema = {
  path: listFolderPath.describe(
    'Folder path to list (non-recursive). Use "" (or "/" or ".") for the vault root.',
  ),
  ...responseFormatField,
};

export const listRecursiveSchema = {
  path: listFolderPath.describe(
    'Folder path to list recursively. Use "" (or "/" or ".") for the vault root.',
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
    .describe('Base64-encoded binary content (no leading data: prefix)'),
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
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('Vault-relative path to the file.'),
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
      'Which metadata aspect to return: frontmatter, headings, outgoing_links ([[...]] links), ' +
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
      'Create the note from the template when it is missing (default true). ' +
        'Set false to only look the note up: a missing note then returns exists=false and nothing is created.',
    ),
  ...responseFormatField,
};

const frontmatterKey = z.string().min(1).max(1024);

/**
 * Input schema for `vault_set_frontmatter` (#407). `set` values are
 * free-form JSON (string, number, boolean, null, array or object), so they
 * are typed as `unknown`; Obsidian serialises them to YAML.
 */
export const setFrontmatterSchema = {
  path,
  set: z
    .record(frontmatterKey, z.unknown())
    .describe(
      'Frontmatter keys to set, mapped to JSON-compatible values (string, number, boolean, null, array or object). ' +
        'Existing keys are overwritten; keys not listed are left untouched. Pass {} to only remove keys.',
    ),
  remove: z
    .array(frontmatterKey)
    .max(1000)
    .optional()
    .describe('Frontmatter keys to delete. Keys that are not present are ignored.'),
};
