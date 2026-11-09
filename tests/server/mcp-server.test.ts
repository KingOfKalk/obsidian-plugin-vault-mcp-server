import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import manifest from '../../manifest.json';
import { Logger } from '../../src/utils/logger';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { ToolDefinition, ToolModule, annotations } from '../../src/registry/types';
import { PermissionError } from '../../src/tools/shared/errors';
import type { ToolContext } from '../../src/registry/tool-context';
import { DEFAULT_SETTINGS } from '../../src/types';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { createVaultModule } from '../../src/tools/vault';
import { createSearchModule } from '../../src/tools/search';
import { createEditorModule } from '../../src/tools/editor';
import { createWorkspaceModule } from '../../src/tools/workspace';

interface CapturedServerInfo {
  name: string;
  version: string;
}

interface CapturedOptions {
  capabilities?: {
    tools?: unknown;
    logging?: unknown;
    resources?: unknown;
    prompts?: unknown;
  };
  instructions?: string;
}

interface CapturedRegisterResourceCall {
  name: string;
  uriOrTemplate: unknown;
  metadata: Record<string, unknown>;
}

interface CapturedRegisterPromptCall {
  name: string;
  config: Record<string, unknown>;
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
const capturedRegisterResourceCalls: CapturedRegisterResourceCall[] = [];
const capturedRegisterPromptCalls: CapturedRegisterPromptCall[] = [];

vi.mock('@modelcontextprotocol/server', () => {
  class FakeMcpServer {
    public server = {};
    constructor(serverInfo: CapturedServerInfo, options: CapturedOptions) {
      capturedConstructorArgs.push({ serverInfo, options });
    }
    registerTool(
      name: string,
      config: CapturedRegisterToolCall['config'],
    ): { enabled: boolean; enable(): void; disable(): void } {
      capturedRegisterToolCalls.push({ name, config });
      const handle = {
        enabled: true,
        enable(): void {
          handle.enabled = true;
        },
        disable(): void {
          handle.enabled = false;
        },
      };
      return handle;
    }
    registerResource(name: string, uriOrTemplate: unknown, metadata: Record<string, unknown>): void {
      capturedRegisterResourceCalls.push({ name, uriOrTemplate, metadata });
    }
    registerPrompt(name: string, config: Record<string, unknown>): void {
      capturedRegisterPromptCalls.push({ name, config });
    }
  }
  class FakeResourceTemplate {
    constructor(public uriTemplate: string, public callbacks: unknown) {}
  }
  // prompts.ts imports `completable` from the same entry point in SDK v2.
  const completable = <T>(schema: T): T => schema;
  return {
    McpServer: FakeMcpServer,
    ResourceTemplate: FakeResourceTemplate,
    completable,
  };
});

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

describe('createMcpServer', () => {
  beforeEach(() => {
    capturedConstructorArgs.length = 0;
    capturedRegisterToolCalls.length = 0;
    capturedRegisterResourceCalls.length = 0;
    capturedRegisterPromptCalls.length = 0;
  });

  it('advertises the server as "vault-mcp-server", the name used by the instructions and server_info (#431)', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    expect(capturedConstructorArgs[0].serverInfo.name).toBe('vault-mcp-server');
  });

  it('reports the version from manifest.json (not a hardcoded placeholder)', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    expect(capturedConstructorArgs[0].serverInfo.version).toBe(manifest.version);
    // Sanity: don't let a future regression silently re-introduce '0.0.0'
    // by also asserting it isn't the historical placeholder.
    expect(capturedConstructorArgs[0].serverInfo.version).not.toBe('0.0.0');
  });

  it('declares tool capabilities on the server', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger());

