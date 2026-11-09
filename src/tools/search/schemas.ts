import { z } from 'zod';
import { searchQuerySchema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { responseFormatField } from '../shared/response';
import { FILE_PATH_DESC, vaultPathField } from '../shared/descriptions';

export const searchFulltextSchema = {
  query: searchQuerySchema.describe('Case-insensitive substring to find in the text of Markdown notes'),
  maxMatchesPerFile: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(5)
    .describe(
      'Maximum matching lines returned per file (1..100, default 5). matchCount always reports the full count.',
    ),
  ...paginationFields,
  ...responseFormatField,
};

export const filePathSchema = {
  path: vaultPathField(FILE_PATH_DESC),
  ...responseFormatField,
};

export const readOnlySchema = {
  ...responseFormatField,
};

export const searchByTagSchema = {
  tag: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Tag with or without the leading # (e.g. "project"). Exact, case-sensitive match: "project" does not find ' +
        '"Project" or nested "project/alpha"; use search_tags for the exact spellings.',
    ),
  ...paginationFields,
  ...responseFormatField,
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
      'Value to match exactly, compared as text (the number 5 matches "5", the boolean true matches "true"). For a list property, a file matches if any element equals the value. Omit to match every file that has the key.',
    ),
  ...paginationFields,
  ...responseFormatField,
};
