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

export const renameFileSchema = {
  path: z.string().min(1).describe('Current file path'),
  newName: z.string().min(1).describe('New file name (within the same folder)'),
};

export const moveFileSchema = {
  path: z.string().min(1).describe('Current file path'),
  newPath: z.string().min(1).describe('New file path (different folder)'),
};

export const copyFileSchema = {
  sourcePath: z.string().min(1).describe('Source file path'),
  destPath: z.string().min(1).describe('Destination file path'),
};
