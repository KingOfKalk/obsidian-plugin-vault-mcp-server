import { z } from 'zod';
import { searchQuerySchema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { responseFormatField } from '../shared/response';

export const searchFulltextSchema = {
  query: searchQuerySchema.describe('Case-insensitive substring to search for across file contents'),
  ...paginationFields,
  ...responseFormatField,
};

export const filePathSchema = {
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('File path relative to vault root'),
};

export const searchByTagSchema = {
  tag: z
    .string()
    .min(1)
    .max(200)
    .describe('Tag to search for (with or without leading #)'),
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
    .describe('Frontmatter property value to match exactly (stringified)'),
  ...paginationFields,
  ...responseFormatField,
};
