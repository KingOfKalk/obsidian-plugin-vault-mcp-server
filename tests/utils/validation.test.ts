import { describe, it, expect } from 'vitest';
import {
  filePathSchema,
  folderPathSchema,
  lineNumberSchema,
  columnNumberSchema,
  positionSchema,
  rangeSchema,
  paginationSchema,
  base64Schema,
} from '../../src/utils/validation';

describe('filePathSchema', () => {
  it('should accept a valid file path', () => {
    expect(filePathSchema.parse('notes/test.md')).toBe('notes/test.md');
  });

  it('should reject an empty string', () => {
    expect(() => filePathSchema.parse('')).toThrow();
  });

  it('should reject a path with null bytes', () => {
    expect(() => filePathSchema.parse('test\0.md')).toThrow();
  });

  it('should reject a path with backslashes', () => {
    expect(() => filePathSchema.parse('notes\\test.md')).toThrow();
  });
});

describe('folderPathSchema', () => {
  it('should accept a valid folder path', () => {
    expect(folderPathSchema.parse('notes/subfolder')).toBe('notes/subfolder');
  });

  it('should reject an empty string', () => {
    expect(() => folderPathSchema.parse('')).toThrow();
  });
});

describe('lineNumberSchema', () => {
  it('should accept zero', () => {
    expect(lineNumberSchema.parse(0)).toBe(0);
  });

  it('should accept positive integers', () => {
    expect(lineNumberSchema.parse(42)).toBe(42);
  });

  it('should reject negative numbers', () => {
    expect(() => lineNumberSchema.parse(-1)).toThrow();
  });

  it('should reject floats', () => {
    expect(() => lineNumberSchema.parse(1.5)).toThrow();
  });
});

describe('columnNumberSchema', () => {
  it('should accept zero', () => {
    expect(columnNumberSchema.parse(0)).toBe(0);
  });

  it('should reject negative numbers', () => {
    expect(() => columnNumberSchema.parse(-1)).toThrow();
  });
});

describe('positionSchema', () => {
  it('should accept a valid position', () => {
    const result = positionSchema.parse({ line: 5, ch: 10 });
    expect(result).toEqual({ line: 5, ch: 10 });
  });

  it('should reject missing line', () => {
    expect(() => positionSchema.parse({ ch: 10 })).toThrow();
  });

  it('should reject missing ch', () => {
    expect(() => positionSchema.parse({ line: 5 })).toThrow();
  });
});

describe('rangeSchema', () => {
  it('should accept a valid range', () => {
    const result = rangeSchema.parse({
      from: { line: 1, ch: 0 },
      to: { line: 5, ch: 10 },
    });
    expect(result.from.line).toBe(1);
    expect(result.to.line).toBe(5);
  });
});

describe('paginationSchema', () => {
  it('should apply defaults', () => {
    const result = paginationSchema.parse({});
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(100);
  });

  it('should accept custom values', () => {
    const result = paginationSchema.parse({ offset: 50, limit: 200 });
    expect(result.offset).toBe(50);
    expect(result.limit).toBe(200);
  });

  it('should reject negative offset', () => {
    expect(() => paginationSchema.parse({ offset: -1 })).toThrow();
  });

  it('should reject limit over 10000', () => {
    expect(() => paginationSchema.parse({ limit: 10001 })).toThrow();
  });
});

describe('base64Schema', () => {
  it('should accept valid base64', () => {
    expect(base64Schema.parse('SGVsbG8=')).toBe('SGVsbG8=');
  });

  it('should accept empty string', () => {
    expect(base64Schema.parse('')).toBe('');
  });

  it('should reject invalid characters', () => {
    expect(() => base64Schema.parse('invalid!@#')).toThrow();
  });
});
