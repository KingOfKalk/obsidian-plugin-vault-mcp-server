import { z } from 'zod';

export const createFileSchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
  content: z.string().describe('File content'),
};

export const readFileSchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
};

export const updateFileSchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
  content: z.string().describe('New file content'),
};

export const deleteFileSchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
};

export const appendFileSchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
  content: z.string().describe('Content to append'),
};

export const getMetadataSchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
};
