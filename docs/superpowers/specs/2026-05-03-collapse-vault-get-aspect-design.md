# Collapse `vault_get_*` getters into `vault_get_aspect`

- **Issue:** [#294](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/294)
- **Date:** 2026-05-03
- **Status:** approved (brainstorm phase)

## Goal

Replace six structurally-identical single-path getters with one tool that
takes an `aspect` enum, cutting the tool-list context cost without losing
per-aspect documentation or strict output typing.

The six tools being collapsed:

| Removed tool | Returns |
|---|---|
| `vault_get_frontmatter` | parsed YAML frontmatter object |
| `vault_get_headings` | `[{ heading, level }]` |
| `vault_get_outgoing_links` | `[{ link, displayText? }]` |
| `vault_get_embeds` | `[{ link, displayText? }]` |
| `vault_get_backlinks` | `string[]` of backlinking files |
| `vault_get_block_references` | `[{ id, line }]` |

All six already share input shape `{ path }` and route through the same
handler family in [`src/tools/search/handlers.ts`](../../../src/tools/search/handlers.ts)
(`searchHandlers.search*`). The consolidation is a thin tool-layer change.

## Decisions

- **Scope: collapse all six** (issue Option A, not partial).
- **Arg: required, single value** (issue 2a, not array, not `"all"`).
- **Migration: hard cut** (issue 3a, no deprecation aliases).
- **Tool name: `vault_get_aspect`** (per issue title).
- **Handler relocation: out of scope.** The six underlying handlers stay in
  `src/tools/search/handlers.ts`; the new dispatcher lives in the vault
  module. The naming mismatch (`searchHandlers.searchFrontmatter` driving a
  `vault_*` tool) predates this issue and is not worsened by the
  consolidation.

## Architecture

### Tool registration

In [`src/tools/vault/index.ts`](../../../src/tools/vault/index.ts), the six
`defineTool({ name: 'vault_get_*' })` entries (lines ~475–558) are replaced
by one `defineTool({ name: 'vault_get_aspect' })` entry. The six existing
per-tool output schemas (`getFrontmatterOutputSchema`, `getHeadingsOutputSchema`,
…) merge into a single discriminated union (see *Output schema* below).

### Input schema

```ts
// src/tools/vault/schemas.ts (new)
export const getAspectSchema = {
  path: z.string().describe('Vault-relative path to the file.'),
  aspect: z.enum([
    'frontmatter',
    'headings',
    'outgoing_links',
    'embeds',
    'backlinks',
    'block_references',
  ]).describe(
    'Which metadata aspect to return. ' +
    '"frontmatter" → parsed YAML frontmatter object, or {} when absent. ' +
    '"headings" → [{ heading, level }] in document order. ' +
    '"outgoing_links" → [{ link, displayText? }] for [[...]] links. ' +
    '"embeds" → [{ link, displayText? }] for ![[...]] embeds. ' +
    '"backlinks" → string[] of vault paths that link TO this file. ' +
    '"block_references" → [{ id, line }] for ^block-ids defined in this file.'
  ),
};
```

Per-aspect documentation that was previously per-tool prose is preserved by
enriching the enum's `.describe()`. Claude reads this on every tool-list
refresh, so descriptions stay visible without spending six tool slots.

### Output schema (discriminated union)

```ts
// src/tools/vault/index.ts (replacing the six per-tool output schemas)
const getAspectOutputSchema = z.discriminatedUnion('aspect', [
  z.object({
    aspect: z.literal('frontmatter'),
    path: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
  }),
  z.object({
    aspect: z.literal('headings'),
    path: z.string(),
    headings: z.array(z.object({
      heading: z.string(),
      level: z.number(),
    })),
  }),
  z.object({
    aspect: z.literal('outgoing_links'),
    path: z.string(),
    links: z.array(z.object({
      link: z.string(),
      displayText: z.string().optional(),
    })),
  }),
  z.object({
    aspect: z.literal('embeds'),
    path: z.string(),
    embeds: z.array(z.object({
      link: z.string(),
      displayText: z.string().optional(),
    })),
  }),
  z.object({
    aspect: z.literal('backlinks'),
    path: z.string(),
    backlinks: z.array(z.string()),
  }),
  z.object({
    aspect: z.literal('block_references'),
    path: z.string(),
    blockRefs: z.array(z.object({
      id: z.string(),
      line: z.string(),
    })),
  }),
]);
```

Each variant mirrors the corresponding existing output schema 1:1 with one
addition: an `aspect` literal as the discriminator. Field names
(`frontmatter`, `headings`, `links`, `embeds`, `backlinks`, `blockRefs`) are
unchanged from today's per-tool schemas — only the wrapping changes.

#### Registry compatibility note

The other `outputSchema` declarations in [`src/tools/vault/index.ts`](../../../src/tools/vault/index.ts)
are bare object literals (e.g. `readFileOutputSchema`, `getMetadataOutputSchema`),
matching the `ToolDefinition.outputSchema?: z.ZodRawShape` slot in
[`src/registry/types.ts`](../../../src/registry/types.ts). A
`z.discriminatedUnion(...)` is not a `ZodRawShape`. The implementation plan
must pick one of:

1. **Widen the registry slot** to accept `ZodRawShape | z.ZodTypeAny` and
   pass through to `server.registerTool(...)` accordingly. Smallest user-
   facing change; one type tweak in `registry/types.ts` and a matching
   adjustment in `mcp-server.ts` registration.
2. **Skip `outputSchema` for this tool** and document the union in the
   description text only. `structuredContent` still carries the right
   runtime shape; we just don't ship a typed schema. Lossier — modern
   clients can't introspect the variants.
3. **Wrap the union as a single object** that embeds the union as one field,
   e.g. `{ result: z.discriminatedUnion(...) }`. Stays compatible with the
   bare-object convention but adds a wrapping layer that diverges from the
   other vault tools.

**Recommended path: option 1.** It's a small registry change, keeps the
output strictly typed, and is the natural way to support future tools whose
return shapes vary by input. Confirmed in the implementation plan; if
option 1 turns out to require touching more than the registry types and the
single registration site, fall back to option 2.

### Dispatcher

A new method `getAspect` lives next to the rest of the vault handlers (in
[`src/tools/vault/handlers.ts`](../../../src/tools/vault/handlers.ts), or
inline in `index.ts` per local style — implementation choice). It receives
the parsed `{ path, aspect }` and dispatches:

```ts
async getAspect(params): Promise<CallToolResult> {
  const { aspect } = params;
  const inner = await dispatchByAspect(aspect, params);
  return decorateWithAspect(inner, aspect);
}
```

`dispatchByAspect` is a `switch` over the six enum values calling the
matching `searchHandlers.search*` method. `decorateWithAspect` takes the
result of an underlying handler and merges `{ aspect }` into its
`structuredContent` so the discriminator surfaces at runtime exactly as the
output schema declares it.

Behaviour-preserving:

- All error cases (file not found, traversal, etc.) propagate from the
  underlying handlers.
- `response_format` (markdown vs json) continues to work — the `aspect`
  field is added to `structuredContent`; the markdown rendering produced by
  each existing handler is forwarded as-is. For JSON output the wrapper
  re-runs `JSON.stringify` against the decorated object.

### Description, title, annotations

```ts
defineTool({
  name: 'vault_get_aspect',
  title: 'Get file aspect',
  description: describeTool({
    summary:
      'Get one metadata aspect of a file: frontmatter, headings, ' +
      'outgoing links, embeds, backlinks, or block references.',
    args: [
      'path (string): Vault-relative path to the file.',
      'aspect (enum): Which aspect to return. See enum description for the ' +
        'shape returned by each value.',
    ],
    returns:
      'JSON: a discriminated union keyed on `aspect`. ' +
      'frontmatter → { path, aspect: "frontmatter", frontmatter }. ' +
      'headings → { path, aspect: "headings", headings: [{heading, level}] }. ' +
      'outgoing_links → { path, aspect: "outgoing_links", links: [{link, displayText?}] }. ' +
      'embeds → { path, aspect: "embeds", embeds: [{link, displayText?}] }. ' +
      'backlinks → { path, aspect: "backlinks", backlinks: string[] }. ' +
      'block_references → { path, aspect: "block_references", blockRefs: [{id, line}] }.',
    examples: [
      'Use when: "list the headings in README.md" → { path: "README.md", aspect: "headings" }.',
      'Use when: "what links to this note?" → { path: "ideas.md", aspect: "backlinks" }.',
    ],
    errors: ['"File not found" if the path does not exist.'],
  }, getAspectSchema),
  schema: getAspectSchema,
  outputSchema: getAspectOutputSchema,
  handler: handlers.getAspect,
  annotations: annotations.read,
});
```

`annotations.read` matches what each of the six existing tools used. No
title-uniqueness collision (catalogue in
[`docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](2026-05-03-tool-titles-and-sibling-cross-refs-design.md)
will need a one-line update — see *Cross-cutting doc updates* below).

## Tests

### Removed

- The six per-tool registration assertions in
  [`tests/tools/vault/module.test.ts`](../../../tests/tools/vault/module.test.ts).
  Each currently checks the tool exists, its schema, and its handler wiring.

### Added

A single parametrized test in the same file that walks all six enum values:

- **Registry surface:** exactly one `vault_get_aspect` tool exists; no
  `vault_get_frontmatter` / `_headings` / `_outgoing_links` / `_embeds` /
  `_backlinks` / `_block_references` remains. Total registered tool count
  drops from 54 to 49.
- **Per-aspect output:** for each `aspect` value, calling the handler with
  a fixture path returns `structuredContent` matching the corresponding
  union variant: correct discriminator, correct payload field name,
  correct payload shape.
- **Error propagation:** for each `aspect` value, calling against a
  non-existent path surfaces the underlying "File not found" error
  unchanged.

### Untouched

The handler-level tests in
[`tests/tools/search/search.test.ts`](../../../tests/tools/search/search.test.ts)
keep covering `searchHandlers.searchFrontmatter` etc. directly. Those
handlers are still invoked by the new dispatcher, so the existing coverage
is still load-bearing.

## Cross-cutting doc updates

### Generated registry table

`npm run docs:tools` regenerates
[`docs/tools.generated.md`](../../../docs/tools.generated.md). Expected
diff:

- Vault module count: `22 → 17`.
- Vault module tool list: drop the six `vault_get_*` getters; add one
  `vault_get_aspect`.
- Total: `54 tools across 8 modules → 49 tools across 8 modules`.

CI's `docs:check` step diffs against the committed copy, so this file
must be regenerated and committed in the same PR.

### User manual

[`docs/help/en.md`](../../../docs/help/en.md) (and any sibling locale
files): replace the six entries under the vault tools table with one
`vault_get_aspect` row, and add a one-liner under "Breaking changes in
this release" naming the six removed tools and how to migrate:

```
vault_get_frontmatter({ path })       → vault_get_aspect({ path, aspect: "frontmatter" })
vault_get_headings({ path })          → vault_get_aspect({ path, aspect: "headings" })
vault_get_outgoing_links({ path })    → vault_get_aspect({ path, aspect: "outgoing_links" })
vault_get_embeds({ path })            → vault_get_aspect({ path, aspect: "embeds" })
vault_get_backlinks({ path })         → vault_get_aspect({ path, aspect: "backlinks" })
vault_get_block_references({ path })  → vault_get_aspect({ path, aspect: "block_references" })
```

### Title catalogue

[`docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](2026-05-03-tool-titles-and-sibling-cross-refs-design.md):
the vault title table currently lists six rows for the removed tools.
Replace those six rows with one `vault_get_aspect | Get file aspect` row.
Tool count in section header drops from `vault (22)` to `vault (17)`.

The deferred cross-ref triple (`vault_get_outgoing_links` /
`vault_get_embeds` / `vault_get_backlinks`) noted at the end of that spec
becomes moot once those tools no longer exist. Strike the entry from the
"Deferred" list.

## Breaking-change paperwork

- **Branch:** `refactor/issue-294-collapse-vault-get-aspect` (Conventional
  Commits-style prefix + issue number, per project rule 7).
- **Conventional Commit (and PR title):**
  `refactor(tools/vault)!: collapse 6 vault_get_* tools into vault_get_aspect`.
- **Commit body footer:**

  ```
  BREAKING CHANGE: removed vault_get_frontmatter, vault_get_headings,
    vault_get_outgoing_links, vault_get_embeds, vault_get_backlinks,
    vault_get_block_references. Replaced by vault_get_aspect with an
    `aspect` enum arg accepting "frontmatter", "headings", "outgoing_links",
    "embeds", "backlinks", or "block_references". Migrate by passing the
    matching aspect value to the new tool.
  Refs #294
  ```

- **PR body** includes `Closes #294`, a Summary section with the migration
  table, and a Test plan section pointing at the parametrized test.
- **Release boundary:** the PR is mergeable any time. Per the issue's
  Dependencies note, the *release* containing this change should be
  batched with any other breaking change pending so users absorb one
  breaking version, not several.

## Out of scope

- Moving `searchFrontmatter` / `searchHeadings` / `searchOutgoingLinks` /
  `searchEmbeds` / `searchBacklinks` / `searchBlockReferences` from
  [`src/tools/search/handlers.ts`](../../../src/tools/search/handlers.ts)
  to the vault module. Pre-existing organisational mismatch; not worsened
  by this change.
- Touching the actual `search_*` tools (`search_fulltext`, `search_tags`,
  `search_resolved_links`, `search_unresolved_links`, `search_by_tag`,
  `search_by_frontmatter`) — none of those are being collapsed.
- Adding an `"all"` shortcut, an array form for `aspect`, or any other
  multi-aspect ergonomic. Single-value enum only; agents that need
  multiple aspects issue parallel tool calls.
- Deprecation aliases. Hard cut per decision 3a.
