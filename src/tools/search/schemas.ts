import { z } from 'zod';
import { searchQuerySchema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { responseFormatField } from '../shared/response';
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
      'Tag with or without the leading # (e.g. "project"). "project" does not find "Project" or nested "project/alpha".',
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
      'Value to match exactly, compared as text (5 matches "5", true matches "true"); for a list, any element may match. Omit to match every note with the key.',
    ),
  ...paginationFields,
  ...responseFormatField,
};
