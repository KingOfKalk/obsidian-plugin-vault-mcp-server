import { z } from 'zod';

/**
 * Shared Zod fragments for vault-relative paths. Paths are non-empty, capped
 * at 4096 characters, forbid null bytes, and forbid backslashes (which would
 * bypass the POSIX-normalising `validateVaultPath`).
 */
export const filePathSchema = z
  .string()
  .min(1, 'File path must not be empty')
  .max(4096, 'File path too long')
  .refine((val) => !val.includes('\0'), 'File path must not contain null bytes')
  .refine((val) => !val.includes('\\'), 'File path must not contain backslashes');

export const folderPathSchema = z
  .string()
  .min(1, 'Folder path must not be empty')
  .max(4096, 'Folder path too long')
  .refine((val) => !val.includes('\0'), 'Folder path must not contain null bytes')
  .refine((val) => !val.includes('\\'), 'Folder path must not contain backslashes');

export const lineNumberSchema = z
  .number()
  .int()
  .min(0, 'Line number must be non-negative');

export const columnNumberSchema = z
  .number()
  .int()
  .min(0, 'Column number must be non-negative');

export const positionSchema = z.object({
  line: lineNumberSchema,
  ch: columnNumberSchema,
});

export const rangeSchema = z.object({
  from: positionSchema,
  to: positionSchema,
});

export const paginationSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(10000).default(100),
});

export const contentSchema = z.string();

export const base64Schema = z
  .string()
  .refine(
    (val) => /^[A-Za-z0-9+/]*={0,2}$/.test(val),
    'Invalid base64 string',
  );

/** Free-text query bounded to something a human could plausibly enter. */
export const searchQuerySchema = z
  .string()
  .min(1, 'Query must not be empty')
  .max(500, 'Query too long');

/** Obsidian command id / plugin id — letters, digits, hyphens, colons, dots. */
export const identifierSchema = z
  .string()
  .min(1, 'Identifier must not be empty')
  .max(200, 'Identifier too long');

