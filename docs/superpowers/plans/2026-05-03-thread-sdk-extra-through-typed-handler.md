# Thread SDK `extra` arg through `TypedHandler` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP TypeScript SDK's per-request `extra` arg available to tool handlers via a curated `ToolContext`, and demonstrate the new surface in `search_fulltext` (progress + cancellation).

**Architecture:** Introduce [`src/registry/tool-context.ts`](../../../src/registry/tool-context.ts) defining `ToolContext` and `createToolContext(extra, toolName, logger)`. Widen `TypedHandler` in [`src/registry/types.ts`](../../../src/registry/types.ts) with an optional second parameter. Widen `createToolDispatcher` in [`src/server/mcp-server.ts`](../../../src/server/mcp-server.ts) to consume the SDK's `extra`, build a `ToolContext`, and pass it to handlers; declare `logging: {}` capability on the constructor. Rewrite `searchFulltext` to iterate `getAllFiles()` + `readFile()` per file, honor `signal.aborted`, and emit progress at integer-percent boundaries via `ctx.reportProgress`. Delete `searchContent` from the adapter (single caller).

**Tech Stack:** TypeScript, vitest, `@modelcontextprotocol/sdk` v1.x, existing project gates (`npm run lint`, `npm run typecheck`, `npm test`).

**Spec:** [`docs/superpowers/specs/2026-05-03-thread-sdk-extra-through-typed-handler-design.md`](../specs/2026-05-03-thread-sdk-extra-through-typed-handler-design.md)

