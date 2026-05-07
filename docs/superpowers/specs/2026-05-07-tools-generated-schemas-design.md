# `docs/tools.generated.md` — per-tool schema sections

**Issue:** [#320](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/320)
**Refs:** PRD `DR8`, `TR31`, audit task `#264`
**Date:** 2026-05-07

## Goal

Close the documentation gap surfaced by the PRD audit (DR8 ⚠️). Today
`docs/tools.generated.md` lists every tool by name, title, and the
`readOnlyHint` / `destructiveHint` annotations, but nothing more. The PRD
requires a real "API reference: list of all MCP tools with parameter
schemas and example responses".

This spec covers acceptance items **#1**, **#2**, and **#4** of issue
#320 (input schemas, output schemas where declared, `npm run docs:check`
still green). Acceptance item **#3** — example request/response payloads
— is explicitly deferred to a follow-up issue (see *Out of scope* below).

## Non-goals

- Generating example request/response payloads. Deferred to a follow-up
  issue.
- Recursive rendering of nested object/array fields. The renderer is
  top-level + special-case discriminated unions; nested fields are
  documented through their parent field's `.describe()` text.
- Changing any tool's `description` / `schema` / `outputSchema`. This
  PR is purely additive in the docs pipeline.
- Moving `docs/tools.generated.md` to a new path. The existing path is
  referenced by `CLAUDE.md` and external links, so it stays as the
  index.

## Current state

- `scripts/list-tools.ts` walks the registry via `discoverModules()` and
  emits a single `docs/tools.generated.md` containing:
  - A summary table (Module ID / Name / Count / Tools).
  - Per-module annotation tables (Name / Title / readOnly / destructive).
- 50 tools across 8 modules.
- Every tool has a Zod input `schema` (`z.ZodRawShape`).
- ~15 read-style tools have an `outputSchema` (per `TR31`), most as
  `z.ZodRawShape`. `vault_get_aspect` declares a full
  `z.discriminatedUnion` instead of a raw shape.
- `npm run docs:check` regenerates the file to a tmp path and `diff`s
  against the committed copy. CI fails on drift.

## Design

### File layout

The index stays at `docs/tools.generated.md`. Per-module schema pages
live in a new `docs/tools/` directory.

```
docs/
  tools.generated.md                  ← index (existing path, stable)
  tools/
    vault.generated.md                ← per-module schema page
    editor.generated.md
    search.generated.md
    workspace.generated.md
    ui.generated.md
    templates.generated.md
    plugin-interop.generated.md
    extras.generated.md
```

The index keeps its existing summary + per-module annotation tables and
gains a "Schemas → [docs/tools/<module>.generated.md](…)" link in each
per-module section.

Each per-module page contains, for each tool in that module:

- A heading `### <tool name>` (e.g. `### vault_read`).
- The tool's `title` and `description` (verbatim from the registry).
- An "Input" sub-heading + table.
- An "Output" sub-heading + table, OR the line
  *"No `structuredContent` declared — returns plain text or binary."*
  if the tool has no `outputSchema`.

All files carry the existing `<!-- AUTO-GENERATED -->` banner.

### Renderer architecture

`scripts/list-tools.ts` becomes a thin orchestrator. Two new modules
under `scripts/render-tools/`:

- `scripts/render-tools/schema-to-table.ts` — pure functions:
  - `inputShapeToTable(shape: z.ZodRawShape): string`
  - `outputSchemaToTables(schema: z.ZodRawShape | z.ZodTypeAny | undefined): string`
  No I/O. No console output.
- `scripts/render-tools/render.ts` — composes the index and per-module
  pages from collected `ToolRow`s and the schema-table helpers.

`scripts/list-tools.ts` is responsible for:
- Calling `collectToolRows()` (unchanged signature).
- Writing the index to `<outDir>/tools.generated.md`.
- Creating `<outDir>/tools/` if missing.
- Writing each per-module page to
  `<outDir>/tools/<moduleId>.generated.md`.

The CLI signature changes from
`tsx scripts/list-tools.ts <outFile>` to
`tsx scripts/list-tools.ts <outDir>` (default `docs`). Both files in
`package.json` (`docs:tools`, `docs:check`) update accordingly.

### Schema introspection: Zod → JSON Schema

