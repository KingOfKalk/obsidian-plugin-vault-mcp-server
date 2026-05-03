import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import manifest from '../../manifest.json';
import { Logger } from '../../src/utils/logger';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ToolDefinition, ToolModule, annotations } from '../../src/registry/types';
import { PermissionError } from '../../src/tools/shared/errors';
import type { ToolContext } from '../../src/registry/tool-context';

interface CapturedServerInfo {
  name: string;
  version: string;
}

interface CapturedOptions {
  capabilities?: { tools?: unknown; logging?: unknown };
  instructions?: string;
}

interface CapturedRegisterToolCall {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: { title?: string } & Record<string, unknown>;
  };
}

const capturedConstructorArgs: Array<{
  serverInfo: CapturedServerInfo;
  options: CapturedOptions;
}> = [];

const capturedRegisterToolCalls: CapturedRegisterToolCall[] = [];

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class FakeMcpServer {
    public server = {};
    constructor(serverInfo: CapturedServerInfo, options: CapturedOptions) {
      capturedConstructorArgs.push({ serverInfo, options });
    }
    registerTool(
      name: string,
      config: CapturedRegisterToolCall['config'],
    ): void {
      capturedRegisterToolCalls.push({ name, config });
    }
  }
  return { McpServer: FakeMcpServer };
});

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

describe('createMcpServer', () => {
  beforeEach(() => {
    capturedConstructorArgs.length = 0;
    capturedRegisterToolCalls.length = 0;
  });

  it('advertises the server as "obsidian-mcp-server" per the {service}-mcp-server convention', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    expect(capturedConstructorArgs[0].serverInfo.name).toBe('obsidian-mcp-server');
  });

  it('reports the version from manifest.json (not a hardcoded placeholder)', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    expect(capturedConstructorArgs[0].serverInfo.version).toBe(manifest.version);
    // Sanity: don't let a future regression silently re-introduce '0.0.0'
    // by also asserting it isn't the historical placeholder.
    expect(capturedConstructorArgs[0].serverInfo.version).not.toBe('0.0.0');
  });

  it('declares tool capabilities on the server', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs[0].options.capabilities?.tools).toBeDefined();
  });

  it('declares logging capability on the server so clients can call logging/setLevel', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs[0].options.capabilities?.logging).toBeDefined();
  });

  it('forwards SERVER_INSTRUCTIONS to the McpServer constructor as the instructions option', async () => {
    const mod = await import('../../src/server/mcp-server');
    const { createMcpServer, SERVER_INSTRUCTIONS } = mod;
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    // Guard against a destructured-undefined trivial pass where both
    // SERVER_INSTRUCTIONS and options.instructions are undefined.
    expect(typeof SERVER_INSTRUCTIONS).toBe('string');
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(capturedConstructorArgs[0].options.instructions).toBe(
      SERVER_INSTRUCTIONS,
    );
  });

  it('forwards outputSchema to registerTool when defined, and undefined when absent', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');

    const inputSchema = { foo: z.string() };
    const outputSchema = { result: z.string() };

    const toolWithOutputSchema = {
      name: 'tool_with_output',
      title: 'tool with output',
      description: 'has output schema',
      schema: inputSchema,
      outputSchema,
      handler: () =>
        Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
      annotations: annotations.read,
    } as unknown as ToolDefinition;

    const toolWithoutOutputSchema = {
      name: 'tool_without_output',
      title: 'tool without output',
      description: 'no output schema',
      schema: inputSchema,
      handler: () =>
        Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
      annotations: annotations.read,
    } as unknown as ToolDefinition;

    const stubModule: ToolModule = {
      metadata: {
        id: 'stub',
        name: 'Stub',
        description: 'test',
      },
      tools: () => [toolWithOutputSchema, toolWithoutOutputSchema],
    };

    const registry = new ModuleRegistry(makeLogger());
    registry.registerModule(stubModule);

    createMcpServer(registry, makeLogger());

    expect(capturedRegisterToolCalls).toHaveLength(2);

    const withOutput = capturedRegisterToolCalls.find(
      (c) => c.name === 'tool_with_output',
    );
    expect(withOutput).toBeDefined();
    expect(withOutput?.config.outputSchema).toBe(outputSchema);
    expect(withOutput?.config.inputSchema).toBe(inputSchema);

    const withoutOutput = capturedRegisterToolCalls.find(
      (c) => c.name === 'tool_without_output',
    );
    expect(withoutOutput).toBeDefined();
    expect(withoutOutput?.config.outputSchema).toBeUndefined();
    // The field IS present in the config object (we forward it
    // unconditionally) — but its value is undefined.
    expect('outputSchema' in (withoutOutput?.config ?? {})).toBe(true);
  });

  it('forwards tool.title to both Tool.title and annotations.title', async () => {
    const { ModuleRegistry } = await import('../../src/registry/module-registry');
    const { createMcpServer } = await import('../../src/server/mcp-server');

    const titledTool = {
      name: 'titled',
      title: 'Pretty title',
      description: 'has title',
      schema: { foo: z.string() },
      handler: () =>
        Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
      annotations: annotations.read,
    } as unknown as ToolDefinition;

    const stubModule: ToolModule = {
      metadata: { id: 'stub', name: 'Stub', description: 'test' },
      tools: () => [titledTool],
    };

    const registry = new ModuleRegistry(makeLogger());
    registry.registerModule(stubModule);
    createMcpServer(registry, makeLogger());

    const call = capturedRegisterToolCalls.find((c) => c.name === 'titled');
    expect(call).toBeDefined();
    expect(call?.config.title).toBe('Pretty title');
    expect(call?.config.annotations?.title).toBe('Pretty title');
  });
});