**Issue:** [#291](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/291)

**Branch:** `refactor/issue-291-thread-sdk-extra-through-typed-handler` (already created and checked out; spec already committed there).

---

## Pre-flight

- [ ] **Step 0.1: Confirm branch and clean tree**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean except possibly the plan file you are about to add; current branch `refactor/issue-291-thread-sdk-extra-through-typed-handler`.

- [ ] **Step 0.2: Confirm baseline test suite is green before changes**

```bash
npm test
```

Expected: full vitest suite passes. If anything is already red, stop and surface it — do not start work on top of a broken baseline.

---

### Task 1: Create `ToolContext` interface and `createToolContext` factory (TDD)

**Files:**
- Create: `src/registry/tool-context.ts`
- Create: `tests/registry/tool-context.test.ts`

`ToolContext` is the project-owned wrapper that handlers use; `createToolContext` builds one from the SDK's per-request `extra`. Both ship together so the failing tests have an export to import. The dispatcher integration lands in Task 2.

- [ ] **Step 1.1: Write the failing tests for `createToolContext`**

Create `tests/registry/tool-context.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { createToolContext, type SdkExtra } from '../../src/registry/tool-context';

function makeLogger(): {
  logger: Logger;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const logger = new Logger('test', { debugMode: true, accessKey: '' });
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  logger.debug = debug;
  logger.info = info;
  logger.warn = warn;
  logger.error = error;
  return { logger, debug, info, warn, error };
}

function makeExtra(overrides: Partial<SdkExtra> = {}): SdkExtra {
  const sendNotification = vi.fn().mockResolvedValue(undefined);
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification,
    sendRequest: vi.fn(),
    ...overrides,
  } as unknown as SdkExtra;
}

describe('createToolContext', () => {
  it('surfaces signal verbatim from extra', () => {
    const ac = new AbortController();
    const { logger } = makeLogger();
    const ctx = createToolContext(makeExtra({ signal: ac.signal }), 'tool_x', logger);
    expect(ctx.signal).toBe(ac.signal);
  });

  it('lifts progressToken from extra._meta', () => {
    const { logger } = makeLogger();
    const ctx = createToolContext(
      makeExtra({ _meta: { progressToken: 'tok-42' } } as Partial<SdkExtra>),
      'tool_x',
      logger,
    );
    expect(ctx.progressToken).toBe('tok-42');
  });

  it('progressToken is undefined when _meta is absent', () => {
    const { logger } = makeLogger();
    const ctx = createToolContext(makeExtra(), 'tool_x', logger);
    expect(ctx.progressToken).toBeUndefined();
  });

  describe('reportProgress', () => {
    it('is a no-op when progressToken is undefined', async () => {
      const extra = makeExtra();
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.reportProgress(5, 10, 'halfway');

      expect(extra.sendNotification).not.toHaveBeenCalled();
    });

    it('emits notifications/progress with the correct params shape when progressToken is set', async () => {
      const extra = makeExtra({ _meta: { progressToken: 7 } } as Partial<SdkExtra>);
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.reportProgress(3, 9, 'step 3');

      expect(extra.sendNotification).toHaveBeenCalledTimes(1);
      expect(extra.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: { progressToken: 7, progress: 3, total: 9, message: 'step 3' },
      });
    });

    it('swallows sendNotification errors and warns via logger', async () => {
      const sendNotification = vi.fn().mockRejectedValue(new Error('socket gone'));
      const extra = makeExtra({
        _meta: { progressToken: 1 },
        sendNotification,
      } as Partial<SdkExtra>);
      const { logger, warn } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await expect(ctx.reportProgress(1, 1)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('log', () => {
    it('fans out to logger.info AND sendNotification with notifications/message', async () => {
      const extra = makeExtra();
      const { logger, info } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.log('info', 'hello', { count: 1 });

      expect(info).toHaveBeenCalledWith('hello', { count: 1 });
      expect(extra.sendNotification).toHaveBeenCalledTimes(1);
      expect(extra.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'tool_x',
          data: { msg: 'hello', data: { count: 1 } },
        },
      });
    });

    it('omits the data field in the notification payload when handler did not pass data', async () => {
      const extra = makeExtra();
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.log('info', 'hello');

      expect(extra.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'tool_x',
          data: { msg: 'hello' },
        },
      });
    });

    it('maps the 8 MCP levels to the 4 project levels', async () => {
      const cases: Array<{
        mcp:
          | 'debug'
          | 'info'
          | 'notice'
          | 'warning'
          | 'error'
          | 'critical'
          | 'alert'
          | 'emergency';
        project: 'debug' | 'info' | 'warn' | 'error';
      }> = [
        { mcp: 'debug', project: 'debug' },
        { mcp: 'info', project: 'info' },
        { mcp: 'notice', project: 'info' },
        { mcp: 'warning', project: 'warn' },
        { mcp: 'error', project: 'error' },
        { mcp: 'critical', project: 'error' },
        { mcp: 'alert', project: 'error' },
        { mcp: 'emergency', project: 'error' },
      ];

      for (const { mcp, project } of cases) {
        const extra = makeExtra();
        const { logger, debug, info, warn, error } = makeLogger();
        const ctx = createToolContext(extra, 'tool_x', logger);

        await ctx.log(mcp, 'msg');

        const callMap = { debug, info, warn, error };
        expect(callMap[project]).toHaveBeenCalledTimes(1);
        // Other levels must not be called.
        for (const other of ['debug', 'info', 'warn', 'error'] as const) {
          if (other !== project) {
            expect(callMap[other]).not.toHaveBeenCalled();
          }
        }
      }
    });

    it('swallows sendNotification errors and warns via logger', async () => {
      const sendNotification = vi.fn().mockRejectedValue(new Error('socket gone'));
      const extra = makeExtra({ sendNotification } as Partial<SdkExtra>);
      const { logger, warn } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await expect(ctx.log('info', 'hello')).resolves.toBeUndefined();
      // Note: the project Logger has already been called (info path) — warn
      // here is about the failed sendNotification, distinct from the fan-out.
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 1.2: Run the tests, confirm they fail with "Cannot find module"**

```bash
npx vitest run tests/registry/tool-context.test.ts
```

Expected: FAIL with module-not-found / undefined import errors for `createToolContext` and `SdkExtra`.

- [ ] **Step 1.3: Create `src/registry/tool-context.ts` with the implementation**

```ts
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { Logger, LogLevel } from '../utils/logger';

export type SdkExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type McpLogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

export interface ToolContext {
  /** Aborted if the client cancelled or the transport closed. */
  signal: AbortSignal;
  /** Present iff the caller passed _meta.progressToken. */
  progressToken: string | number | undefined;
  /** No-op when progressToken is undefined. */
  reportProgress(
    progress: number,
    total?: number,
    message?: string,
  ): Promise<void>;
  /** Fan-out: project Logger AND notifications/message. */
  log(level: McpLogLevel, message: string, data?: unknown): Promise<void>;
}

const MCP_TO_PROJECT_LEVEL: Record<McpLogLevel, LogLevel> = {
  debug: 'debug',
  info: 'info',
  notice: 'info',
  warning: 'warn',
  error: 'error',
  critical: 'error',
  alert: 'error',
  emergency: 'error',
};

export function createToolContext(
  extra: SdkExtra,
  toolName: string,
  logger: Logger,
): ToolContext {
  const progressToken = extra._meta?.progressToken;

  return {
    signal: extra.signal,
    progressToken,

    async reportProgress(
      progress: number,
      total?: number,
      message?: string,
    ): Promise<void> {
      if (progressToken === undefined) return;
      try {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress, total, message },
        });
      } catch (err) {
        logger.warn('reportProgress failed', err);
      }
    },

    async log(
      level: McpLogLevel,
      message: string,
      data?: unknown,
    ): Promise<void> {
      const projectLevel = MCP_TO_PROJECT_LEVEL[level];
      logger[projectLevel](message, data);

      const payload =
        data === undefined ? { msg: message } : { msg: message, data };
      try {
        await extra.sendNotification({
          method: 'notifications/message',
          params: { level, logger: toolName, data: payload },
        });
      } catch (err) {
        logger.warn('ctx.log sendNotification failed', err);
      }
    },
  };
}
```

- [ ] **Step 1.4: Run the tests, confirm they pass**

```bash
npx vitest run tests/registry/tool-context.test.ts
```

Expected: PASS, all 9 tests green.

- [ ] **Step 1.5: Run lint and typecheck**

```bash
npm run lint
npm run typecheck
```

Expected: both clean.

- [ ] **Step 1.6: Commit**

```bash
git add src/registry/tool-context.ts tests/registry/tool-context.test.ts
git commit -m "feat(registry): add ToolContext wrapper for SDK request extra