    expect(capturedConstructorArgs[0].options.capabilities?.tools).toBeDefined();
  });

  it('declares logging capability on the server so clients can call logging/setLevel', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger());

    expect(capturedConstructorArgs[0].options.capabilities?.logging).toBeDefined();
  });

  it('forwards SERVER_INSTRUCTIONS when every module that the instructions mention is enabled', async () => {
    const mod = await import('../../src/server/mcp-server');
    const { createMcpServer, SERVER_INSTRUCTIONS } = mod;
    const adapter = new MockObsidianAdapter();
    const registry = new ModuleRegistry(makeLogger());
    registry.registerModule(createVaultModule(adapter));
    registry.registerModule(createSearchModule(adapter));
    registry.registerModule(createEditorModule(adapter));
    registry.registerModule(createWorkspaceModule(adapter));

    createMcpServer(registry, adapter, DEFAULT_SETTINGS, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    // Guard against a destructured-undefined trivial pass where both
    // SERVER_INSTRUCTIONS and options.instructions are undefined.
    expect(typeof SERVER_INSTRUCTIONS).toBe('string');
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(capturedConstructorArgs[0].options.instructions).toBe(
      SERVER_INSTRUCTIONS,
    );
  });

  describe('instructions follow the enabled tools (#447)', () => {
    function build(disable: string[] = []): string {
      const adapter = new MockObsidianAdapter();
      const registry = new ModuleRegistry(makeLogger());
      registry.registerModule(createVaultModule(adapter));
      registry.registerModule(createSearchModule(adapter));
      registry.registerModule(createEditorModule(adapter));
      registry.registerModule(createWorkspaceModule(adapter));
      for (const id of disable) registry.disableModule(id);
      capturedConstructorArgs.length = 0;
      createMcpServer(registry, adapter, DEFAULT_SETTINGS, makeLogger());
      return capturedConstructorArgs[0].options.instructions ?? '';
    }
    let createMcpServer: typeof import('../../src/server/mcp-server').createMcpServer;

    beforeEach(async () => {
      ({ createMcpServer } = await import('../../src/server/mcp-server'));
    });

    it('leaves out the editor line when the editor module is off', () => {
      const text = build(['editor']);
      expect(text).not.toContain('editor_');
      expect(text).toContain('search_fulltext');
      expect(text).toContain('vault_get_aspect');
    });

    it('drops the workspace_open_file hint when the workspace module is off', () => {
      const text = build(['workspace']);
      expect(text).toContain('`editor_*` tools work on the **active** file only');
      expect(text).not.toContain('workspace_open_file');
    });

    it('leaves out the search line when the search module is off', () => {
      const text = build(['search']);
      expect(text).not.toContain('search_');
    });

    it('leaves out the vault_get_aspect line when the vault module is off', () => {
      const text = build(['vault']);
      expect(text).not.toContain('vault_get_aspect');
    });

    it('keeps the version, server_info and path lines with every module off', () => {
      const text = build(['vault', 'search', 'editor', 'workspace']);
      expect(text.split('\n')[0]).toBe(`vault-mcp-server v${manifest.version}`);
      expect(text).toContain('server_info');
      expect(text).toContain('Paths: vault-relative');
      expect(text).not.toMatch(/editor_|search_|vault_get_aspect|workspace_open_file/);
    });

    it('carries the full path rule whenever a path tool is on (#457)', async () => {
      // Path parameters carry only a short form; the rule lives here.
      const { buildServerInstructions } = await import('../../src/server/mcp-server');
      const { PATH_RULE_HINT } = await import('../../src/tools/shared/descriptions');
      for (const active of [undefined, ['vault_read'], ['workspace_open_file'], ['template_create_from'], []]) {
        const text = buildServerInstructions('1.0.0', active);
        expect(text).toContain(PATH_RULE_HINT);
      }
      for (const fact of ['forward slashes', 'case-sensitive', 'with the extension', 'leading / is ignored', 'Path must not traverse outside the vault']) {
        expect(PATH_RULE_HINT).toContain(fact);
      }
    });

    it('drops a line when its tool is switched off on its own', async () => {
      const { buildServerInstructions } = await import('../../src/server/mcp-server');
      const all = buildServerInstructions('1.0.0');
      const without = buildServerInstructions('1.0.0', ['search_fulltext', 'vault_read', 'editor_insert']);
      expect(all).toContain('vault_get_aspect');
      expect(without).not.toContain('vault_get_aspect');
      expect(without).toContain('search_fulltext');
      expect(without).toContain('`editor_*`');
      expect(without).not.toContain('workspace_open_file');
    });

    it('names the write tools and the file-name search only when they are on (#449)', async () => {
      const { buildServerInstructions } = await import('../../src/server/mcp-server');
      const all = buildServerInstructions('1.0.0');
      expect(all).toContain('prefer `vault_replace` or `vault_insert`; `vault_update` only to rewrite');
      expect(all).toContain('not file names); by name with `vault_list_recursive`');
      const some = buildServerInstructions('1.0.0', ['search_fulltext', 'vault_replace']);
      expect(some).toContain('prefer `vault_replace`.');
      expect(some).not.toMatch(/vault_insert|vault_update|vault_list_recursive/);
      const none = buildServerInstructions('1.0.0', ['vault_read']);
      expect(none).not.toContain('vault_replace');
    });
  });

  it('wraps raw-shape inputSchema/outputSchema in z.object for SDK v2, and leaves outputSchema undefined when absent', async () => {
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

    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger());

    // The two stub tools plus the always-on server_info (#402).
    expect(capturedRegisterToolCalls).toHaveLength(3);

    const withOutput = capturedRegisterToolCalls.find(
      (c) => c.name === 'tool_with_output',
    );
    expect(withOutput).toBeDefined();
    // SDK v2 rejects raw shapes; the registry wraps them in z.object. The
    // SDK gets a Standard Schema that validates with that object and
    // advertises a trimmed JSON Schema (#451).
    const registeredOutput = withOutput?.config.outputSchema as StandardSchemaWithJSON;
    expect(registeredOutput['~standard'].validate({ result: 'x' })).toEqual({
      value: { result: 'x' },
    });
    expect(registeredOutput['~standard'].validate({ result: 1 })).toHaveProperty('issues');
    expect(
      registeredOutput['~standard'].jsonSchema.output({ target: 'draft-2020-12' }),
    ).toEqual({
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
    });
    // inputSchema is a strict object so the SDK rejects unknown keys
    // instead of stripping them (#388). No alias preprocess step (#432).
    const registeredInput = withOutput?.config.inputSchema as StandardSchemaWithJSON;
    expect(registeredInput['~standard'].validate({ foo: 'x' })).toEqual({
      value: { foo: 'x' },
    });
    expect(registeredInput['~standard'].validate({ foo: 'x', extra: 1 })).toHaveProperty(
      'issues',
    );
    expect(
      registeredInput['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    ).toEqual({
      type: 'object',
      properties: { foo: { type: 'string' } },
      required: ['foo'],
      additionalProperties: false,
    });

    const withoutOutput = capturedRegisterToolCalls.find(
      (c) => c.name === 'tool_without_output',
    );
    expect(withoutOutput).toBeDefined();
    expect(withoutOutput?.config.outputSchema).toBeUndefined();
    // The field IS present in the config object (we forward it
    // unconditionally) — but its value is undefined.
    expect('outputSchema' in (withoutOutput?.config ?? {})).toBe(true);
  });

  it('passes a ZodObject outputSchema through unchanged', async () => {
    const { toOutputSchema } = await import('../../src/server/mcp-server');
    const loose = z.looseObject({});
    expect(toOutputSchema(loose)).toBe(loose);
    expect(toOutputSchema(undefined)).toBeUndefined();
  });

  it('forwards tool.title as Tool.title only, not as annotations.title (#451)', async () => {
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
    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger());

    const call = capturedRegisterToolCalls.find((c) => c.name === 'titled');
    expect(call).toBeDefined();
    expect(call?.config.title).toBe('Pretty title');
    expect(call?.config.annotations).toEqual(annotations.read);
    expect(call?.config.annotations).not.toHaveProperty('title');
  });

  it('declares the resources capability and registers vault-index + vault-file when resourcesEnabled', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());
    const adapter = new MockObsidianAdapter();
    const settings = { ...DEFAULT_SETTINGS, resourcesEnabled: true };

    createMcpServer(registry, adapter, settings, makeLogger());

    const caps = capturedConstructorArgs[0].options.capabilities;
    expect(caps).toMatchObject({ resources: {} });
    expect(capturedRegisterResourceCalls.map((c) => c.name)).toEqual([
      'vault-index',
      'vault-file',
    ]);
  });

  it('omits the resources capability and skips registration when resourcesEnabled is false', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());
    const adapter = new MockObsidianAdapter();
    const settings = { ...DEFAULT_SETTINGS, resourcesEnabled: false };

    createMcpServer(registry, adapter, settings, makeLogger());

    const caps = capturedConstructorArgs[0].options.capabilities;
    expect(caps).not.toHaveProperty('resources');
    expect(capturedRegisterResourceCalls).toHaveLength(0);
  });

  it('declares the prompts capability and registers all five prompts when promptsEnabled', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());
    const adapter = new MockObsidianAdapter();
    const settings = { ...DEFAULT_SETTINGS, promptsEnabled: true };

    createMcpServer(registry, adapter, settings, makeLogger());

    const caps = capturedConstructorArgs[0].options.capabilities;
    expect(caps).toMatchObject({ prompts: {} });
    expect(capturedRegisterPromptCalls.map((c) => c.name)).toEqual([
      'summarize-note',
      'find-related',
      'expand-template',
      'daily-note',
      'fix-broken-links',
    ]);
  });

  it('omits the prompts capability and skips registration when promptsEnabled is false', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());
    const adapter = new MockObsidianAdapter();
    const settings = { ...DEFAULT_SETTINGS, promptsEnabled: false };

    createMcpServer(registry, adapter, settings, makeLogger());

    const caps = capturedConstructorArgs[0].options.capabilities;
    expect(caps).not.toHaveProperty('prompts');
    expect(capturedRegisterPromptCalls).toHaveLength(0);
  });
});

