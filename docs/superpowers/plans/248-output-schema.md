# Issue #248 — declare `outputSchema` on tools and forward to `registerTool`

Refs #248. Builds on #216 (`structuredContent` rollout to read tools).

## Goal

1. Extend the registry's `ToolDefinition` with an optional `outputSchema`.
2. Forward it through `registerTools()` into the MCP SDK's `server.registerTool` call.
3. Declare `outputSchema` for the **Batch A** vault read tools so modern clients can validate / discover the shape of `structuredContent`.
4. File follow-up issues for Batches B, C, D before opening the PR.

## Design choices

### `outputSchema` typing

Use the **simpler single-generic shape** with `outputSchema?: z.ZodRawShape` (mirrors how `schema` is typed). Reasons:

- `defineTool` already erases the generic via `as unknown as ToolDefinition`, so adding an optional field with `z.ZodRawShape` does not propagate type-inference churn through every call site.
- The MCP SDK's `registerTool` accepts a `ZodRawShape`-shaped object for `outputSchema` — same shape as `inputSchema`.
- The two-generic form `<Shape, Out>` is nicer in theory but forces every existing `defineTool({...})` invocation to either declare both generics or rely on inference for `Out`, which TypeScript struggles with when the field is omitted. Not worth the churn for a framework-level change.

If `z.ZodRawShape` doesn't compile cleanly we fall back to `z.ZodTypeAny` — but it should compile, because `schema: Shape` already uses the same kind of typing.

### Forwarding pattern in `registerTools`

The SDK already accepts `outputSchema: undefined` and treats it as "no output schema declared". So the forward is a single field addition:

```ts
server.registerTool(
  tool.name,
  {
    description: tool.description,
    inputSchema: tool.schema,
    outputSchema: tool.outputSchema,  // undefined when not declared
    annotations: tool.annotations,
  },
  createToolDispatcher(tool, logger),
);
```

No conditional logic — unconditional pass-through keeps the registration site simple.

## Batch A scope and shapes

The five Batch A tools listed in the issue, with the exact `structuredContent` each handler emits today (read from `src/tools/vault/handlers.ts` + `src/tools/shared/response.ts`):

### 1. `vault_read` — handler emits `{ path, content }`

```ts
outputSchema: {
  path: z.string(),
  content: z.string(),
}
```

### 2. `vault_get_metadata` — handler emits `{ path, size, created, modified }`

```ts
outputSchema: {
  path: z.string(),
  size: z.number(),
  created: z.string(),   // ISO-8601 timestamp
  modified: z.string(),  // ISO-8601 timestamp
}
```

### 3. `vault_list` — handler emits `{ files: string[], folders: string[] }` (the raw `adapter.list(path)` result)

```ts
outputSchema: {
  files: z.array(z.string()),
  folders: z.array(z.string()),
}
```

### 4. `vault_list_recursive` — handler emits `{ folders: string[], ...PaginatedResponse<string> }`

The `paginate()` helper produces `{ total, count, offset, items, has_more, next_offset? }`. The handler spreads that page in alongside `folders`:

```ts
outputSchema: {
  folders: z.array(z.string()),
  total: z.number(),
  count: z.number(),
  offset: z.number(),
  items: z.array(z.string()),
  has_more: z.boolean(),
  next_offset: z.number().optional(),
}
```

### 5. `vault_read_binary` — **deferred, NOT shipped in this PR**

`vault_read_binary` returns `textResult(base64)` — it has **no** `structuredContent` slot. PR #216 deliberately left binary read out of the structured-content rollout. Declaring `outputSchema` on a tool that does not emit `structuredContent` would violate the MCP protocol (the SDK requires `structuredContent` whenever `outputSchema` is present).

Rather than retrofit `structuredContent` into the binary handler (out of scope per issue: "Restructuring `structuredContent` payloads — keep the existing shapes, only describe them"), defer `vault_read_binary` to a follow-up issue alongside Batches B/C/D. Document this deviation in the PR body.

## Tests

### Framework-level (added to `tests/server/mcp-server.test.ts`)

- Mock `McpServer.registerTool` to capture the second argument (the registration options) and assert:
  - When the tool has `outputSchema` defined, the captured options carry it.
  - When the tool has no `outputSchema`, the captured options' `outputSchema` is `undefined`.
- Two tools driven through a tiny fake registry (or via a hand-built `ModuleRegistry` with a stub module).

### Per-tool (added to `tests/tools/vault/handlers.test.ts` or a new sibling)

For each Batch A tool:

- Drive the handler with a representative input.
- Assert `z.object(<outputSchema>).strict().parse(result.structuredContent)` succeeds.
- Use existing `MockObsidianAdapter` fixtures.

Concrete cases:

- `vault_read` — read a small text file, parse `{ path, content }`.
- `vault_get_metadata` — read `{ path, size, created, modified }`.
- `vault_list` — list a folder with a mix of files and subfolders.
- `vault_list_recursive` — listing with pagination metadata, exercise both `has_more=true` (asserts `next_offset`) and `has_more=false` (asserts `next_offset` absent).

The Zod parse uses `.strict()` so the test fails loudly if the handler emits an extra unexpected field — this catches drift between renderer and structured payload (the original `mcp-builder` motivation).

## Follow-up issues

Filed before opening the PR for #248:

- **Batch B (search)** — `feat(tools/search): declare outputSchema for search tools`. Scope: `search_fulltext`, `search_by_tag`, `search_by_frontmatter`, `search_resolved_links`, `search_unresolved_links`, `search_tags`, plus all the single-path getters (currently `search_get_*`, due to be renamed to `vault_get_*` by #255).
- **Batch C (workspace + editor read)** — `feat(tools/workspace+editor): declare outputSchema for read tools`. Scope: `workspace_get_active_leaf`, `workspace_list_leaves`, `workspace_get_layout`, `editor_get_content`, `editor_get_active_file`, `editor_get_cursor`, `editor_get_selection`, `editor_get_line_count`.
- **Batch D (extras + plugin-interop + templates + vault_read_binary)** — `feat(tools/extras+interop+templates): declare outputSchema for remaining read tools`. Includes `vault_read_binary` once the structured-payload retrofit decision is made.

All three labelled `enhancement`. Bodies reference #248 ("Follow-up to #248; framework already landed") and #258 (campaign tracker) via `Refs #258`.

## Commit plan

1. `docs(plans/248): plan for outputSchema framework and vault read batch` — this file.
2. `feat(registry): declare outputSchema on tools and forward to registerTool` — adds the optional field to `ToolDefinition`, forwards it from `registerTools`, plus framework-level test.
3. `feat(tools/vault): declare outputSchema for vault read tools` — adds outputSchema to the four Batch A tools that already emit `structuredContent`, plus per-tool parse-validation tests.
4. (Implicit in commit 3 if no diff) Regenerate `docs/tools.generated.md` via `npm run docs:tools`. The current generator only lists tool names, so output will be unchanged — but we run it so CI's `docs:check` passes.

Each commit body ends with `Refs #248`.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run docs:check`

All four must pass before push.