Refs #291"
```

---

### Task 2: Widen `TypedHandler` to accept an optional `ToolContext`

**Files:**
- Modify: `src/registry/types.ts` — extend `TypedHandler` signature with an optional second parameter; add the import.

The widening alone is a type-only change with no runtime effect. Existing handlers and tests still compile because the second parameter is optional. Bundling this into Task 1 would mix concerns; bundling it into Task 3 would conflate the type-system change with the dispatcher rewiring.

- [ ] **Step 2.1: Modify `src/registry/types.ts`**

Add the import at the top of the file (after the existing `CallToolResult, ToolAnnotations` import line):

```ts
import type { ToolContext } from './tool-context';
```

Then change the `TypedHandler` declaration (currently lines 56–58):

```ts
export type TypedHandler<Shape extends z.ZodRawShape> = (
  params: InferredParams<Shape>,
  ctx?: ToolContext,
) => Promise<CallToolResult>;
```

- [ ] **Step 2.2: Run lint, typecheck, and the full test suite**

```bash
npm run lint
npm run typecheck
npm test
```

Expected: all clean. Existing handlers and tests must keep compiling and passing — `ctx?` makes the second arg optional in the type.

- [ ] **Step 2.3: Commit**

```bash
git add src/registry/types.ts
git commit -m "refactor(registry): widen TypedHandler with optional ToolContext arg

