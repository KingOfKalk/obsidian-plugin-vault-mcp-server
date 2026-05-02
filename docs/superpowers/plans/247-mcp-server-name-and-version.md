# Plan: MCP server name and version fix (Issue #247)

## Goal

Make the MCP `serverInfo` advertised on the protocol handshake match the
`{service}-mcp-server` convention and reflect the real plugin version
from `manifest.json` instead of the hardcoded `'0.0.0'`.

## Approach

### 1. Read `manifest.json` via static JSON import

`tsconfig.json` already has `resolveJsonModule: true` and `esModuleInterop: true`,
and esbuild bundles JSON imports natively. Use a default import:

```ts
import manifest from '../../manifest.json';
```

No `assert { type: 'json' }` needed — `module: ESNext` + `moduleResolution: bundler`
plus esbuild handle this without import assertions, and the test runner
(vitest) inherits the same TS config.

The repo has no existing JSON imports in `src/`, so we are not deviating
from a prior pattern; this is the simplest path that keeps the build infra
untouched (Option A from the issue).

### 2. Update the SDK constructor call (`src/server/mcp-server.ts`)

```ts
import manifest from '../../manifest.json';
// ...
new McpServer(
  { name: 'obsidian-mcp-server', version: manifest.version },
  { capabilities: { tools: {} } },
);
```

Only the two literal strings change (`obsidian-mcp` → `obsidian-mcp-server`,
`'0.0.0'` → `manifest.version`). No other behaviour, no other files.

### 3. Test (`tests/server/mcp-server.test.ts`, new file)

The MCP SDK's `McpServer` exposes the underlying `Server` via a public
`server` property, but stores `_serverInfo` privately (`server/index.d.ts`)
with no public accessor. We have two options:

- **Option A:** cast through `unknown` to a narrow shape and read
  `server._serverInfo`. Brittle if the SDK renames the field.
- **Option B:** mock `@modelcontextprotocol/sdk/server/mcp.js` and capture
  the constructor argument with `vi.fn()`.

Pick **Option B** — it is robust against SDK internals and matches the
test's intent (we want to verify what we hand the SDK, not what the SDK
stores). Reuse the same `manifest.version` import in the test so the
assertion stays correct on every release bump.

Test cases:

- `serverInfo.name === 'obsidian-mcp-server'` after `createMcpServer(...)`.
- `serverInfo.version === manifest.version` (string-equal to the imported
  manifest).
- Sanity: capabilities include `tools`.

Use `vi.mock('@modelcontextprotocol/sdk/server/mcp.js', ...)` with a stub
class that records its constructor args and exposes `registerTool` /
`server` so `createMcpServer` can finish without throwing.

## Files touched

- `src/server/mcp-server.ts` — JSON import + two literal changes.
- `tests/server/mcp-server.test.ts` — new test file (does NOT replace
  `tests/server/dispatcher.test.ts`, which covers `createToolDispatcher`).
- `docs/superpowers/plans/247-mcp-server-name-and-version.md` — this plan.

## Out of scope

- `package.json#name`, `manifest.json#id`, repo name, branding, docs copy.
- Any user-facing string. This is a protocol-handshake-only change.

## Caveats

- The MCP SDK `Server` does not expose a public `getServerInfo()`-style
  accessor; that's why we mock at the constructor boundary instead.
- If a future SDK version exposes `serverInfo` publicly, the test can be
  simplified to read it from a real `McpServer`, but the production change
  is unaffected.

## Verification

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build` (catches any JSON-import issue at bundle time)
