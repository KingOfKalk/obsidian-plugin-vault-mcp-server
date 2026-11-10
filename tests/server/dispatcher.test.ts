import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { capResponse, createToolDispatcher } from '../../src/server/mcp-server';
import { CHARACTER_LIMIT } from '../../src/constants';
import { Logger } from '../../src/utils/logger';
import type { ToolDefinition } from '../../src/registry/types';
import { annotations } from '../../src/registry/types';
import { safeHandler } from '../../src/tools/shared/handler';
import { handleToolError, NotFoundError } from '../../src/tools/shared/errors';
import { PathTraversalError } from '../../src/utils/path-guard';
import { MtimeConflictError } from '../../src/tools/vault/handlers';

function makeExtra(): {
  mcpReq: {
    id: number;
    method: string;
    signal: AbortSignal;
    notify: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
} {
  return {
    mcpReq: {
      id: 1,
      method: 'tools/call',
      signal: new AbortController().signal,
      notify: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
    },
  };
}

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

function makeTool(
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name: 'demo_tool',
    title: 'Demo tool',
    description: 'Demo tool for the dispatcher tests',
    schema: {
      path: z.string().min(1).describe('Required path'),
      count: z.number().int().min(0).default(0).describe('Optional count'),
    },
    handler: vi.fn(async (params) =>
      Promise.resolve({
        content: [
          { type: 'text' as const, text: JSON.stringify(params) },
        ],
      }),
    ),
    annotations: annotations.read,
    ...overrides,
  };
}