Refs #291"
```

---

### Task 3: Wire dispatcher to consume SDK `extra` and pass `ToolContext` to handlers (TDD)

**Files:**
- Modify: `src/server/mcp-server.ts` — `createToolDispatcher` widens; constructor adds `logging: {}` capability.
- Modify: `tests/server/mcp-server.test.ts` — extend mock and existing dispatcher tests; add new dispatcher cases for the `ctx` arg; add capability assertion.

This task is a single logical concern: the dispatcher's contract changes shape. Existing dispatcher tests need to pass a stub `extra` because the new signature requires it.

- [ ] **Step 3.1: Extend the test capture interface to include `logging`**

In [`tests/server/mcp-server.test.ts`](tests/server/mcp-server.test.ts), update `CapturedOptions` (currently around line 15) to:

```ts
interface CapturedOptions {
  capabilities?: { tools?: unknown; logging?: unknown };
  instructions?: string;
}
```

- [ ] **Step 3.2: Add a helper to build a fake `extra` for dispatcher tests**

In [`tests/server/mcp-server.test.ts`](tests/server/mcp-server.test.ts), inside `describe('createToolDispatcher', …)` (currently around line 203), add a helper near the existing `makeSpiedLogger` / `makeTool` helpers:

```ts
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
```

- [ ] **Step 3.3: Update existing dispatcher tests to pass a stub `extra`**

The four existing tests inside `describe('createToolDispatcher', …)` call `dispatch({ foo: ... })` with a single arg. After Task 3's source change they must pass `extra` as the second arg. Update each call site:

- "returns Invalid arguments envelope and warns on ZodError from invalid input" (currently `await dispatch({ foo: 123 });`):

```ts
const result = await dispatch({ foo: 123 }, makeExtra() as never);
```

- "routes non-Zod parse-time errors through handleToolError without leaking stack" (currently `await dispatch({ foo: 'crash' });`):

```ts
const result = await dispatch({ foo: 'crash' }, makeExtra() as never);
```

- "routes plain handler errors through handleToolError and logs at error level" (currently `await dispatch({ foo: 'ok' });`):

```ts
const result = await dispatch({ foo: 'ok' }, makeExtra() as never);
```

- "formats typed errors via handleToolError typed-error branch" (currently `await dispatch({ foo: 'ok' });`):

```ts
const result = await dispatch({ foo: 'ok' }, makeExtra() as never);
```

The `as never` cast keeps the test concise — the dispatcher only inspects `signal`, `_meta`, and `sendNotification`, all of which the helper supplies. A full `RequestHandlerExtra` would require importing several SDK types just for satisfying the structural type.

- [ ] **Step 3.4: Add the failing capability assertion**

Inside `describe('createMcpServer', …)`, after the existing "declares tool capabilities on the server" test, add:

```ts
  it('declares logging capability on the server so clients can call logging/setLevel', async () => {
    const { createMcpServer } = await import('../../src/server/mcp-server');
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs[0].options.capabilities?.logging).toBeDefined();
  });
```

- [ ] **Step 3.5: Add the failing dispatcher tests for `ToolContext` propagation**

Inside `describe('createToolDispatcher', …)`, add three new `it` blocks at the bottom of the block:

```ts
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
```

- [ ] **Step 3.6: Run the new tests, confirm they fail**

```bash
npx vitest run tests/server/mcp-server.test.ts
```

Expected: the four new tests fail (capability missing; `dispatch` signature does not yet accept the second arg properly; `capturedCtx` is undefined). Existing tests should still pass (the `as never` cast keeps them compiling).

- [ ] **Step 3.7: Modify `src/server/mcp-server.ts`**

At the top of the file, add an import:

```ts
import { createToolContext, type SdkExtra } from '../registry/tool-context';
```

In `createMcpServer`, the constructor's `capabilities` block currently reads `tools: {}`. Replace it with:

```ts
capabilities: {
  tools: {},
  logging: {},
},
```

Replace `createToolDispatcher` (currently lines 54–93) with:

```ts
export function createToolDispatcher(
  tool: ToolDefinition,
  logger: Logger,
): (params: unknown, extra: SdkExtra) => Promise<CallToolResult> {
  const inputSchema = z.object(tool.schema).strict();
  return async (params: unknown, extra: SdkExtra): Promise<CallToolResult> => {
    try {
      const parsed = inputSchema.parse(params ?? {});
      const ctx = createToolContext(extra, tool.name, logger);
      return await tool.handler(parsed, ctx);
    } catch (error) {
      // ZodError keeps the dispatcher's friendlier path-joined format —
      // richer than handleToolError's ZodError branch, and a `warn` not
      // `error` because invalid input is a client problem, not a server one.
      if (error instanceof z.ZodError) {
        const message = error.issues
          .map((issue) => {
            const path =
              issue.path.length > 0 ? issue.path.join('.') : '<root>';
            return `${path}: ${issue.message}`;
          })
          .join('; ');
        logger.warn(`Tool "${tool.name}" rejected invalid input: ${message}`);
        return {
          content: [
            { type: 'text' as const, text: `Invalid arguments: ${message}` },
          ],
          isError: true,
        };
      }
      // Anything else — non-Zod parse-time crash (e.g. a custom .refine()
      // throwing) OR handler-time throw — gets routed through the shared
      // handleToolError so typed errors (NotFoundError, PermissionError, …)
      // produce consistent envelopes. Pass the raw Error as structured
      // log data so the stack is captured server-side; the response itself
      // never includes the stack (handleToolError uses error.message only).
      logger.error(`Tool "${tool.name}" error`, error);
      return handleToolError(error);
    }
  };
}
```

- [ ] **Step 3.8: Run the full mcp-server test file, confirm green**

```bash
npx vitest run tests/server/mcp-server.test.ts
```

Expected: all tests pass — old dispatcher cases, the new `logging` capability assertion, and the three new ctx-propagation tests.

- [ ] **Step 3.9: Run lint, typecheck, and the full suite**

```bash
npm run lint
npm run typecheck
npm test
```

Expected: all clean. The full suite must pass because every existing handler and every existing test treats the second arg as optional.

- [ ] **Step 3.10: Commit**

```bash
git add src/server/mcp-server.ts tests/server/mcp-server.test.ts
git commit -m "refactor(server/mcp): thread SDK extra through dispatcher as ToolContext

