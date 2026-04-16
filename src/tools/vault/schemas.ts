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

export const createFolderSchema = {
  path: z.string().min(1).describe('Folder path to create'),
};

export const deleteFolderSchema = {
  path: z.string().min(1).describe('Folder path to delete'),
  recursive: z.boolean().default(false).describe('Delete non-empty folders recursively'),
};

export const renameFolderSchema = {
  path: z.string().min(1).describe('Current folder path'),
  newPath: z.string().min(1).describe('New folder path'),
};

export const listFolderSchema = {
  path: z.string().min(1).describe('Folder path to list'),
};

export const listRecursiveSchema = {
  path: z.string().min(1).describe('Folder path to list recursively'),
};

export const readBinarySchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
};

export const writeBinarySchema = {
  path: z.string().min(1).describe('File path relative to vault root'),
  data: z.string().min(1).describe('Base64-encoded file content'),
};
