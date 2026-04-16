import { z } from 'zod';

export const filePathSchema = z
  .string()
  .min(1, 'File path must not be empty')
  .refine((val) => !val.includes('\0'), 'File path must not contain null bytes')
  .refine((val) => !val.includes('\\'), 'File path must not contain backslashes');

export const folderPathSchema = z
  .string()
  .min(1, 'Folder path must not be empty')
  .refine((val) => !val.includes('\0'), 'Folder path must not contain null bytes')
  .refine((val) => !val.includes('\\'), 'Folder path must not contain backslashes');

export const lineNumberSchema = z.number().int().min(0, 'Line number must be non-negative');

export const columnNumberSchema = z.number().int().min(0, 'Column number must be non-negative');

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