- createToolDispatcher now accepts (params, extra) and builds a
  ToolContext (signal, progressToken, reportProgress, log) per call.
- Declare logging: {} capability so clients can issue logging/setLevel.
- Existing dispatcher tests updated to pass a stub extra.

Refs #291"
```

---

### Task 4: Delete `searchContent` from the adapter and mock (cleanup ahead of handler rewrite)

**Files:**
- Modify: `src/obsidian/adapter.ts` — remove `searchContent` from the `ObsidianAdapter` interface AND the implementation.
- Modify: `src/obsidian/mock-adapter.ts` — remove the mock implementation.

This is a separate logical commit because it's pure cleanup that compiles only because the handler still uses it via the soon-to-be-replaced call. We delete the method, then immediately fix the lone caller in Task 5.

> **Important:** completing Task 4 will leave the build red until Task 5 completes — `src/tools/search/handlers.ts` still calls `adapter.searchContent(query)` at line 68. That is intentional: Task 5's failing test exposes the gap and drives the handler rewrite. Do not skip Task 5 or commit Task 4 to a long-lived branch in isolation.

- [ ] **Step 4.1: Remove `searchContent` from the interface**

In [`src/obsidian/adapter.ts`](src/obsidian/adapter.ts), delete line 52:

```ts
  searchContent(query: string): Promise<Array<{ path: string; matches: string[] }>>;
```

- [ ] **Step 4.2: Remove the obsidian-impl implementation**

In [`src/obsidian/adapter.ts`](src/obsidian/adapter.ts), delete the implementation block (currently lines 292–305):

```ts
  async searchContent(query: string): Promise<Array<{ path: string; matches: string[] }>> {
    const results: Array<{ path: string; matches: string[] }> = [];
    const files = this.app.vault.getMarkdownFiles();
    const lowerQuery = query.toLowerCase();
    for (const file of files) {
      const content = await this.app.vault.read(file);
      if (content.toLowerCase().includes(lowerQuery)) {
        const lines = content.split('\n');
        const matches = lines.filter((line) => line.toLowerCase().includes(lowerQuery));
        results.push({ path: file.path, matches });
      }
    }
    return results;
  }
```

- [ ] **Step 4.3: Remove the mock implementation**

In [`src/obsidian/mock-adapter.ts`](src/obsidian/mock-adapter.ts), delete the implementation block (currently lines 302–313):

```ts
  async searchContent(query: string): Promise<Array<{ path: string; matches: string[] }>> {
    const results: Array<{ path: string; matches: string[] }> = [];
    const lowerQuery = query.toLowerCase();
    for (const [filePath, file] of this.files.entries()) {
      if (file.content.toLowerCase().includes(lowerQuery)) {
        const lines = file.content.split('\n');
        const matches = lines.filter((line) => line.toLowerCase().includes(lowerQuery));
        results.push({ path: filePath, matches });
      }
    }
    return results;
  }
