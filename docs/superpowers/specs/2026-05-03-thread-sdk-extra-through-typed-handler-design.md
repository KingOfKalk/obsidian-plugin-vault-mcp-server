# Design — Thread SDK `extra` arg through `TypedHandler`

- **Date:** 2026-05-03
- **Issue:** [#291](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/291)
- **Tracker context:** Follow-up from the `mcp-server-dev:build-mcp-server` skill review (parent: [#258](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/258)).
- **Status:** Approved design; implementation plan to follow.

## 1. Goal

Make the MCP TypeScript SDK's per-request `extra` arg available to tool handlers so that progress reporting, cancellation, MCP-protocol logging, sampling, and elicitation become *possible* — without retrofitting any of those features into every tool today.

The SDK invokes a tool callback with two arguments: `(params, extra)`, where `extra` carries `signal` (`AbortSignal`), `_meta?.progressToken`, `sendNotification`, `sendRequest`, and other request-scoped fields. The current `TypedHandler` signature in [`src/registry/types.ts`](../../../src/registry/types.ts) only accepts `params`, and [`createToolDispatcher`](../../../src/server/mcp-server.ts) drops the second argument before invoking the handler. Every spec feature that depends on `extra` is therefore silently foreclosed.

This PR widens `TypedHandler`, threads a curated `ToolContext` through the dispatcher, and demonstrates the new surface in one worked example (`search_fulltext`). Per-tool follow-ups (broader progress wiring, elicitation, sampling) are out of scope.

## 2. Locked decisions

- **Context shape:** option **B** from brainstorming — project-owned `ToolContext` interface, no raw SDK escape hatch. Insulates handlers from SDK churn.
- **MCP-protocol logging:** option **B** — explicit `ctx.log(level, message, data?)` fan-out to both the existing `Logger` (stderr + sink) and `notifications/message`. Existing in-handler `logger.*` calls keep their current scope. Server declares `logging: {}` capability so clients can issue `logging/setLevel`.
- **Worked example:** option **A** — `search_fulltext`. Push the per-file scan up from the adapter into the handler so `signal.aborted` and `progressToken` can be honored at file granularity.
- **Adapter cleanup:** option **A** — delete `ObsidianAdapter.searchContent` (single caller, was inlined into the handler).
- **Progress cadence:** option **C** — bucketed at integer-percent boundaries. Caps notifications at ~100 per call regardless of vault size.
- **`clientCapabilities` accessor:** option **C** — skip for now. The issue lists it as part of the "minimal context surface" but no handler in this PR uses it; add when the first real consumer (elicitation, capability-branching tool) lands.

## 3. `ToolContext` and `TypedHandler`

A new file [`src/registry/tool-context.ts`](../../../src/registry/tool-context.ts) defines the wrapper surface:

```ts
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../utils/logger';

export type SdkExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type McpLogLevel =
  | 'debug' | 'info' | 'notice' | 'warning'
  | 'error' | 'critical' | 'alert' | 'emergency';

export interface ToolContext {
  /** Aborted if the client cancelled or the transport closed. */
  signal: AbortSignal;
  /** Present iff the caller passed _meta.progressToken. */
  progressToken: string | number | undefined;
  /** No-op when progressToken is undefined. */
  reportProgress(progress: number, total?: number, message?: string): Promise<void>;
  /** Fan-out: project Logger AND notifications/message. */
  log(level: McpLogLevel, message: string, data?: unknown): Promise<void>;
}

export function createToolContext(
  extra: SdkExtra,
  toolName: string,
  logger: Logger,
): ToolContext { /* … see §4 … */ }
```

[`src/registry/types.ts`](../../../src/registry/types.ts) — `TypedHandler` widens with an **optional** second arg:

```ts
import type { ToolContext } from './tool-context';

export type TypedHandler<Shape extends z.ZodRawShape> = (
  params: InferredParams<Shape>,
  ctx?: ToolContext,
) => Promise<CallToolResult>;
```

`ctx` is optional in the type so that:

- Existing handlers (every handler today is one-arg) keep compiling unchanged.
- Existing tests calling `tool.handler({ … })` directly (≈ every `tests/tools/**` file) keep working without churn.
- The dispatcher always passes a real `ToolContext`; opting in is just adding the second parameter.

## 4. Dispatcher changes — [`src/server/mcp-server.ts`](../../../src/server/mcp-server.ts)

`createToolDispatcher` widens to accept the SDK's `extra` and build a `ToolContext` per call:

```ts
export function createToolDispatcher(
  tool: ToolDefinition,
  logger: Logger,
): (params: unknown, extra: SdkExtra) => Promise<CallToolResult> {
  const inputSchema = z.object(tool.schema).strict();
  return async (params, extra): Promise<CallToolResult> => {
    try {
      const parsed = inputSchema.parse(params ?? {});
      const ctx = createToolContext(extra, tool.name, logger);
      return await tool.handler(parsed, ctx);
    } catch (error) {
      // existing ZodError + handleToolError branches unchanged
    }
  };
}
```

`registerTools` already passes `createToolDispatcher(tool, logger)` straight to `server.registerTool(...)`. The SDK's `ToolCallback` already has the `(args, extra) => Result` shape, so the wider dispatcher signature is a drop-in match — no other call site changes.

`createToolContext` implementation (in [`src/registry/tool-context.ts`](../../../src/registry/tool-context.ts)):

- `signal`: `extra.signal` verbatim.
- `progressToken`: `extra._meta?.progressToken` (typed `string | number | undefined`).
- `reportProgress(progress, total?, message?)`:
  - No-op if `progressToken === undefined`.
  - Otherwise `await extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total, message } })`.
  - Wrapped in `try/catch`; errors are logged via `logger.warn('reportProgress failed', error)` and swallowed. A flaky transport must not abort the tool.
- `log(level, message, data?)`:
  - Map `level` to project `LogLevel` and call `logger.{debug|info|warn|error}(message, data)`.
  - Then `await extra.sendNotification({ method: 'notifications/message', params: { level, logger: toolName, data: data === undefined ? { msg: message } : { msg: message, data } } })`.
  - Same `try/catch` + swallow as `reportProgress`.

Level mapping (8 MCP levels → 4 project levels):

| MCP level   | Project level |
| ----------- | ------------- |
| `debug`     | `debug`       |
| `info`      | `info`        |
| `notice`    | `info`        |
| `warning`   | `warn`        |
| `error`     | `error`       |
| `critical`  | `error`       |
| `alert`     | `error`       |
| `emergency` | `error`       |

The dispatcher closes over `tool.name` so `log()` tags every `notifications/message` with the tool's name automatically — handlers don't repeat themselves.

## 5. `McpServer` capabilities — [`src/server/mcp-server.ts`](../../../src/server/mcp-server.ts)

The constructor's `capabilities` block adds `logging: {}`:

```ts
capabilities: {
  tools: {},
  logging: {},
},
```

This advertises that the server accepts `logging/setLevel` requests. The MCP TS SDK's `McpServer` handles `setLevel` automatically once the capability is declared. No handler in this PR consults the level — see §10 for the risk note on filtering.

`progress` is **not** declared as a separate capability. Per the MCP spec, progress is per-request opt-in: the client sends `_meta.progressToken`, the server reports against it. There is no `progress: {}` capability slot.

## 6. Adapter cleanup

The single caller of `ObsidianAdapter.searchContent` is the worked-example handler, which inlines the loop. Therefore:

- [`src/obsidian/adapter.ts`](../../../src/obsidian/adapter.ts) — remove `searchContent` from the `ObsidianAdapter` interface AND the implementation.
- [`src/obsidian/mock-adapter.ts`](../../../src/obsidian/mock-adapter.ts) — remove the mock implementation.
- No tests reference `searchContent` directly (verified by grep at design time).

## 7. Worked example — `search_fulltext` handler

[`src/tools/search/handlers.ts`](../../../src/tools/search/handlers.ts) — `searchFulltext` rewritten to consume `ToolContext`:

```ts
async searchFulltext(params, ctx): Promise<CallToolResult> {
  try {
    const lowerQuery = params.query.toLowerCase();
    const allFiles = adapter.getAllFiles();
    const total = allFiles.length;
    const results: Array<{ path: string; matches: string[] }> = [];

    let lastPct = -1;
    for (let i = 0; i < total; i++) {
      if (ctx?.signal.aborted) {
        throw new Error('Cancelled');
      }
      const path = allFiles[i];
      const content = await adapter.readFile(path);
      if (content.toLowerCase().includes(lowerQuery)) {
        const matches = content
          .split('\n')
          .filter((line) => line.toLowerCase().includes(lowerQuery));
        results.push({ path, matches });
      }
      if (ctx) {
        const pct = total === 0 ? 100 : Math.floor(((i + 1) / total) * 100);
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
    // existing pagination + makeResponse + truncateText path, unchanged
  } catch (error) {
    return handleToolError(error);
  }
}
```

Notes:

- `ctx` is optional — direct-call tests (`tool.handler({ query: 'foo' })`) keep working with one arg.
- `ctx?.signal.aborted` check at the top of every iteration. `Cancelled` is a plain `Error`; `handleToolError` routes it through the standard envelope. No new error subclass — YAGNI for one example.
- The outer `if (ctx)` guard around the progress block exists so the no-arg test path (`tool.handler({ … })`) doesn't dereference `undefined`. Under the dispatcher, `ctx` is always defined; if the client did not send `_meta.progressToken`, `reportProgress` is internally a no-op.
- `SearchHandlers.searchFulltext` interface signature in the same file widens to `(params, ctx?: ToolContext) => Promise<CallToolResult>`.

The previous `adapter.searchContent(query)` call goes away; the per-file scan now lives in the handler.

## 8. Tests

Three locations:

### 8.1 New file — [`tests/registry/tool-context.test.ts`](../../../tests/registry/tool-context.test.ts)

Direct unit tests for `createToolContext`. `extra` is a hand-built fake; no SDK or `McpServer` involved.

- `reportProgress` is a no-op when `progressToken === undefined` (assert `sendNotification` not called).
- `reportProgress` calls `sendNotification` with `method: 'notifications/progress'` and the right `params` shape when `progressToken` is set.
- `reportProgress` swallows `sendNotification` errors and calls `logger.warn`.
- `log('info', 'msg', { x: 1 })`:
  - calls `logger.info('msg', { x: 1 })`,
  - calls `sendNotification` with `method: 'notifications/message'`, `params.level === 'info'`, `params.logger === '<tool name>'`,
  - shape of `params.data` matches the spec (`{ msg, data? }`).
- Level mapping table (8 cases) — each MCP level dispatches to the expected project `LogLevel`.
- `signal` and `progressToken` are surfaced verbatim from `extra`.

### 8.2 Additions — [`tests/server/mcp-server.test.ts`](../../../tests/server/mcp-server.test.ts)

The existing file mocks the SDK and captures constructor args / registered tools.

- Constructor capabilities now include `logging: {}` (existing capabilities check expanded).
- `createToolDispatcher` cases for the second arg:
  - When invoked with `(params, extra)`, the handler receives `(parsed, ctx)` where `ctx.signal === extra.signal` and `ctx.progressToken === extra._meta?.progressToken`.
  - `ctx.reportProgress` round-trips into `extra.sendNotification` with the progress params shape.
  - `ctx.log` round-trips into `extra.sendNotification` with the message params AND fans out to the `Logger` mock.
- Existing dispatcher tests (Zod error envelope, handler-throws envelope) keep passing — they pass a no-op stub `extra` to satisfy the new signature.

### 8.3 Additions — [`tests/tools/search/search.test.ts`](../../../tests/tools/search/search.test.ts)

Existing file already exercises `search_fulltext` against the mock adapter. New cases:

- `signal.aborted` set before invocation → handler returns the standard error envelope; iteration stops at the first check (`readFile` not called).
- `signal.aborted` flips mid-run (after 2 of 5 files) → handler throws `Cancelled`, caught by `handleToolError`, error envelope returned; remaining files not read (assert `readFile` call count on the mock).
- `progressToken` set → `ctx.reportProgress` called at integer-percent boundaries; final call has `progress === total`.
- `progressToken` undefined → `ctx.reportProgress` never reaches `sendNotification` (assert via stub).
- Backwards-compat: `tool.handler({ query: 'foo' })` with no `ctx` still works (no abort, no progress, returns results).

No tests removed.

## 9. Documentation

- [`docs/help/en.md`](../../help/en.md): **no changes**. Refactor is internal — no settings, commands, modals, or tool registry surface changes are user-visible. `search_fulltext` keeps its name, schema, output shape, and error envelope.
- [`docs/tools.generated.md`](../../tools.generated.md): **no regeneration**. Tool registry unchanged.
- Locale siblings: none to update (no en.md change).

## 10. Risks and notes

- **SDK level filtering for `notifications/message`.** The MCP TS SDK is expected to filter by client `setLevel`. If it does not, this PR over-emits at debug — harmless on the wire, mildly noisy. Mitigation: monitor; add explicit filtering inside `ctx.log` if needed in a follow-up. Not worth the complexity today.
- **Notification backpressure.** `sendNotification` is awaited per progress emit. A slow transport could measurably stretch a tool call. Mitigation: bucketed-percent cadence caps emits at ~100 per call, well below realistic backpressure thresholds. Errors are caught and swallowed (logged via `Logger`) so a flaky transport never aborts the tool.
- **Test backwards-compat surface.** Direct `tool.handler({ … })` calls in existing tests rely on `ctx` being optional. The `?` on `TypedHandler`'s second parameter encodes that; lint + tsc + the existing test suite verify it on every CI run.
- **`Cancelled` error shape.** A plain `Error('Cancelled')` is routed through `handleToolError` as a generic error. Future work may add a typed `CancelledError` with a distinct error code if clients want to distinguish. YAGNI for the worked example.

## 11. Out of scope

- Re-introducing `ui_confirm` / `ui_prompt` via elicitation — separate follow-up; soft-depends on this PR.
- Sampling-based tools — separate follow-up; soft-depends on this PR.
- Per-tool progress wiring beyond `search_fulltext` (`vault_list_recursive`, `plugin_dataview_query`, …) — pattern is established here; copying it elsewhere is mechanical follow-up work.
- `clientCapabilities` accessor on `ToolContext` — added when the first real consumer lands.
- Migrating existing in-handler `logger.*` calls to `ctx.log` — this PR introduces the mechanism; sweeps come later case-by-case.
- Changes to the SDK version, transport selection, or `initialize` response handling.

## 12. Branching, commits, PR

- **Branch:** `refactor/issue-291-thread-sdk-extra-through-typed-handler`
- **Commit type:** `refactor(registry,server)` (matches issue title scope).
- **PR title:** `refactor(registry,server): thread SDK extra arg through TypedHandler` — Conventional Commits.
- **PR body:**
  - `Closes #291`.
  - **Summary** (3 bullets): `TypedHandler` accepts curated `ToolContext`; dispatcher fans out into `notifications/progress` + `notifications/message`; `search_fulltext` worked example demonstrates progress + cancellation.
  - **Test plan**: the three test files above + `npm run lint` + `npm run typecheck`.

## 13. References

- Issue [#291](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/291)
- Parent tracker [#258](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/258)
- Campaign plan [`docs/superpowers/specs/2026-05-02-mcp-builder-review-followup-design.md`](2026-05-02-mcp-builder-review-followup-design.md)
- `mcp-server-dev:build-mcp-server` skill — `references/server-capabilities.md` (Sampling, Logging, Progress, Cancellation, Elicitation)
- Prior elicitation removal: [#254](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/254)
