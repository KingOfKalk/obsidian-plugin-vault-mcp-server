import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  handleToolError,
  NotFoundError,
  PermissionError,
  ValidationError,
  TimeoutError,
} from '../../../src/tools/shared/errors';
import { PathTraversalError } from '../../../src/utils/path-guard';

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content[0];
  return item.type === 'text' && item.text !== undefined ? item.text : '';
}

describe('handleToolError', () => {
  it('maps ZodError to Invalid arguments with path/message pairs', () => {
    const schema = z.object({ path: z.string().min(1) });
    let zodErr: z.ZodError | null = null;
    try {
      schema.parse({ path: '' });
    } catch (e) {
      if (e instanceof z.ZodError) zodErr = e;
    }
    expect(zodErr).not.toBeNull();

    const result = handleToolError(zodErr);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Invalid arguments');
    expect(getText(result)).toContain('path');
  });

  it('maps PathTraversalError to the same message with Error: prefix', () => {
    const result = handleToolError(new PathTraversalError('Outside vault'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: Outside vault');
  });

  it('maps NotFoundError to the bare message', () => {
    const result = handleToolError(new NotFoundError('File not found: a.md'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: File not found: a.md');
  });

  it('prefixes PermissionError with "Permission denied:"', () => {
    const result = handleToolError(new PermissionError('read /etc/passwd'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: Permission denied: read /etc/passwd');
  });

  it('passes ValidationError messages straight through', () => {
    const result = handleToolError(new ValidationError('bad shape'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: bad shape');
  });

  it('prefixes TimeoutError with "Operation timed out:"', () => {
    const result = handleToolError(new TimeoutError('search_fulltext'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: Operation timed out: search_fulltext');
  });

  it('falls through to the generic Error branch for plain Errors', () => {
    const result = handleToolError(new Error('plain boom'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: plain boom');
  });

  it('stringifies non-Error values', () => {
    const result = handleToolError('oops');
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: oops');
  });
});