```

- [ ] **Step 4.4: Confirm typecheck fails on the lone caller**

```bash
npm run typecheck
```

Expected: TS error in `src/tools/search/handlers.ts` — `Property 'searchContent' does not exist on type 'ObsidianAdapter'`. This is exactly what Task 5 fixes.

Do NOT commit yet. The fix in Task 5 belongs to the same chain of work; we'll combine the deletion + replacement into one logically coherent commit at the end of Task 5.

---

### Task 5: Rewrite `searchFulltext` to use `ToolContext` for progress + cancellation (TDD)

**Files:**
- Modify: `src/tools/search/handlers.ts` — rewrite the `searchFulltext` handler; widen the `searchFulltext` field on `SearchHandlers`.
- Modify: `tests/tools/search/search.test.ts` — add cancellation, progress-emit, no-progressToken, and backwards-compat tests.

- [ ] **Step 5.1: Add the failing tests for cancellation and progress**

In [`tests/tools/search/search.test.ts`](tests/tools/search/search.test.ts), inside `describe('searchFulltext', …)`, add these tests at the bottom of the inner block.

First, extend the existing vitest import at the top of the file (currently `import { describe, it, expect, beforeEach } from 'vitest';`) to also pull in `vi`, and add a `ToolContext` import:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ToolContext } from '../../../src/registry/tool-context';
```

Add a small helper for building a fake ctx near the `getText` helper at the top:

```ts
function makeCtx(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    signal: new AbortController().signal,
    progressToken: undefined,
    reportProgress: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

Then add these tests inside `describe('searchFulltext', …)`:

```ts
    it('returns an error envelope when signal is already aborted at invocation', async () => {
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');
      const readSpy = vi.spyOn(adapter, 'readFile');

      const ac = new AbortController();
      ac.abort();
      const ctx = makeCtx({ signal: ac.signal });

      const result = await handlers.searchFulltext({ query: 'x' }, ctx);

      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Cancelled');
      expect(readSpy).not.toHaveBeenCalled();
    });

    it('stops reading remaining files when signal is aborted mid-run', async () => {
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');
      adapter.addFile('c.md', 'x');
      adapter.addFile('d.md', 'x');
      adapter.addFile('e.md', 'x');

      const ac = new AbortController();
      // Capture the real method BEFORE installing the spy, so the
      // mockImplementation can delegate back to it.
      const realReadFile = adapter.readFile.bind(adapter);
      const readSpy = vi.spyOn(adapter, 'readFile');
      let count = 0;
      readSpy.mockImplementation(async (path: string) => {
        count++;
        if (count === 2) ac.abort();
        return realReadFile(path);
      });

      const ctx = makeCtx({ signal: ac.signal });
      const result = await handlers.searchFulltext({ query: 'x' }, ctx);

      expect(result.isError).toBe(true);
      // Two files read before the abort fires the next iteration's check.
      expect(readSpy).toHaveBeenCalledTimes(2);
    });

    it('emits progress at integer-percent boundaries when progressToken is set', async () => {
      // 4 files → percent boundaries at 25, 50, 75, 100.
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');
      adapter.addFile('c.md', 'x');
      adapter.addFile('d.md', 'x');

      const reportProgress = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({
        progressToken: 'tok',
        reportProgress,
      });

      await handlers.searchFulltext({ query: 'x' }, ctx);

      expect(reportProgress).toHaveBeenCalledTimes(4);
      // Final call should report progress === total.
      const lastCall = reportProgress.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe(4);
      expect(lastCall?.[1]).toBe(4);
    });

    it('still calls reportProgress when progressToken is undefined (the no-op path)', async () => {
      // The handler should not branch on progressToken — that gating lives
      // inside ctx.reportProgress. The handler always invokes it; the
      // no-op behaviour is the wrapper's responsibility (covered in
      // tests/registry/tool-context.test.ts).
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'x');

      const reportProgress = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCtx({ reportProgress });

      await handlers.searchFulltext({ query: 'x' }, ctx);

      // Two files, both percent-boundaries (50, 100), so two emits.
      expect(reportProgress).toHaveBeenCalled();
    });

    it('still works when called with no ctx (backwards-compat path)', async () => {
      adapter.addFile('a.md', 'x');
      adapter.addFile('b.md', 'y');
      const result = await handlers.searchFulltext({ query: 'x' });
      expect(result.isError).toBeFalsy();
      expect(getText(result)).toContain('a.md');
    });