Internally the renderer converts each Zod shape to a normalized JSON
Schema via Zod v4's `z.toJSONSchema()` and walks the JSON Schema (not
Zod's `_def`) to build the table. Reasons:

- Stable public API in `zod@^4` — the project pins `^4.4.3`.
- JSON Schema's `properties` / `required` / `enum` / `default` /
  `description` / `minLength` / `items` map directly onto the cells we
  render.
- Discriminated unions surface as `{ oneOf: [...], discriminator: { … } }`
  which is straightforward to special-case.

For input schemas the raw shape is wrapped with `z.object(shape)`
before conversion. For output schemas the renderer accepts both raw
shapes (wrap in `z.object(shape)`) and full Zod schemas (pass through).

If conversion ever throws for an unforeseen shape, the renderer
fall-backs gracefully: it emits a single `unknown` row with the field's
`.describe()` text. This keeps `docs:check` green even for shapes the
converter doesn't yet handle. The fallback is logged via
`console.warn` so it's visible during local generation.

### Schema-to-table rules

**Input table** columns: `| Field | Type | Required | Description |`

**Output table** columns: `| Field | Type | Description |` — output
fields are always present in the `structuredContent` payload from the
caller's perspective once the tool decides to emit it, so a "Required"
column would always read "yes".

**Type-cell rendering** (driven by JSON Schema):

| JSON Schema fragment | Rendered Type cell |
|---|---|
| `{ type: "string" }` | `string` |
| `{ type: "string", minLength: 1, maxLength: 4096 }` | `string (1–4096)` |
| `{ type: "string", minLength: 1 }` | `string (≥1)` |
| `{ type: "string", maxLength: 4096 }` | `string (≤4096)` |
| `{ type: "number" }` (or `"integer"`) | `number` |
| `{ type: "number", minimum: 0, maximum: 100 }` | `number (0–100)` |
| `{ type: "boolean" }` | `boolean` |
| `{ enum: ["text","json"] }` | `` enum: `text` \| `json` `` |
| `{ type: "array", items: { type: "string" } }` | `string[]` |
| `{ type: "array", items: { type: "object" } }` | `object[]` |
| `{ type: "object" }` | `object` |
| anything else / fallback | `unknown` |

The pipe in the enum rendering is escaped (`\|`) so the markdown table
renders correctly.

