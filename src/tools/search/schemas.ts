import { z } from 'zod';

export const searchFulltextSchema = {
  query: z.string().min(1).describe('Search query string'),
};

export const filePathSchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
};

export const searchByTagSchema = {
  tag: z.string().min(1).describe('Tag to search for (e.g., #project)'),
};

export const searchByFrontmatterSchema = {
  key: z.string().min(1).describe('Frontmatter property key'),
  value: z.string().describe('Frontmatter property value to match'),
};