```

- [ ] **Step 5.2: Run the new tests, confirm they fail**

```bash
npx vitest run tests/tools/search/search.test.ts
```

Expected: tests fail because (a) typecheck fails on `adapter.searchContent` from Task 4, and/or (b) the new tests rely on a ctx-aware handler that doesn't exist yet.

- [ ] **Step 5.3: Rewrite `searchFulltext` in `src/tools/search/handlers.ts`**

In [`src/tools/search/handlers.ts`](src/tools/search/handlers.ts), update the handler interface (line 18):

```ts
import type { ToolContext } from '../../registry/tool-context';
```

Then change the `SearchHandlers.searchFulltext` field signature:

```ts
  searchFulltext: (
    params: InferredParams<typeof searchFulltextSchema>,
    ctx?: ToolContext,
  ) => Promise<CallToolResult>;
```

Replace the `searchFulltext` body (currently lines 65–95):

```ts
    async searchFulltext(params, ctx): Promise<CallToolResult> {
      try {
        const lowerQuery = params.query.toLowerCase();
        const allFiles = adapter.getAllFiles();
        const total = allFiles.length;
        const matched: Array<{ path: string; matches: string[] }> = [];

        let lastPct = -1;
        for (let i = 0; i < total; i++) {
          if (ctx?.signal.aborted) {
            throw new Error('Cancelled');
          }
          const path = allFiles[i];
          const content = await adapter.readFile(path);
          if (content.toLowerCase().includes(lowerQuery)) {
            const lines = content.split('\n');
            const matches = lines.filter((line) =>
              line.toLowerCase().includes(lowerQuery),
            );
            matched.push({ path, matches });
          }
          if (ctx) {
            const pct =
              total === 0 ? 100 : Math.floor(((i + 1) / total) * 100);
            if (pct > lastPct) {
              lastPct = pct;
              await ctx.reportProgress(
                i + 1,
                total,
                `Scanned ${String(i + 1)}/${String(total)} files`,
              );
            }
          }
        }

        const page = paginate(matched, readPagination(params));
        const result = makeResponse(
          page,
          (v) => {
            if (v.items.length === 0) return 'No matches.';
            const lines = v.items.map(
              (m) =>
                `- ${m.path} (${String(m.matches.length)} match${m.matches.length === 1 ? '' : 'es'})`,
            );
            const pager = v.has_more
              ? `\n\n_Showing ${String(v.count)} of ${String(v.total)} — next offset: ${String(v.next_offset ?? '')}_`
              : '';
            return `**${String(v.total)} result${v.total === 1 ? '' : 's'}**\n\n${lines.join('\n')}${pager}`;
          },
          readResponseFormat(params),
        );
        const truncated = truncateText(
          result.content[0].type === 'text' ? result.content[0].text : '',
          { hint: 'Narrow the query, shrink limit, or advance offset.' },
        );
        return {
          ...result,
          content: [{ type: 'text' as const, text: truncated.text }],
        };
      } catch (error) {
        return handleToolError(error);
      }
    },
```

- [ ] **Step 5.4: Run the search test file, confirm green**

```bash
npx vitest run tests/tools/search/search.test.ts
```

Expected: all tests pass — the existing `search_fulltext` cases (json/markdown/truncation) AND the five new ctx tests.

- [ ] **Step 5.5: Run lint, typecheck, and the full suite**

```bash
npm run lint
npm run typecheck
npm test
```

Expected: all clean, full vitest suite green.

- [ ] **Step 5.6: Commit Tasks 4 + 5 together**

The commit covers the adapter cleanup (deletion) AND the handler rewrite (replacement) — same logical concern: the search-fulltext loop moved from adapter into handler, gaining progress + cancellation along the way.

```bash
git add src/obsidian/adapter.ts src/obsidian/mock-adapter.ts src/tools/search/handlers.ts tests/tools/search/search.test.ts
git commit -m "refactor(tools/search): move searchFulltext loop into handler with progress + cancellation

