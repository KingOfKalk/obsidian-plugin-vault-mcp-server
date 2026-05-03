import { z } from 'zod';
import { base64Schema } from '../../utils/validation';
import { paginationFields } from '../shared/pagination';
import { responseFormatField } from '../shared/response';

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
  ...responseFormatField,
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
  ...responseFormatField,
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
  ...responseFormatField,
};

export const listRecursiveSchema = {
  path: folderPath.describe('Folder path to list recursively'),
  ...paginationFields,
  ...responseFormatField,
};

export const readBinarySchema = {
  path,
  ...responseFormatField,
};

export const writeBinarySchema = {
  path,
  data: base64Schema
    .refine((val) => val.length > 0, 'Base64 content must not be empty')
    .describe('Base64-encoded binary content (no leading data: prefix)'),
};

/**
 * Input schema for `vault_get_aspect`. Replaces six former `vault_get_*`
 * single-path getters with one tool that takes a required `aspect` enum.
 * The enum's `.describe()` carries the per-aspect documentation that used
 * to live in each tool's prose description, so Claude reads it on every
 * tool-list refresh.
 */
export const getAspectSchema = {
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('Vault-relative path to the file.'),
  aspect: z
    .enum([
      'frontmatter',
      'headings',
      'outgoing_links',
      'embeds',
      'backlinks',
      'block_references',
    ])
    .describe(
      'Which metadata aspect to return. ' +
        '"frontmatter" → parsed YAML frontmatter object, or {} when absent. ' +
        '"headings" → [{ heading, level }] in document order. ' +
        '"outgoing_links" → [{ link, displayText? }] for [[...]] links. ' +
        '"embeds" → [{ link, displayText? }] for ![[...]] embeds. ' +
        '"backlinks" → string[] of vault paths that link TO this file. ' +
        '"block_references" → [{ id, line }] for ^block-ids defined in this file.',
    ),
  ...responseFormatField,
};
