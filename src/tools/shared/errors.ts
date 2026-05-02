import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PathTraversalError } from '../../utils/path-guard';

/**
 * Typed error classes the adapter / handlers can throw to signal a particular
 * failure category. The shared `handleToolError()` helper maps each class to
 * a consistent MCP error response shape.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * The vault path resolves to nothing — there is no file or folder there.
 * Use `FolderNotFoundError` / `FileNotFoundError` when the type is known.
 */
export class FolderNotFoundError extends NotFoundError {
  constructor(path: string) {
    super(`Folder not found: ${path}`);
    this.name = 'FolderNotFoundError';
  }
}

export class FileNotFoundError extends NotFoundError {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Map any caught value to a well-formed CallToolResult with `isError: true`.
 * Callers can use this as a single `catch` target so they don't need to
 * maintain their own per-module `errorResult()` helper.
 */
export function handleToolError(error: unknown): CallToolResult {
  if (error instanceof z.ZodError) {
    const details = error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    return errorFrom(`Invalid arguments: ${details}`);
  }
  if (error instanceof PathTraversalError) {
    return errorFrom(error.message);
  }
  if (error instanceof NotFoundError) {
    return errorFrom(error.message);
  }
  if (error instanceof PermissionError) {
    return errorFrom(`Permission denied: ${error.message}`);
  }
  if (error instanceof ValidationError) {
    return errorFrom(error.message);
  }
  if (error instanceof TimeoutError) {
    return errorFrom(`Operation timed out: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorFrom(message);
}

function errorFrom(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