describe('createToolDispatcher', () => {
  function makeExtra(overrides: Record<string, unknown> = {}): {
    signal: AbortSignal;
    _meta?: { progressToken?: string | number };
    sendNotification: ReturnType<typeof vi.fn>;
    sendRequest: ReturnType<typeof vi.fn>;
    requestId: number;
  } {
    return {
      signal: new AbortController().signal,
      requestId: 1,
      sendNotification: vi.fn().mockResolvedValue(undefined),
      sendRequest: vi.fn(),
      ...overrides,
    };
  }

  function makeSpiedLogger(): {
    logger: Logger;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  } {
    const logger = makeLogger();
    const warn = vi.fn();
    const error = vi.fn();
    logger.warn = warn;
    logger.error = error;
    return { logger, warn, error };
  }

  function makeTool<Shape extends z.ZodRawShape>(
    schema: Shape,
    handler: (params: z.input<z.ZodObject<Shape>>, ctx?: ToolContext) => Promise<CallToolResult>,
  ): ToolDefinition {
    return {
      name: 'test_tool',
      title: 'test tool',
      description: 'test',
      schema,
      handler,
      annotations: annotations.read,
    } as unknown as ToolDefinition;
  }

  it('returns Invalid arguments envelope and warns on ZodError from invalid input', async () => {
    const { createToolDispatcher } = await import(
      '../../src/server/mcp-server'
    );
    const { logger, warn, error } = makeSpiedLogger();
    const tool = makeTool({ foo: z.string() }, () =>
      Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
    );

    const dispatch = createToolDispatcher(tool, logger);
    const result = await dispatch({ foo: 123 }, makeExtra() as never);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text.startsWith('Invalid arguments:')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('routes non-Zod parse-time errors through handleToolError without leaking stack', async () => {
    const { createToolDispatcher } = await import(
      '../../src/server/mcp-server'
    );
    const { logger, warn, error } = makeSpiedLogger();
    const tool = makeTool(
      {
        foo: z.string().refine((v) => {
          if (v === 'crash') {
            throw new Error('boom');
          }
          return true;
        }),
      },
      () =>
        Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
    );

    const dispatch = createToolDispatcher(tool, logger);
    const result = await dispatch({ foo: 'crash' }, makeExtra() as never);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // handleToolError formats unknown errors as "Error: <message>".
    expect(text).toBe('Error: boom');
    // The response must NOT contain stack-frame substrings.
    expect(text).not.toMatch(/\n\s*at\s/);
    expect(text).not.toContain('mcp-server.ts');
    expect(text).not.toContain('.test.ts');
    // Logger called at error level with the Error as structured data so
    // the stack is captured server-side.
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    const errorCallArgs = error.mock.calls[0];
    // Second argument (data) should be the raw Error so the stack is logged.
    expect(errorCallArgs[1]).toBeInstanceOf(Error);
    expect((errorCallArgs[1] as Error).message).toBe('boom');
  });

  it('routes plain handler errors through handleToolError and logs at error level', async () => {
    const { createToolDispatcher } = await import(
      '../../src/server/mcp-server'
    );
    const { logger, warn, error } = makeSpiedLogger();
    const tool = makeTool({ foo: z.string() }, () =>
      Promise.reject(new Error('handler boom')),
    );

    const dispatch = createToolDispatcher(tool, logger);
    const result = await dispatch({ foo: 'ok' }, makeExtra() as never);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe('Error: handler boom');
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('formats typed errors via handleToolError typed-error branch', async () => {
    const { createToolDispatcher } = await import(
      '../../src/server/mcp-server'
    );
    const { logger, error } = makeSpiedLogger();
    const tool = makeTool({ foo: z.string() }, () =>
      Promise.reject(new PermissionError('no access')),
    );

    const dispatch = createToolDispatcher(tool, logger);
    const result = await dispatch({ foo: 'ok' }, makeExtra() as never);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    // PermissionError gets the "Permission denied: <message>" prefix from
    // handleToolError — pins the integration with shared/errors.ts.
    expect(text).toBe('Error: Permission denied: no access');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('passes a ToolContext as the second arg to the handler with extra.signal and extra._meta.progressToken', async () => {
    const { createToolDispatcher } = await import('../../src/server/mcp-server');
    const { logger } = makeSpiedLogger();
    let capturedCtx: unknown = undefined;
    const tool = makeTool({ foo: z.string() }, (_params, ctx) => {
      capturedCtx = ctx;
      return Promise.resolve({
        content: [{ type: 'text' as const, text: 'ok' }],
      });
    });

    const ac = new AbortController();
    const extra = makeExtra({
      signal: ac.signal,
      _meta: { progressToken: 'tok-1' },
    });

    const dispatch = createToolDispatcher(tool, logger);
    await dispatch({ foo: 'ok' }, extra as never);

    expect(capturedCtx).toBeDefined();
    const ctx = capturedCtx as {
      signal: AbortSignal;
      progressToken: string | number | undefined;
    };
    expect(ctx.signal).toBe(ac.signal);
    expect(ctx.progressToken).toBe('tok-1');
  });

  it('ctx.reportProgress emits notifications/progress via extra.sendNotification', async () => {
    const { createToolDispatcher } = await import('../../src/server/mcp-server');
    const { logger } = makeSpiedLogger();
    const tool = makeTool({ foo: z.string() }, async (_params, ctx) => {
      await ctx?.reportProgress(2, 5, 'half');
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    const extra = makeExtra({ _meta: { progressToken: 99 } });
    const dispatch = createToolDispatcher(tool, logger);
    await dispatch({ foo: 'ok' }, extra as never);

    expect(extra.sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 99, progress: 2, total: 5, message: 'half' },
    });
  });

  it('ctx.log fans out to Logger AND emits notifications/message tagged with the tool name', async () => {
    const { createToolDispatcher } = await import('../../src/server/mcp-server');
    const { logger, warn } = makeSpiedLogger();
    const info = vi.fn();
    logger.info = info;
    const tool = makeTool({ foo: z.string() }, async (_params, ctx) => {
      await ctx?.log('info', 'progress', { step: 1 });
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    const extra = makeExtra();
    const dispatch = createToolDispatcher(tool, logger);
    await dispatch({ foo: 'ok' }, extra as never);

    expect(info).toHaveBeenCalledWith('progress', { step: 1 });
    expect(extra.sendNotification).toHaveBeenCalledWith({
      method: 'notifications/message',
      params: {
        level: 'info',
        logger: 'test_tool',
        data: { msg: 'progress', data: { step: 1 } },
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('SERVER_INSTRUCTIONS', () => {
  it('is a non-empty string', async () => {
    const { SERVER_INSTRUCTIONS } = await import(
      '../../src/server/mcp-server'
    );
    expect(typeof SERVER_INSTRUCTIONS).toBe('string');
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it('stays within the 800-character budget (paid every turn)', async () => {
    const { SERVER_INSTRUCTIONS } = await import(
      '../../src/server/mcp-server'
    );
    // Hard cap so we notice if the string drifts toward bloat. Current
    // length is ~560 chars, well below the cap.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(800);
  });

  it.each([
    ['search_fulltext'],
    ['vault_read'],
    ['editor_'],
    ['workspace_open_file'],
    ['vault_get_'],
  ])('mentions the load-bearing tool name "%s"', async (token: string) => {
    const { SERVER_INSTRUCTIONS } = await import(
      '../../src/server/mcp-server'
    );
    expect(SERVER_INSTRUCTIONS).toContain(token);
  });
});