describe('createToolDispatcher', () => {
  interface FakeExtra {
    mcpReq: {
      id: number;
      method: string;
      signal: AbortSignal;
      _meta?: { progressToken?: string | number };
      notify: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
  }

  function makeExtra(
    overrides: Partial<Pick<FakeExtra['mcpReq'], 'signal' | '_meta'>> = {},
  ): FakeExtra {
    return {
      mcpReq: {
        id: 1,
        method: 'tools/call',
        signal: new AbortController().signal,
        notify: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(),
        ...overrides,
      },
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

  it('passes a ToolContext as the second arg to the handler with mcpReq.signal and mcpReq._meta.progressToken', async () => {
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

  it('ctx.reportProgress emits notifications/progress via extra.mcpReq.notify', async () => {
    const { createToolDispatcher } = await import('../../src/server/mcp-server');
    const { logger } = makeSpiedLogger();
    const tool = makeTool({ foo: z.string() }, async (_params, ctx) => {
      await ctx?.reportProgress(2, 5, 'half');
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });

    const extra = makeExtra({ _meta: { progressToken: 99 } });
    const dispatch = createToolDispatcher(tool, logger);
    await dispatch({ foo: 'ok' }, extra as never);

    expect(extra.mcpReq.notify).toHaveBeenCalledWith({
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
    expect(extra.mcpReq.notify).toHaveBeenCalledWith({
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

describe('server version for the model (#402)', () => {
  beforeEach(() => {
    capturedConstructorArgs.length = 0;
    capturedRegisterToolCalls.length = 0;
  });

  it('SERVER_INSTRUCTIONS starts with the manifest version and points at server_info', async () => {
    const { SERVER_INSTRUCTIONS } = await import('../../src/server/mcp-server');
    const [first, second] = SERVER_INSTRUCTIONS.split('\n');
    expect(first).toBe(`vault-mcp-server v${manifest.version}`);
    expect(second).toContain('server_info');
  });

  it('uses an injected version for the handshake, instructions and server_info description', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger(), {
      version: '9.8.7',
    });

    expect(capturedConstructorArgs[0].serverInfo.version).toBe('9.8.7');
    expect(capturedConstructorArgs[0].options.instructions?.startsWith('vault-mcp-server v9.8.7\n')).toBe(true);
    const info = capturedRegisterToolCalls.find((c) => c.name === 'server_info');
    expect(info?.config.description).toContain('v9.8.7');
    expect(info?.config.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('registers server_info even when every module is disabled', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());
    const stub: ToolModule = {
      metadata: { id: 'stub', name: 'Stub', description: 'test' },
      tools: () => [],
    };
    registry.registerModule(stub);
    registry.disableModule('stub');

    createMcpServer(registry, new MockObsidianAdapter(), DEFAULT_SETTINGS, makeLogger());

    expect(capturedRegisterToolCalls.map((c) => c.name)).toEqual(['server_info']);
    const description = capturedRegisterToolCalls[0].config.description ?? '';
    expect(description).toContain(`v${manifest.version}`);
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

  it('stays within the 1000-character budget (paid every turn)', async () => {
    const { SERVER_INSTRUCTIONS } = await import(
      '../../src/server/mcp-server'
    );
    // Hard cap so we notice if the string drifts toward bloat. Current
    // length is ~940 chars including the version line (#402, #449). It
    // grew when the full path rule moved here from ~30 path parameters
    // (#457), which saved far more in tools/list.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(1000);
  });

  it.each([
    ['search_fulltext'],
    ['vault_read'],
    ['editor_'],
    ['workspace_open_file'],
    ['vault_get_aspect'],
  ])('mentions the load-bearing tool name "%s"', async (token: string) => {
    const { SERVER_INSTRUCTIONS } = await import(
      '../../src/server/mcp-server'
    );
    expect(SERVER_INSTRUCTIONS).toContain(token);
  });
});
