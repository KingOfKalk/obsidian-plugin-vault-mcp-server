import { z } from 'zod';
import { base64Schema } from '../../utils/validation';

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

export const createFileSchema = {
  path,
  content: z
    .string()
    .max(5_000_000)
    .describe('Text content to write into the new file'),
};

export const readFileSchema = {
  path,
};

export const updateFileSchema = {
  path,
  content: z
    .string()
    .max(5_000_000)
    .describe('Replacement content for the file'),
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
};

export const getMetadataSchema = {
  path,
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
    .describe('New file name within the same folder (no separators)'),
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

export const listFolderSchema = {
  path: folderPath.describe('Folder path to list (non-recursive)'),
};

export const listRecursiveSchema = {
  path: folderPath.describe('Folder path to list recursively'),
};

export const readBinarySchema = {
  path,
};

export const writeBinarySchema = {
  path,
  data: base64Schema
    .refine((val) => val.length > 0, 'Base64 content must not be empty')
    .describe('Base64-encoded binary content (no leading data: prefix)'),
};