- Delete ObsidianAdapter.searchContent (single caller).
- Inline the per-file scan in the searchFulltext handler.
- Honor ctx.signal.aborted at each iteration.
- Emit ctx.reportProgress at integer-percent boundaries.

Refs #291"
```

---

### Task 6: Final gate, push, and PR

- [ ] **Step 6.1: Run the full gate one last time**

```bash
npm run lint
npm run typecheck
npm test
```

Expected: all clean.

- [ ] **Step 6.2: Inspect git log to verify commit messages and order**

```bash
git log --oneline main..HEAD
```

Expected: 5 commits in this order:

1. `docs(superpowers/specs): add design for threading SDK extra through TypedHandler`
2. `feat(registry): add ToolContext wrapper for SDK request extra`
3. `refactor(registry): widen TypedHandler with optional ToolContext arg`
4. `refactor(server/mcp): thread SDK extra through dispatcher as ToolContext`
5. `refactor(tools/search): move searchFulltext loop into handler with progress + cancellation`

If anything is wrong, stop and surface — do not amend or rebase without consultation.

- [ ] **Step 6.3: Push the branch**

```bash
git push -u origin refactor/issue-291-thread-sdk-extra-through-typed-handler
```

- [ ] **Step 6.4: Open the PR**

```bash
gh pr create \
  --title "refactor(registry,server): thread SDK extra arg through TypedHandler" \
  --body "$(cat <<'EOF'
Closes #291

## Summary
- Widen `TypedHandler` with an optional `ToolContext` second arg; existing handlers compile unchanged.
- Thread the SDK's per-request `extra` through `createToolDispatcher`, exposing `signal`, `progressToken`, `reportProgress`, and a `log` fan-out (Logger + `notifications/message`) via a project-owned `ToolContext`.
- Declare `logging: {}` capability so clients can issue `logging/setLevel`.
- Worked example: `search_fulltext` honors `signal.aborted` and emits progress at integer-percent boundaries. `ObsidianAdapter.searchContent` deleted (single caller).

## Test plan
- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm test` clean (new tests in `tests/registry/tool-context.test.ts`, additions in `tests/server/mcp-server.test.ts` and `tests/tools/search/search.test.ts`)

Spec: [`docs/superpowers/specs/2026-05-03-thread-sdk-extra-through-typed-handler-design.md`](docs/superpowers/specs/2026-05-03-thread-sdk-extra-through-typed-handler-design.md)
EOF
)"
```

- [ ] **Step 6.5: Wait for CI and the user's merge decision**

Per project rule 42: never merge a PR yourself. Watch CI; if conflicts or red checks appear, fix them on this branch. Otherwise wait for the user to merge.

---

## Self-review notes (for the reviewer)

- **Spec coverage:** §3 ToolContext + TypedHandler → Tasks 1, 2. §4 Dispatcher + capabilities → Task 3. §5 capability declaration → Task 3.4 + 3.7. §6 adapter cleanup → Task 4. §7 worked example → Task 5. §8.1 tool-context tests → Task 1.1. §8.2 mcp-server test additions → Task 3.1, 3.4, 3.5. §8.3 search test additions → Task 5.1.
- **No placeholders:** every step shows code or commands.
- **Type consistency:** `createToolContext(extra, toolName, logger)` argument order is identical in Task 1 (definition), Task 3 (dispatcher call), and the test files. `McpLogLevel` matches the SDK's level set (8 values). `progressToken: string | number | undefined` matches the SDK's `RequestMetaSchema.progressToken`.
- **Out of scope (per spec §11):** elicitation, sampling, broader progress wiring, `clientCapabilities`, sweeping `logger.*` → `ctx.log` migration, SDK version changes. None of these tasks reach into those areas.
