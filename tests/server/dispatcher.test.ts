import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolDispatcher } from '../../src/server/mcp-server';
import { Logger } from '../../src/utils/logger';
import type { ToolDefinition } from '../../src/registry/types';
import { annotations } from '../../src/registry/types';

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
