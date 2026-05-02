# Design — `outputSchema` declarations for read-tool batches B / C / D

- **Date:** 2026-05-02
- **Closes:** [#276](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/276), [#277](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/277), [#278](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/278)
- **Refs:** [#258](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/258) (campaign tracker), [#248](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/248) / [PR #279](https://github.com/KingOfKalk/obsidian-plugin-mcp/pull/279) (framework + Batch A)
- **Status:** Approved design; per-issue implementation plans follow separately.

## 1. Goal

Close the three remaining `outputSchema` follow-ups by declaring schemas for every read tool that emits `structuredContent`, so modern MCP clients can validate and introspect the typed payload. No framework changes — `ToolDefinition` already carries the optional field and `registerTools` already forwards it (PR #279).

## 2. Locked decisions

Captured during the brainstorming session:

- **`vault_read_binary` retrofit (#278):** Option A — restructure the structured payload to `{ path, data, encoding: 'base64', size_bytes }` and declare an `outputSchema`. The plain-text rendering remains the bare base64 string, so existing `result.content[0].text` callers see no change.
- **Opaque workspace shapes (#277):** Option A — `workspace_get_active_leaf` and `workspace_get_layout` use `.passthrough()` parse tests. Schemas declare the documented fields the adapter actually returns; `.passthrough()` insulates against Obsidian internal additions.
- **PR cadence:** Option A — three independent PRs, one per issue, in the order B → C → D. Matches the campaign plan's 1:1 issue-to-PR baseline.
- **Scope additions:** Option A — Batch B's `vault_get_*` getters get their schemas where the tools live today (`src/tools/vault/index.ts`, post-#255). Batch D includes `plugin_dataview_describe_js_query`, `plugin_templater_describe_template`, and `template_expand` per the issues' "plus any other read-only entries" clauses.

## 3. Shape of the work

Three independent PRs (B → C → D), each:

- Adds module-level `outputSchema` consts in the affected `*/index.ts` (mirroring [`src/tools/vault/index.ts:38-82`](../../../src/tools/vault/index.ts#L38-L82)).
- Adds a `<module> read tools — outputSchema declarations` describe block to the existing module test file (mirroring [`tests/tools/vault/module.test.ts:77-202`](../../../tests/tools/vault/module.test.ts#L77-L202)). The naming convention is `tests/tools/<module>/<module>.test.ts` for every module except `vault`, which uses `tests/tools/vault/module.test.ts`. Add to the existing file rather than creating a new one.
- Uses `z.object(shape).strict().parse(...)` — except for the two opaque workspace tools, which use `.passthrough()`.
- Regenerates `docs/tools.generated.md` via `npm run docs:tools`.
- Runs `npm run lint`, `npm test`, `npm run typecheck`, `npm run docs:check` clean.
- Conventional Commits per project rule 1 + 7; `Refs #<issue>` and `Refs #258` in commit bodies; `Closes #<issue>` in PR body.

Grand total across the three PRs: **29 `outputSchema` declarations + ~29 strict-mode parse tests + 1 handler retrofit**.

## 4. PR-by-PR scope

### PR 1 — Batch B (#276)

- **Branch:** `feat/issue-276-output-schema-search`
- **`src/tools/search/index.ts`** — declare `outputSchema` on 6 tools:
  - `search_fulltext`, `search_tags`, `search_resolved_links`, `search_unresolved_links`, `search_by_tag`, `search_by_frontmatter`
- **`src/tools/vault/index.ts`** — declare `outputSchema` on the 6 single-path getters renamed from `search_get_*` by #255 (use search handlers but live in the vault module today):
  - `vault_get_frontmatter`, `vault_get_headings`, `vault_get_outgoing_links`, `vault_get_embeds`, `vault_get_backlinks`, `vault_get_block_references`
- **Tests:**
  - New `describe('search read tools — outputSchema declarations', …)` in `tests/tools/search/search.test.ts` for the 6 search tools.
  - Extend the existing `describe('vault read tools — outputSchema declarations', …)` block in `tests/tools/vault/module.test.ts` with parse-validation for the 6 `vault_get_*` getters.
- **PR body:** notes that the issue's `src/tools/search/index.ts` location guidance is partly stale post-#255 — getters get their schema in `vault/index.ts` (where they live), search-prefixed tools in `search/index.ts`. **Closes #276.**
- Total: 12 schemas, ~12 parse tests.

### PR 2 — Batch C (#277)

- **Branch:** `feat/issue-277-output-schema-workspace-editor`
- **`src/tools/workspace/index.ts`** — declare `outputSchema` on 3 tools:
  - `workspace_get_active_leaf` (permissive, `.passthrough()` test), `workspace_list_leaves` (strict), `workspace_get_layout` (permissive, `.passthrough()` test).
- **`src/tools/editor/index.ts`** — declare `outputSchema` on 5 tools:
  - `editor_get_content`, `editor_get_active_file`, `editor_get_cursor`, `editor_get_selection`, `editor_get_line_count` (all strict).
- **Tests:** new `describe(...)` blocks in `tests/tools/workspace/workspace.test.ts` and `tests/tools/editor/editor.test.ts`. Permissive tools use `z.object(shape).passthrough().parse(...)` — clearly commented as the documented exception.
- **PR body:** notes the two permissive schemas + reason. **Closes #277.**
- Total: 8 schemas, ~8 parse tests.

### PR 3 — Batch D (#278)

- **Branch:** `feat/issue-278-output-schema-extras-interop-templates-binary`
- **`src/tools/extras/index.ts`** — `extras_get_date` (1 schema).
- **`src/tools/plugin-interop/index.ts`** — 5 schemas: `plugin_list`, `plugin_check`, `plugin_dataview_query`, `plugin_dataview_describe_js_query`, `plugin_templater_describe_template`.
- **`src/tools/templates/index.ts`** — 2 schemas: `template_list`, `template_expand`.
- **`src/tools/vault/{handlers,index}.ts`** — retrofit `vault_read_binary` to emit `structuredContent: { path, data, encoding: 'base64', size_bytes }` via `makeResponse(...)`. Plain-text rendering stays as the bare base64 string. Update the tool description's "Returns" line to reflect the structured shape under `response_format: 'json'`.
- **Tests:** new describe blocks in `tests/tools/extras/extras.test.ts`, `tests/tools/plugin-interop/plugin-interop.test.ts`, `tests/tools/templates/templates.test.ts`. In `tests/tools/vault/module.test.ts:194-201`, flip the "intentionally omits outputSchema" assertion to a positive parse test (see Section 6).
- **PR body:** explicitly records the locked Option A retrofit decision for `vault_read_binary` and lists the three scope-addition tools per the issue's "plus any other read-only entries" clause. **Closes #278.**
- Total: 9 schemas, ~9 parse tests, 1 handler retrofit.

## 5. Exact `outputSchema` shapes per tool

Verified against handler implementations and adapter signatures. All shapes are `z.ZodRawShape` literals matching what the handler puts on `result.structuredContent`.

### Batch B — search module (`src/tools/search/index.ts`)

```ts
// Pagination shape reused by 3 search tools
const paginatedStringPage = {
  total: z.number(), count: z.number(), offset: z.number(),
  items: z.array(z.string()),
  has_more: z.boolean(), next_offset: z.number().optional(),
};

// search_fulltext — page of { path, matches: string[] }
{
  total: z.number(), count: z.number(), offset: z.number(),
  items: z.array(z.object({ path: z.string(), matches: z.array(z.string()) })),
  has_more: z.boolean(), next_offset: z.number().optional(),
}
// search_tags
{ tags: z.record(z.string(), z.array(z.string())) }
// search_resolved_links / search_unresolved_links (same shape)
{ links: z.record(z.string(), z.record(z.string(), z.number())) }
// search_by_tag / search_by_frontmatter — page of strings
paginatedStringPage
```

### Batch B — vault module (`src/tools/vault/index.ts`), the 6 ex-`search_get_*` getters

```ts
// vault_get_frontmatter
{ path: z.string(), frontmatter: z.record(z.string(), z.unknown()) }
// vault_get_headings
{ path: z.string(),
  headings: z.array(z.object({ heading: z.string(), level: z.number() })) }
// vault_get_outgoing_links / vault_get_embeds (same shape, different field name)
{ path: z.string(),
  links /* embeds */: z.array(z.object({ link: z.string(), displayText: z.string().optional() })) }
// vault_get_backlinks
{ path: z.string(), backlinks: z.array(z.string()) }
// vault_get_block_references
{ path: z.string(),
  blockRefs: z.array(z.object({ id: z.string(), line: z.string() })) }
```

### Batch C — workspace (`src/tools/workspace/index.ts`)

```ts
// workspace_get_active_leaf — adapter returns { id, type, filePath } today;
// Obsidian may add more fields. Test uses .passthrough(); schema declares the known three.
{ id: z.string(), type: z.string(), filePath: z.string().nullable() }
// workspace_list_leaves — strict
{ leaves: z.array(z.object({ leafId: z.string(), path: z.string() })) }
// workspace_get_layout — fully opaque (adapter passes through Obsidian's getLayout()).
// Empty raw shape + .passthrough() in test = "an object, contents not described".
{} /* with .passthrough() in the parse test */
```

### Batch C — editor (`src/tools/editor/index.ts`)

```ts
// editor_get_content
{ content: z.string() }
// editor_get_active_file
{ path: z.string() }
// editor_get_cursor
{ line: z.number(), ch: z.number() }
// editor_get_selection
{ from: z.object({ line: z.number(), ch: z.number() }),
  to:   z.object({ line: z.number(), ch: z.number() }),
  text: z.string() }
// editor_get_line_count
{ lineCount: z.number() }
```

### Batch D — extras / plugin-interop / templates

```ts
// extras_get_date
{ iso: z.string() }
// plugin_list — adapter typed as Array<{ id, name, enabled }>
{ plugins: z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean() })) }
// plugin_check
{ pluginId: z.string(), installed: z.boolean(), enabled: z.boolean() }
// plugin_dataview_query
{ query: z.string(), markdown: z.string() }
// plugin_dataview_describe_js_query
{ query: z.string(), note: z.string() }
// plugin_templater_describe_template
{ templatePath: z.string(), note: z.string() }
// template_list
{ files: z.array(z.string()) }
// template_expand
{ expanded: z.string() }
```

### Batch D — `vault_read_binary` retrofit (`src/tools/vault/{handlers,index}.ts`)

```ts
// Handler: replace `textResult(base64)` with
//   makeResponse(
//     { path, data: base64, encoding: 'base64' as const, size_bytes: data.byteLength },
//     (v) => v.data,
//     readResponseFormat(params),
//   )
// Index outputSchema:
{
  path: z.string(),
  data: z.string(),
  encoding: z.literal('base64'),
  size_bytes: z.number(),
}
```

## 6. Test pattern

Mirrors `tests/tools/vault/module.test.ts:77-202`. Each module's test file gets one new `describe('<module> read tools — outputSchema declarations', …)` block with two helpers and one `it(...)` per tool.

```ts
function getStructured(
  tool: { outputSchema?: z.ZodRawShape },
  { passthrough = false } = {},
): z.ZodObject<z.ZodRawShape> {
  if (!tool.outputSchema) throw new Error('expected outputSchema to be declared');
  const obj = z.object(tool.outputSchema);
  return passthrough ? obj.passthrough() : obj.strict();
}

function findTool(name: string): { name: string; outputSchema?: z.ZodRawShape } {
  const adapter = new MockObsidianAdapter();
  const tool = createXModule(adapter).tools().find(t => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}
```

Each `it(...)`:

1. Builds a small fixture via `MockObsidianAdapter` (existing helpers like `addFile`, `addFolder`).
2. Calls the handler directly with `response_format: 'json'` so `result.structuredContent` is populated.
3. `schema.parse(result.structuredContent)` — the parse is the assertion; the test fails loudly if any field is missing, mistyped, or extra (under strict mode).

### Strict vs. passthrough policy

- **Default: strict.** Catches drift between renderer and structured payload — the original `mcp-builder` motivation.
- **Two documented exceptions in Batch C:**
  - `workspace_get_active_leaf` — `getStructured(tool, { passthrough: true })`, with an inline comment: `// Obsidian's leaf state may carry additional fields beyond { id, type, filePath } in future versions; .passthrough() absorbs those without test churn.`
  - `workspace_get_layout` — same call, same comment phrased for the layout descriptor. Schema is `{}`, so the test only asserts that `structuredContent` is an object (`expect(typeof parsed).toBe('object')`).

### Pagination coverage in Batch B

For `search_fulltext`, `search_by_tag`, and `search_by_frontmatter` — mirror PR #279's two-case pattern: one fixture small enough that `has_more=false` (asserts `next_offset` is absent) and one with `limit` low enough to force `has_more=true` (asserts `next_offset` matches `offset + count`). This catches drift in pagination metadata, which is the most pagination-aware part of the surface.

### `vault_read_binary` test flip in Batch D

`tests/tools/vault/module.test.ts:194-201` currently asserts the absence:

```ts
it('vault_read_binary intentionally omits outputSchema (no structuredContent emitted)', () => { ... });
```

Becomes:

```ts
it('vault_read_binary declares outputSchema and structuredContent parses against it', async () => {
  const tool = findTool('vault_read_binary');
  const schema = getStructured(tool);
  const adapter = new MockObsidianAdapter();
  // Use whichever binary-fixture helper the mock adapter exposes (addBinaryFile or
  // direct `setFileContents` with a Buffer); confirmed at implementation time.
  adapter.addBinaryFile('img.png', Uint8Array.from([0xff, 0xd8, 0xff]));
  const handlers = createHandlers(adapter, new WriteMutex());
  const result = await handlers.readBinary({ path: 'img.png', response_format: 'json' });
  const parsed = schema.parse(result.structuredContent);
  expect(parsed).toEqual({
    path: 'img.png', data: '/9j/', encoding: 'base64', size_bytes: 3,
  });
});
```

A second `it(...)` for `vault_read_binary` asserts that `response_format: 'text'` (the default) still returns the bare base64 string in `result.content[0].text` — pins the no-callsite-churn promise.

## 7. Docs, commits, PR plumbing

### Per-PR doc updates

- **`docs/tools.generated.md`** — regenerate via `npm run docs:tools` in every PR. The current generator only lists tool names, so the file is unchanged for B and C (no new tools, no renames). Batch D's `vault_read_binary` description gains a structured-shape line; whether that surfaces in the generated doc depends on the generator. Run `npm run docs:check` either way; CI fails otherwise (project rule 5).
- **`docs/help/en.md`** — only Batch D needs a touch: the `vault_read_binary` entry's "Returns" line gains a one-liner about the structured payload. B and C are pure protocol-level additions (no user-visible surface change) — no help-doc update required. Project rule 5 is satisfied because no user-facing surface is altered for B/C.

### Commit plan, per PR

Default: one commit per PR.

- **PR 1 (Batch B, #276):** `feat(tools/search,vault): declare outputSchema for read tools`. Body: `Refs #276`, `Refs #258`. PR body explains the cross-module split (search-prefixed tools in `search/index.ts`; `vault_get_*` getters in `vault/index.ts`) and notes that the issue's location guidance was partly stale post-#255.
- **PR 2 (Batch C, #277):** `feat(tools/workspace,editor): declare outputSchema for read tools`. Body: `Refs #277`, `Refs #258`. PR body lists the two `.passthrough()` exceptions and the reason.
- **PR 3 (Batch D, #278):** split into two commits — the binary retrofit is a payload change, not a pure declaration:
  1. `feat(tools/vault): structuredContent for vault_read_binary` — handler change + index `outputSchema` + test flip + help-doc tweak.
  2. `feat(tools/extras,plugin-interop,templates): declare outputSchema for read tools` — pure declarative work.
  Both commits cite `Refs #278`, `Refs #258`. PR body records the locked Option A retrofit decision and lists the three scope-addition tools per the issue's "plus any other read-only entries" clause. **Closes #278.**

### Branch names

- `feat/issue-276-output-schema-search`
- `feat/issue-277-output-schema-workspace-editor`
- `feat/issue-278-output-schema-extras-interop-templates-binary`

### Cadence

Strict serial. Open PR 1, wait for user merge; rebase/branch from updated `main` for PR 2; same for PR 3. Matches the campaign plan and project workflow §7.

### Verification gate per PR

Per project workflow §4:

1. `npm test` — all green.
2. `npm run lint` — clean.
3. `npm run typecheck` — clean.
4. `npm run docs:check` — clean.

## 8. Risks and non-issues

- **Type-system churn — none.** PR #279 already typed `outputSchema?: z.ZodRawShape` as optional on `ToolDefinition`; adding more declarations does not propagate type changes anywhere. Confirmed by the framework PR's note ("`npm run typecheck` stays clean across the whole codebase without touching any other tool definition").
- **Schema drift** — guarded by strict-mode parse tests for 27 of 29 tools. The two passthrough exceptions are documented and tested; their failure mode is "Obsidian internal shape changed in a way the renderer also didn't expect", which is rare and would surface as a renderer crash before the schema becomes visibly wrong.
- **`vault_read_binary` retrofit blast radius** — minimal. Plain-text rendering stays unchanged; only `response_format: 'json'` callers see the new fields, and they were already getting nothing structured before this PR. The Returns docstring is the only user-visible change.

## 9. Out of scope

- Restructuring `structuredContent` payloads for any tool other than `vault_read_binary` — keep existing shapes, only describe them (per #248's original out-of-scope clause).
- Write/destructive tools — they emit confirmation lines; `outputSchema` is low-value (covered by #216's exclusion list).
- Any work on tools registered in modules not named in this design (e.g. UI, if it gains read tools later).