describe('createToolDispatcher', () => {
  it('invokes the handler with parsed params when input is valid', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 'notes/a.md', count: 3 }, makeExtra() as never);

    expect(result.isError).toBeUndefined();
    expect(tool.handler).toHaveBeenCalledTimes(1);
    expect(tool.handler).toHaveBeenCalledWith(
      { path: 'notes/a.md', count: 3 },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('fills in schema defaults before calling the handler', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    await dispatch({ path: 'a.md' }, makeExtra() as never);

    expect(tool.handler).toHaveBeenCalledWith(
      { path: 'a.md', count: 0 },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns a well-formed MCP error when a required field is missing', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({}, makeExtra() as never);

    expect(result.isError).toBe(true);
    expect(tool.handler).not.toHaveBeenCalled();
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Invalid arguments');
    expect(text).toContain('path');
  });

  it('rejects wrong types with a clear error', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 42 }, makeExtra() as never);

    expect(result.isError).toBe(true);
    expect(tool.handler).not.toHaveBeenCalled();
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Invalid arguments');
  });

  it('rejects unknown top-level fields (strict parsing)', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 'a.md', bogus: true }, makeExtra() as never);

    expect(result.isError).toBe(true);
    expect(tool.handler).not.toHaveBeenCalled();
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Invalid arguments');
  });

  it('names unknown keys and lists the valid parameters (#388)', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 'a.md', bogus: true, other: 1 }, makeExtra() as never);

    expect(result.isError).toBe(true);
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Unknown parameters: bogus, other');
    expect(text).toContain('Valid parameters: path, count');
    expect(text).not.toContain('<root>');
  });

  it('reports both a misspelled key and the missing required one', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ Path: 'a.md' }, makeExtra() as never);

    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Unknown parameter: Path');
    expect(text).toContain('path:');
  });

  it('wraps handler exceptions as MCP errors', async () => {
    const tool = makeTool({
      handler: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 'a.md' }, makeExtra() as never);

    expect(result.isError).toBe(true);
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('boom');
  });

  it('accepts an empty object for tools with no required fields', async () => {
    const tool = makeTool({
      schema: {},
      handler: vi.fn(async () =>
        Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
      ),
    });
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch(undefined, makeExtra() as never);

    expect(result.isError).toBeUndefined();
    expect(tool.handler).toHaveBeenCalledWith(
      {},
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('createToolDispatcher without the response_format alias (#432)', () => {
  function makeFormatTool(): ToolDefinition {
    return makeTool({
      schema: {
        path: z.string().min(1).describe('Required path'),
        responseFormat: z.enum(['markdown', 'json']).default('markdown'),
      },
    });
  }

  it('rejects response_format with the unknown-parameter error', async () => {
    const tool = makeFormatTool();
    const dispatch = createToolDispatcher(tool, makeLogger());
    const result = await dispatch(
      { path: 'a.md', response_format: 'json' },
      makeExtra() as never,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Invalid arguments: Unknown parameter: response_format. Valid parameters: path, responseFormat.',
    });
    expect(tool.handler).not.toHaveBeenCalled();
  });

  it('passes responseFormat through to the handler', async () => {
    const tool = makeFormatTool();
    const dispatch = createToolDispatcher(tool, makeLogger());
    await dispatch({ path: 'a.md', responseFormat: 'json' }, makeExtra() as never);
    expect(tool.handler).toHaveBeenCalledWith(
      { path: 'a.md', responseFormat: 'json' },
      expect.anything(),
    );
  });
});

describe('createToolDispatcher safety net (#464)', () => {
  const huge = 'x'.repeat(CHARACTER_LIMIT + 500);
  const bigTool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition =>
    makeTool({
      handler: vi.fn(async () =>
        Promise.resolve({
          content: [{ type: 'text' as const, text: huge }],
          structuredContent: { value: huge },
        }),
      ),
      ...overrides,
    });

  it('cuts text over CHARACTER_LIMIT with a footer and logs a warning', async () => {
    const logger = makeLogger();
    const warn = vi.spyOn(logger, 'warn');
    const dispatch = createToolDispatcher(bigTool(), logger);
    const result = await dispatch({ path: 'a.md' }, makeExtra() as never);
    const block = result.content[0];
    const text = block.type === 'text' ? block.text : '';
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(text).toContain('[TRUNCATED: Response exceeded');
    expect(result.structuredContent).toEqual({ value: huge });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"demo_tool" returned'));
  });

  it('does not count image data against the limit (#467)', async () => {
    const image = { type: 'image' as const, data: huge, mimeType: 'image/png' };
    const tool = makeTool({
      handler: vi.fn(async () =>
        Promise.resolve({ content: [{ type: 'text' as const, text: 'path: a.png' }, image] }),
      ),
    });
    const result = await createToolDispatcher(tool, makeLogger())({ path: 'a.md' }, makeExtra() as never);
    expect(result.content).toEqual([{ type: 'text', text: 'path: a.png' }, image]);
  });

  it('leaves a small result alone', async () => {
    const small = await createToolDispatcher(makeTool(), makeLogger())(
      { path: 'a.md' },
      makeExtra() as never,
    );
    expect(small.content[0]).toEqual({ type: 'text', text: '{"path":"a.md","count":0}' });
  });

  it('keeps non-text blocks after the cut text', () => {
    const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' };
    const result = capResponse(
      { content: [{ type: 'text', text: huge }, image] },
      'demo_tool',
      makeLogger(),
    );
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual(image);
  });
});

describe('createToolDispatcher logs unexpected handler errors (#540)', () => {
  function failing(error: Error): ToolDefinition {
    return makeTool({
      handler: safeHandler((): Promise<never> => Promise.reject(error)),
    });
  }

  function zodError(): z.ZodError {
    const parsed = z.string().safeParse(1);
    if (parsed.success) throw new Error('expected a Zod error');
    return parsed.error;
  }

  it('logs a crash in a wrapped handler once at error level, result unchanged', async () => {
    const logger = makeLogger();
    const error = vi.spyOn(logger, 'error');
    const crash = new TypeError('Cannot read properties of undefined');
    const result = await createToolDispatcher(failing(crash), logger)(
      { path: 'a.md' },
      makeExtra() as never,
    );
    expect(result).toEqual(handleToolError(crash));
    expect(JSON.stringify(result)).toBe(JSON.stringify(handleToolError(crash)));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Tool "demo_tool" failed unexpectedly: Cannot read properties of undefined',
      { name: 'TypeError', stack: crash.stack },
    );
  });

  it('logs a rejection from an unwrapped handler exactly once', async () => {
    const logger = makeLogger();
    const error = vi.spyOn(logger, 'error');
    const crash = new Error('boom');
    const tool = makeTool({ handler: vi.fn(() => Promise.reject(crash)) });
    const result = await createToolDispatcher(tool, logger)({ path: 'a.md' }, makeExtra() as never);
    expect(result).toEqual(handleToolError(crash));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Tool "demo_tool" failed unexpectedly: boom', {
      name: 'Error',
      stack: crash.stack,
    });
  });

  it('logs a thrown non-Error value', async () => {
    const logger = makeLogger();
    const error = vi.spyOn(logger, 'error');
    const tool = makeTool({
      handler: safeHandler((): never => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'plain string';
      }),
    });
    await createToolDispatcher(tool, logger)(
      { path: 'a.md' },
      makeExtra() as never,
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Tool "demo_tool" failed unexpectedly: plain string', undefined);
  });

  it.each([
    ['NotFoundError', new NotFoundError('File not found: a.md')],
    ['a Zod validation failure', zodError()],
    ['PathTraversalError', new PathTraversalError('Path traversal detected')],
    ['MtimeConflictError', new MtimeConflictError('a.md', 0, 1)],
  ])('does not log %s at error level', async (_label, expected) => {
    const logger = makeLogger();
    const error = vi.spyOn(logger, 'error');
    const wrapped = await createToolDispatcher(failing(expected), logger)(
      { path: 'a.md' },
      makeExtra() as never,
    );
    const unwrapped = await createToolDispatcher(
      makeTool({ handler: vi.fn(() => Promise.reject(expected)) }),
      logger,
    )({ path: 'a.md' }, makeExtra() as never);
    expect(wrapped.isError).toBe(true);
    expect(unwrapped.isError).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
});
