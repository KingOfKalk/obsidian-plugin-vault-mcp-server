# Plan: unify dispatcher error handling (#257)

## Problem

`createToolDispatcher` in `src/server/mcp-server.ts` has two `try`/`catch` blocks:

- The parse block catches `ZodError` cleanly but **rethrows anything else** — so a non-Zod throw from inside a custom `.refine()` (or any other parse-time crash) escapes the dispatcher and surfaces as a transport-level protocol error instead of a tool-level error.
- The handler block catches *every* error and produces an `isError` envelope inline, duplicating logic that already lives in `handleToolError` from `src/tools/shared/errors.ts`.

mcp-builder's rule: tool errors must be reported within the result, never as protocol errors. So the parse and handle phases need a single, consistent error policy.

## Approach

Collapse the two blocks into one `try` covering both `inputSchema.parse(...)` and `await tool.handler(parsed)`. Inside a single `catch`:

- `ZodError` → keep the existing friendlier message format that joins issue paths (richer than `handleToolError`'s ZodError branch). Log at `warn`. Return the existing `Invalid arguments: …` envelope.
- Anything else (parse-time non-Zod throw OR handler-time throw) → log at `error` with the full `Error` object passed as structured `data` so the stack is captured server-side. Return `handleToolError(error)`.

This delegates handler-time error formatting (typed errors like `PermissionError`, `NotFoundError`, etc.) to the shared helper instead of the inline `Error: <message>` string the dispatcher used to build.

## Logger signature for stack capture

`src/utils/logger.ts` exposes `error(message: string, data?: unknown): void`. The `data` param is included in the log entry as a structured field and serialized through the JSON sink. Passing the raw `Error` object as `data` is exactly the right call — `JSON.stringify(error)` of a plain `Error` only captures own enumerable properties, but the logger's `redactUnknown` walks own enumerable keys too, so the practical behaviour is fine for our tests (we only assert that the logger was called at `error` with the error in the data position).

To make the stack actually visible in the structured log we'll pass an object that explicitly extracts `error` (the original) so consumers can introspect — concretely: `logger.error('Tool "X" error', error)`. The existing logger contract is `data?: unknown` so passing the Error directly is type-safe.

No fallback needed — `Logger.error` accepts the second `data` argument.

## Zod message format kept vs deferred

Kept (in dispatcher): the path-joined `Invalid arguments: foo: required; bar: must be string` message — friendlier than the shared helper's variant.

Deferred to `handleToolError`: nothing for the Zod branch — we keep both formats since callers of `handleToolError` outside the dispatcher still want its built-in ZodError formatting. The dispatcher's branch wins for the dispatcher path; `handleToolError` keeps its branch for direct callers.

## Tests

Add to `tests/server/mcp-server.test.ts`:

- (a) **ZodError from invalid input** — schema requires `foo: z.string()`, call with `{ foo: 123 }`. Assert `isError: true`, content text starts with `Invalid arguments:`. Assert `logger.warn` was called and `logger.error` was not.
- (b) **Non-Zod error from parse path** — schema includes `foo: z.string().refine((v) => { if (v === 'crash') throw new Error('boom'); return true; })`. Call with `{ foo: 'crash' }`. Assert `isError: true`, content text starts with `Error:` (per `handleToolError`'s fallback branch). Assert response does NOT contain `'boom'`'s stack frames (i.e. no `at ` lines and no file paths). Assert `logger.error` was called with the Error as `data`.
- (c) **Handler throws plain Error** — handler returns `Promise.reject(new Error('handler boom'))`. Assert `isError: true`, content text matches `handleToolError` plain-Error formatting (`Error: handler boom`). Assert `logger.error` was called.
- (d) **Handler throws typed error** — handler throws `new PermissionError('no access')`. Assert response content text is `Error: Permission denied: no access` (per `handleToolError`'s `PermissionError` branch). Pins the integration with `handleToolError`'s typed-error path.

The tests exercise `createToolDispatcher` directly — the fake `McpServer` mock is irrelevant for these. Spy on the logger by passing a `Logger` whose `warn`/`error` methods are wrapped with `vi.fn()` (or via `vi.spyOn`).

## Implementation steps

1. Plan commit: `docs(plans/257)`.
2. Add the four new tests (TDD-first). Confirm (b) and (d) fail against the current code, (a) and (c) likely pass already in form (we're extending coverage).
3. Refactor `createToolDispatcher` to single try/catch routing through `handleToolError` for non-Zod errors. Import `handleToolError` from `../tools/shared/errors`.
4. Confirm tests pass; run `npm run lint` + `npm run typecheck`.
5. Single implementation commit: `chore(server/mcp): unify error handling between input parsing and handler execution`.

## Risk / non-goals

- No change to `handleToolError`. No change to typed error classes. No new error types.
- No change to user-facing manual — this is internal error-routing plumbing, no settings/tool surface affected.
- No change to public API of `createToolDispatcher` (signature, return type, exported name all preserved).
