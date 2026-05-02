# Plan: Document `limit` / `offset` / `response_format` in tool descriptions

GitHub issue: #249

## Problem

Several tools spread `paginationFields` and/or `responseFormatField` into their input schema, but `describeTool({ args: [...] })` only documents domain-specific args. Agents read tool descriptions to plan calls — undocumented `limit`/`offset` means no pagination; undocumented `response_format` means agents don't know they can request JSON.

Sub-finding: `template_list` and `template_expand` don't accept `response_format` at all.

## Defaults read from `src/tools/shared/pagination.ts`

- `limit`: integer 1..100, default `20` (NOT 50/200 — task prompt was indicative; codebase wins).
- `offset`: integer >= 0, default `0`.

These are the values to render in the auto-injected description rows.

## API change to `describeTool`

Add an optional second positional argument:

```ts
export function describeTool(doc: ToolDoc, schema?: z.ZodRawShape): string;
```

When `schema` is supplied, detection works by **reference equality** on the shape's keys against `paginationFields.limit`, `paginationFields.offset`, and `responseFormatField.response_format`. `...spread` preserves references, so `schema.limit === paginationFields.limit` reliably means "the schema spreads `paginationFields`".

Auto-injected rows, appended AFTER the caller's `args`:

- pagination detected:
  - `limit (integer, optional): Maximum items to return (1..100, default 20).`
  - `offset (integer, optional): Number of items to skip before returning results (default 0).`
- response_format detected:
  - `response_format (enum, optional): "markdown" (default) or "json".`

If pagination is detected and the caller did NOT supply `returns`, also append:

- `Returns { items, total, count, offset, has_more, next_offset } when paginating.`

(Don't override an existing `returns`.)

The `ToolDoc.args` shape stays a free-form `string[]` — no refactor to structured args.

## Audit pass

`grep -rn "paginationFields\|responseFormatField" src/tools/` excluding `shared/`:

| File | Schema | Spreads | Action |
|---|---|---|---|
| `src/tools/search/schemas.ts` | `searchFulltextSchema` | pag + rf | thread schema |
| `src/tools/search/schemas.ts` | `filePathSchema` | rf | thread schema |
| `src/tools/search/schemas.ts` | `readOnlySchema` | rf | thread schema |
| `src/tools/search/schemas.ts` | `searchByTagSchema` | pag + rf | thread schema |
| `src/tools/search/schemas.ts` | `searchByFrontmatterSchema` | pag + rf | thread schema |
| `src/tools/vault/schemas.ts` | `readFileSchema` | rf | thread schema |
| `src/tools/vault/schemas.ts` | `getMetadataSchema` | rf | thread schema |
| `src/tools/vault/schemas.ts` | `listFolderSchema` | rf | thread schema |
| `src/tools/vault/schemas.ts` | `listRecursiveSchema` | pag + rf | thread schema |
| `src/tools/workspace/index.ts` | `readOnlySchema` | rf | thread schema |
| `src/tools/plugin-interop/index.ts` | `listSchema` | rf | thread schema |
| `src/tools/plugin-interop/index.ts` | `checkSchema` | rf | thread schema |
| `src/tools/plugin-interop/index.ts` | `dataviewSchema` | rf | thread schema |
| `src/tools/editor/index.ts` | `readOnlySchema` | rf | thread schema |
| `src/tools/extras/index.ts` | `getDateSchema` | rf | thread schema |
| `src/tools/templates/index.ts` | `listTemplatesSchema`, `expandVariablesSchema` | NEITHER currently | **add `responseFormatField`**, thread schema |

No manual `limit`/`offset`/`response_format` lines exist anywhere in `args`, so no double-documentation conflicts.

For every `defineTool` call site: add `schema` as second arg to `describeTool(...)`. This is repetitive but cheap; centralising it via the schema-detection ensures no future drift.

## Templates structured-response approach

Mirror what `extras/index.ts` and `workspace/index.ts` do:

- import `makeResponse`, `readResponseFormat`, `responseFormatField` from `../shared/response`.
- spread `responseFormatField` into `listTemplatesSchema` and `expandVariablesSchema`.
- `listTemplates` handler:
  - on success: structured payload `{ files: result.files }`; markdown renderer returns `JSON.stringify(v.files)` to preserve existing markdown tests (which assert `JSON.parse(getText(...))` returns an array).
  - on `FolderNotFoundError`: same structure with empty `[]`.
  - error path stays via `handleToolError`.
- `expandVariables` handler:
  - structured payload `{ expanded: string }`.
  - markdown renderer returns the raw expanded string (existing tests assert `getText(...)` contains `Hello World`).

## Test list

### `tests/tools/shared/describe.test.ts` (new)

- no schema → output unchanged
- schema spreads no shared fields → no injection
- only pagination → `limit`, `offset` rows present, default `Returns` added when caller didn't supply
- only response_format → only `response_format` row
- both → all three rows + `Returns` default if absent
- caller-supplied `returns` is preserved (not overridden)
- caller `args` come first, injected rows come after

### Tool-level assertions

- `tests/tools/search/search.test.ts`: assert `search_fulltext` description contains `'limit (integer'`, `'offset (integer'`, `'response_format (enum'`. Same for `search_by_tag`, `search_by_frontmatter`. For other search tools (only `responseFormatField` spread): assert `'response_format (enum'`.
- `tests/tools/vault/module.test.ts`: assert `vault_list_recursive` description has all three; `vault_read`/`vault_list`/`vault_get_metadata` description contains `response_format`.
- `tests/tools/templates/templates.test.ts`:
  - description contains `'response_format (enum'` for `template_list` and `template_expand`.
  - `template_list` with `response_format: 'json'` returns a result with `structuredContent` having `files` array; default still returns markdown string parseable as JSON array.
  - `template_expand` with `response_format: 'json'` returns `structuredContent.expanded` and JSON text.
  - Existing markdown-path assertions stay green.

## Commits planned

1. `docs(plans/249): plan for documenting shared tool args`
2. `feat(tools/shared): inject limit/offset/response_format into describeTool`  — describe.ts change + tests.
3. `fix(tools): thread schema into describeTool calls so shared args document themselves` — audit pass across search/vault/workspace/plugin-interop/editor/extras call sites.
4. `feat(tools/templates): accept response_format on template_list and template_expand` — schemas + handlers via `makeResponse`.

All commits include `Refs #249`.

## Verification

- `npm run lint && npm test && npm run typecheck && npm run docs:check` all pass (the generated.md only lists tool names and we don't add tools, so it shouldn't drift; still regenerate to be safe).
