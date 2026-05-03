# Tool titles and sibling cross-references

- **Issue:** [#289](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/289)
- **Date:** 2026-05-03
- **Status:** approved (brainstorm phase)

## Goal

Bring the tool registry into compliance with two `mcp-server-dev:build-mcp-server`
hard-pass criteria from `references/tool-design.md`:

1. Every tool ships a non-empty `title` annotation (alongside the existing
   `readOnlyHint` / `destructiveHint`). Hosts use this for confirmation /
   auto-approve UI; today they fall back to the raw tool name (`vault_create`).
2. Sibling tools cross-reference each other in their descriptions so Claude
   picks the right one of a near-duplicate pair.

Purely additive. No tool rename, no schema change, no breaking change.

## Architecture

### `title` is a top-level required field on `ToolDefinition`

The MCP spec slot for the human-readable label is `annotations.title`. We
expose it one level higher in source — as a top-level required field on
`ToolDefinition` — and merge it into the annotations object at registration
time. This keeps the per-tool nature (each tool has its own title) without
forcing every call site to spread an annotations preset.

```ts
// src/registry/types.ts
export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;            // NEW — required, sentence case, ≤40 chars
  description: string;
  schema: Shape;
  outputSchema?: z.ZodRawShape;
  handler: TypedHandler<Shape>;
  annotations: ToolAnnotations;
}
```

```ts
// src/server/mcp-server.ts (registerTools)
server.registerTool(tool.name, {
  title: tool.title,                                       // top-level (modern protocol)
  description: tool.description,
  inputSchema: tool.schema,
  outputSchema: tool.outputSchema,
  annotations: { ...tool.annotations, title: tool.title }, // legacy hint slot
}, dispatcher);
```

The title is set in **both** locations for forward and backward compatibility:
the top-level `Tool.title` is the spec-preferred slot in current MCP protocol
revisions; `ToolAnnotations.title` is the older hint location and the one
called out as a Directory hard-pass criterion. Both forms cost nothing
extra — single `tool.title` source of truth in registry data, two slots on
the wire.

**Why this layout:**

- Compile-time required. `tsc` rejects a new tool added without a title.
- Annotation presets (`annotations.read`, `annotations.destructive`, …) stay
  shareable. Per-tool `title` doesn't pollute them.
- Wire-level shape unchanged — clients still see `annotations.title`.

The runtime test from the issue's scope becomes a belt-and-braces check
(non-empty after trim, length cap, uniqueness) rather than the primary
guarantee.

### `seeAlso` section in `describeTool`

Sibling cross-references land in a new structured section in the description
helper, not in free-form prose inside `examples`. Structure makes audits
trivial: the registry test asserts that each documented pair is mutually
cross-referenced.

```ts
// src/tools/shared/describe.ts
export interface ToolDoc {
  summary: string;
  args?: string[];
  returns?: string;
  examples?: string[];
  errors?: string[];
  seeAlso?: string[];   // NEW — each entry: "tool_name — when to use it instead"
}
```

Rendered between `Examples` and `Errors`:

```
See also:
  - <tool_name> — <when to use it instead>
```

Each entry names the sibling tool by its registry name and gives one short
clause on when to pick the other one.

## Title catalogue (49 tools)

Sentence case, no module prefix, ≤40 characters, disambiguator suffix where
two titles would otherwise collide.

### vault (17)

| Name | Title |
|---|---|
| `vault_create` | Create file |
| `vault_read` | Read file |
| `vault_update` | Replace file content |
| `vault_delete` | Delete file |
| `vault_append` | Append to file |
| `vault_get_metadata` | Get file metadata |
| `vault_rename` | Rename file |
| `vault_move` | Move file |
| `vault_copy` | Copy file |
| `vault_create_folder` | Create folder |
| `vault_delete_folder` | Delete folder |
| `vault_rename_folder` | Rename folder |
| `vault_list` | List folder |
| `vault_list_recursive` | List folder (recursive) |
| `vault_read_binary` | Read binary file |
| `vault_write_binary` | Write binary file |
| `vault_get_aspect` | Get file aspect |

### editor (10)

| Name | Title |
|---|---|
| `editor_get_content` | Get active file content |
| `editor_get_active_file` | Get active file path |
| `editor_insert` | Insert at cursor |
| `editor_replace` | Replace range |
| `editor_delete` | Delete range |
| `editor_get_cursor` | Get cursor position |
| `editor_set_cursor` | Set cursor position |
| `editor_get_selection` | Get selection |
| `editor_set_selection` | Set selection |
| `editor_get_line_count` | Get line count |

### search (6)

| Name | Title |
|---|---|
| `search_fulltext` | Full-text search |
| `search_tags` | List tags |
| `search_resolved_links` | Find resolved links |
| `search_unresolved_links` | Find unresolved links |
| `search_by_tag` | Find notes by tag |
| `search_by_frontmatter` | Find notes by frontmatter |

### workspace (5)

| Name | Title |
|---|---|
| `workspace_get_active_leaf` | Get active leaf |
| `workspace_open_file` | Open file in workspace |
| `workspace_list_leaves` | List open leaves |
| `workspace_set_active_leaf` | Set active leaf |
| `workspace_get_layout` | Get workspace layout |

### ui (1)

| Name | Title |
|---|---|
| `ui_notice` | Show notice |

### templates (3)

| Name | Title |
|---|---|
| `template_list` | List templates |
| `template_create_from` | Create file from template |
| `template_expand` | Expand template inline |

### plugin-interop (6)

| Name | Title |
|---|---|
| `plugin_list` | List plugins |
| `plugin_check` | Check plugin enabled |
| `plugin_dataview_query` | Run Dataview query |
| `plugin_dataview_describe_js_query` | Describe Dataview JS query |
| `plugin_templater_describe_template` | Describe Templater template |
| `plugin_execute_command` | Execute command |

### extras (1)

| Name | Title |
|---|---|
| `extras_get_date` | Get current date |

## Sibling cross-references

Each pair is symmetric — both sides name the other tool.

### Pairs from issue scope

| Pair | A description gains | B description gains |
|---|---|---|
| `editor_get_content` ↔ `vault_read` | `vault_read` — when reading any file by path, not just the active one. | `editor_get_content` — when reading the file currently open in the editor (no path needed). |
| `vault_list` ↔ `vault_list_recursive` | `vault_list_recursive` — when you also need files in subfolders. | `vault_list` — when you only need direct children of one folder. |
| `search_resolved_links` ↔ `search_unresolved_links` | `search_unresolved_links` — when you want broken/dangling links instead. | `search_resolved_links` — when you want only links that successfully resolve. |
| `extras_get_date` ↔ `vault_get_metadata` | `vault_get_metadata` — when you need a file's modified/created timestamp, not today's date. | `extras_get_date` — when you need the current date in a specific format, not a file's timestamp. |

### Additional pairs added in this PR (in-scope expansion)

| Pair | Cross-ref |
|---|---|
| `editor_insert` / `editor_replace` / `editor_delete` (triple) | each lists the other two with one-line "use when…" pointers. |
| `search_tags` ↔ `search_by_tag` | `search_by_tag` — when you want notes carrying a tag, not the list of tags. ↔ `search_tags` — when you want the list of tags in the vault, not notes. |

### Deferred (follow-up issues filed after this PR lands)

- `editor_set_cursor` / `editor_set_selection`
- `editor_get_active_file` / `workspace_get_active_leaf`
- `template_create_from` / `template_expand`

## Tests

New file `tests/registry/tool-titles.test.ts` with the following cases (the
compile-time required field already enforces presence; these are the runtime
guarantees that survive whitespace, length, and rename regressions):

- **Every active tool has a non-empty title** — `title.trim().length > 0`.
- **Title length cap** — `title.length <= 40`.
- **Titles are unique across the registry** — guards against accidental
  duplicate sentence-case labels (e.g. two tools both called "List folder").
- **Sibling-pair symmetry** — for each documented pair, the partner tool's
  registry name appears in the description text. The pair list is a const
  exported from the test file so adding a new pair is a one-line edit.

## Generated docs

Extend `scripts/list-tools.ts` to emit, in addition to the existing summary
table, a per-module `## <Module Name>` section containing:

```
| Name | Title | readOnly | destructive |
|---|---|---|---|
| vault_create | Create file |  | ✓ |
| vault_read | Read file | ✓ |  |
…
```

This surfaces the three Directory hard-pass criteria (`title`, `readOnlyHint`,
`destructiveHint`) in one place per module. CI's `docs:check` regenerates the
file and diffs against the committed copy — drift fails the build.

## User manual

[docs/help/en.md](../../help/en.md) does not currently enumerate tools per
surface — titles are protocol-level metadata that hosts render in their own
UI. **No content change is required by default.** Spot-check during
implementation: if a section names a specific tool, surface the new title
alongside the name. Locale siblings receive the same treatment.

## Out of scope

- Tool renames, additions, or removals.
- Schema changes.
- Editing the `readOnlyHint` / `destructiveHint` presets.
- Sibling cross-refs for the deferred pairs listed above (separate follow-up
  issues).

## Risks and mitigations

- **Title drift across locales.** Titles ship in English only; the MCP
  protocol exposes a single string per tool. Acceptable today — the rest of
  the user-facing surface is also English-default. Revisit only if the
  protocol gains localisation.
- **Host UI truncation.** 40-char cap is a guess at what most hosts render
  cleanly. If a real host truncates earlier we can shorten in a follow-up
  without breaking anything.
- **Disambiguator suffix on `vault_list_recursive`.** Reads as "List folder
  (recursive)" — slightly awkward but precedent-consistent with how the SDK
  example uses parenthetical qualifiers.
