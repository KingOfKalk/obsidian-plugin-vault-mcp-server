import { z } from 'zod';
import { searchQuerySchema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { responseFormatField } from '../shared/response';

export const searchFulltextSchema = {
  query: searchQuerySchema.describe('Case-insensitive substring to search for across file contents'),
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
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('File path relative to vault root'),
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
    .describe('Tag to search for, with or without leading # (e.g. "project" or "#project")'),
  ...paginationFields,
  ...responseFormatField,
};

export const searchByFrontmatterSchema = {
  key: z
    .string()
    .min(1)
    .max(200)
    .describe('Frontmatter property key to match'),
  value: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'Value to match exactly (compared as stringified). For a list property, a file matches if any element equals the value. Omit to match every file that has the key.',
    ),
  ...paginationFields,
  ...responseFormatField,
};
