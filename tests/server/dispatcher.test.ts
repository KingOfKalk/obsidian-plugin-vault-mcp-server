import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolDispatcher } from '../../src/server/mcp-server';
import { Logger } from '../../src/utils/logger';
import type { ToolDefinition } from '../../src/registry/types';
import { annotations } from '../../src/registry/types';

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

function makeTool(
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name: 'demo_tool',
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

    const result = await dispatch({ path: 'notes/a.md', count: 3 });

    expect(result.isError).toBeUndefined();
    expect(tool.handler).toHaveBeenCalledTimes(1);
    expect(tool.handler).toHaveBeenCalledWith({ path: 'notes/a.md', count: 3 });
  });

  it('fills in schema defaults before calling the handler', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    await dispatch({ path: 'a.md' });

    expect(tool.handler).toHaveBeenCalledWith({ path: 'a.md', count: 0 });
  });

  it('returns a well-formed MCP error when a required field is missing', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({});

    expect(result.isError).toBe(true);
    expect(tool.handler).not.toHaveBeenCalled();
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Invalid arguments');
    expect(text).toContain('path');
  });

  it('rejects wrong types with a clear error', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 42 });

    expect(result.isError).toBe(true);
    expect(tool.handler).not.toHaveBeenCalled();
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Invalid arguments');
  });

  it('rejects unknown top-level fields (strict parsing)', async () => {
    const tool = makeTool();
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 'a.md', bogus: true });

    expect(result.isError).toBe(true);
    expect(tool.handler).not.toHaveBeenCalled();
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Invalid arguments');
  });

  it('wraps handler exceptions as MCP errors', async () => {
    const tool = makeTool({
      handler: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    const dispatch = createToolDispatcher(tool, makeLogger());

    const result = await dispatch({ path: 'a.md' });

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

    const result = await dispatch(undefined);

    expect(result.isError).toBeUndefined();
    expect(tool.handler).toHaveBeenCalledWith({});
  });
});
