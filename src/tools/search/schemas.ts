import { z } from 'zod';
import { searchQuerySchema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { FILE_PATH_DESC, vaultPathField } from '../shared/descriptions';

export const searchFulltextSchema = {
  query: searchQuerySchema.describe('Case-insensitive substring to find.'),
  maxMatchesPerFile: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(5)
    .describe(
      'Maximum matching lines returned per file; matchCount always reports the full count.',
    ),
  lastMatches: z
    .boolean()
    .default(false)
    .describe('Return the last maxMatchesPerFile matches of each file instead of the first (e.g. newest rows of a log).'),
  folder: z
    .string()
    .max(4096)
    .optional()
    .describe('Only notes in this folder and its subfolders, e.g. "projects". Omit for the whole vault.'),
  ...paginationFields,
};

export const filePathSchema = {
  path: vaultPathField(FILE_PATH_DESC),
};

/** `search_tags`: counts per tag, paged (#468). */
export const searchTagsSchema = {
  ...paginationFields,
};

/** `search_resolved_links` / `search_unresolved_links` (#464). */
export const linksMapSchema = {
  path: vaultPathField(FILE_PATH_DESC)
    .optional()
    .describe('Only this note\'s links. Omit for the whole vault.'),
  ...paginationFields,
};

/** `search_unresolved_links`: the link map, or grouped by target (#505). */
export const unresolvedLinksSchema = {
  path: linksMapSchema.path,
  groupBy: z
    .enum(['source', 'target'])
    .default('source')
    .describe('"target": one item per missing link target with its total count, most linked first.'),
  limit: linksMapSchema.limit,
  offset: linksMapSchema.offset,
};

export const searchByTagSchema = {
  tag: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Tag with or without the leading # (e.g. "project" also finds "#Project" and "#project/alpha").',
    ),
  ...paginationFields,
};

export const searchByFrontmatterSchema = {
  key: z
    .string()
    .min(1)
    .max(200)
    .describe('Top-level frontmatter key (exact, case-sensitive).'),
  value: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'Value to match, compared as text, case-sensitive (5 matches "5", true matches "true"); for a list, any element may match. Omit to match every note with the key.',
    ),
  match: z
    .enum(['exact', 'prefix'])
    .default('exact')
    .describe(
      'With value: "prefix" matches text starting with value (e.g. "2025-07"); objects and null never match.',
    ),
  ...paginationFields,
};

/** `search_by_name` (#491). */
export const searchByNameSchema = {
  query: searchQuerySchema.describe(
    'Case-insensitive substring of the path, or a glob with * and ?: ' +
      'without / it matches the file name (e.g. "*Atlas*.md"), with / the whole path (e.g. "notes/**/*.pdf").',
  ),
  folder: z
    .string()
    .max(4096)
    .optional()
    .describe('Only files in this folder and its subfolders, e.g. "projects". Omit for the whole vault.'),
  ...paginationFields,
};