**Required column** for input tables (driven by the parent JSON
Schema's `required` array — a list of field names):

- field name listed in `required`, no `default` → `yes`
- field name not in `required`, no `default` → `no`
- field has a `default` of value `X` → ``no (default `X`)``
  (Zod fields with `.default()` are emitted as not-required by
  `z.toJSONSchema()`, so the default itself is the signal.)

**Description column**: the `description` from JSON Schema (which Zod
populates from `.describe()`). Trimmed; line-breaks collapsed to a
single space; pipes escaped.

**Discriminated unions** (output-only — only `vault_get_aspect` today):

Detect via the JSON Schema shape: presence of `oneOf` plus `discriminator`,
or via inspecting the Zod schema for `ZodDiscriminatedUnion` before
conversion (whichever is cleaner — implementation choice). For each
variant emit:

```
**When `<discriminator>` is `<value>`**

| Field | Type | Description |
|---|---|---|
…
```

The variant tables share the standard output-table format; the
discriminator field itself is rendered as the first row in each
variant table for clarity.

**Tools without `outputSchema`** (e.g. write tools, `ui_notice`) get a
one-line note:

> _No `structuredContent` declared — returns plain text or binary._

This keeps every tool section uniformly shaped and signals to readers
that the absence is intentional, not an oversight.

### Index page (`docs/tools.generated.md`)

Existing content is preserved verbatim:
- Auto-generated banner.
- Summary table: `| Module ID | Module Name | Count | Tools |`.
- "Total tools" line.
- Per-module annotation tables under `## Tools by module`.

One change per per-module section: a new line directly under the
heading,

```
📄 [Schemas: docs/tools/<moduleId>.generated.md](tools/<moduleId>.generated.md)
```

so a reader landing on the index can jump to the schema details. The
existing tests that scan the index for tool names / titles continue to
pass because that content is unchanged.

### `npm run docs:check`

`docs:check` becomes a directory diff:

```
rm -rf /tmp/tools.check
tsx scripts/list-tools.ts /tmp/tools.check
diff -u docs/tools.generated.md /tmp/tools.check/tools.generated.md
diff -ru docs/tools/ /tmp/tools.check/tools/
```

`diff -ru` catches missing files, extra files, and content drift in
any per-module page. Failure output already includes per-file diffs.

`docs:tools` regenerates into `docs/`:

```
tsx scripts/list-tools.ts docs
```

The script's old single-file CLI is replaced; the only callers are these
two `package.json` scripts, so no other code paths break.

### Tests

Tests live alongside today's `tests/scripts/list-tools.test.ts`. We
**extend** it rather than replace — existing assertions either continue
to apply against the renamed renderers or migrate to whichever helper
they originally tested. New tests:

1. **`inputShapeToTable` for `readFileSchema`** — asserts the header row
   plus a known data row, e.g. `` | `path` | string (1–4096) | yes | … `` .
2. **`outputSchemaToTables` for a flat raw shape** (e.g.
   `vault_read`'s output) — asserts the simple table.
3. **`outputSchemaToTables` for `vault_get_aspect`'s discriminated
   union** — asserts one sub-heading + variant table per `aspect` value.
4. **`renderModule` for the `ui` module** — covers a tool without
   `outputSchema`; asserts the "No `structuredContent` declared" line.
5. **`renderModule` for the `vault` module** — covers an `outputSchema`
   declared as a raw shape (`vault_read`).
6. **`renderIndex`** — asserts the per-module link rows are present and
   point to the correct relative paths.
7. **Module-page test fixture parity** — for each module, assert the
   rendered page contains every tool name from that module (mirrors
   the existing index-level assertion at the per-module scope).
8. **`docs:check` shell behaviour** — out of scope for unit tests; CI
   already proves it via the `docs:check` step running on every PR.

The existing `discoverModules()`-based assertions (every module
non-empty, summary banner, total line, etc.) move into the index test.

### Out of scope (follow-up)

Open a follow-up issue immediately after this one merges:

> **docs(tools.generated): add example request/response per tool family**
>
> Closes acceptance item #3 of #320. Needs a fixture-format decision
> (hand-written JSON fixtures vs. live `MockObsidianAdapter` calls).
> Not blocking the partial closure of DR8.

The follow-up will plug into the existing per-module page layout — each
tool section gets an "Example" sub-heading rendered from the chosen
fixture source.

## Risks & open questions

- **`z.toJSONSchema()` coverage.** The project is on `zod@^4.4.3`. I'll
  verify during implementation that the API handles every shape
  declared by current tools (string/number/boolean primitives, enums,
  defaults, optionals, arrays of primitives, arrays of objects, top-
  level objects, the `vault_get_aspect` discriminated union). The
  fallback `unknown` row is the safety net.
- **Description ergonomics.** Some `.describe()` strings are long (e.g.
  `vault_read` "File path relative to vault root (POSIX-style, no
  leading slash)"). They should still fit on a single table row in
  practice; the renderer collapses internal whitespace but does not
  truncate.
- **File-size growth.** Each per-module page is expected at 100–300
  lines. The index file's line count grows by ~8 link rows. Acceptable.
- **Stability of tool descriptions.** Tools' `description` strings are
  authored via `describeTool()` and already include
  args/returns/examples/errors. Embedding the description verbatim into
  each per-module page risks duplication of the args list with the
  rendered Input table. Decision: keep both — the description is the
  human narrative, the table is the machine-readable contract. If this
  feels too noisy in review we can drop the description and rely on
  the summary line only.
- **CLAUDE.md.** No edit required: the existing rule
  *"regenerate `docs/tools.generated.md` with `npm run docs:tools`"*
  still holds; the same command now also writes the per-module pages.
  The rule's wording remains accurate.

## Acceptance

- [ ] `docs/tools.generated.md` (the index) keeps the existing summary
      and annotation tables and gains a per-module schema link.
- [ ] `docs/tools/<moduleId>.generated.md` exists for every module and
      contains an Input table for every tool.
- [ ] Per-module pages contain an Output table for every tool that
      declares `outputSchema`, with a discriminated-union special case
      verified against `vault_get_aspect`.
- [ ] Tools without `outputSchema` show the "No `structuredContent`
      declared" line.
- [ ] `npm run docs:check` is green after regeneration.
- [ ] `npm test`, `npm run lint`, `npm run typecheck` are green.
- [ ] Follow-up issue opened for the example-payloads work.
