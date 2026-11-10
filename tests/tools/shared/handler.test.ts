import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { caughtError, safeHandler, safeHandlers } from '../../../src/tools/shared/handler';
import { NotFoundError, errorResult, handleToolError } from '../../../src/tools/shared/errors';
import { textOf } from '../../helpers/result';

const ok: CallToolResult = { content: [{ type: 'text', text: 'ok' }] };

describe('safeHandler', () => {
  it('returns a sync result as a promise', async () => {
    const handler = safeHandler(() => ok);
    await expect(handler()).resolves.toBe(ok);
  });

  it('returns an async result unchanged', async () => {
    const handler = safeHandler(() => Promise.resolve(ok));
    await expect(handler()).resolves.toBe(ok);
  });

  it('passes the arguments through', async () => {
    const handler = safeHandler((params: { name: string }, extra?: number) => ({
      content: [{ type: 'text' as const, text: `${params.name}:${String(extra)}` }],
    }));
    expect(textOf(await handler({ name: 'a' }, 2))).toBe('a:2');
  });

  it('turns a sync throw into an error result', async () => {
    const handler = safeHandler((): CallToolResult => {
      throw new NotFoundError('File not found: a.md');
    });
    const result = await handler();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error: File not found: a.md');
  });

  it('turns a rejection into an error result', async () => {
    const handler = safeHandler(() => Promise.reject(new Error('boom')));
    const result = await handler();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error: boom');
  });
});

describe('caughtError (#540)', () => {
  it('returns the error a wrapped handler threw', async () => {
    const error = new TypeError('x is undefined');
    const result = await safeHandler((): CallToolResult => {
      throw error;
    })();
    expect(caughtError(result)).toEqual({ error });
  });

  it('keeps the client-visible result identical to handleToolError', async () => {
    const error = new Error('boom');
    const result = await safeHandler(() => Promise.reject(error))();
    expect(result).toEqual(handleToolError(error));
    expect(JSON.stringify(result)).toBe(JSON.stringify(handleToolError(error)));
    expect(Object.keys(result)).toEqual(['content', 'isError']);
    expect({ ...result }).toEqual(handleToolError(error));
  });

  it('is undefined for a result the handler returned', async () => {
    const result = await safeHandler(() => ok)();
    expect(caughtError(result)).toBeUndefined();
    expect(caughtError(errorResult('No active file'))).toBeUndefined();
  });
});

describe('safeHandlers', () => {
  interface Handlers {
    read: (params: { path: string }) => Promise<CallToolResult>;
    fail: (params: Record<string, never>) => Promise<CallToolResult>;
  }

  it('wraps every handler of the object', async () => {
    const handlers = safeHandlers<Handlers>({
      read: (params) => ({ content: [{ type: 'text', text: params.path }] }),
      fail: () => {
        throw new Error('nope');
      },
    });
    expect(textOf(await handlers.read({ path: 'a.md' }))).toBe('a.md');
    const failed = await handlers.fail({});
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toBe('Error: nope');
  });
});

describe('errorResult', () => {
  it('formats a message like handleToolError does for an Error', () => {
    expect(errorResult('No active file')).toEqual({
      content: [{ type: 'text', text: 'Error: No active file' }],
      isError: true,
    });
  });
});
