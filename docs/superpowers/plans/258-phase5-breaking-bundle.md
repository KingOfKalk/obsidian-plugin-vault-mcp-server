# Plan — Phase 5 breaking bundle (#258)

- **Tracker:** [#258](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/258)
- **Closes:** #250, #251, #253, #255
- **Branch:** `feat/issue-258-phase5-breaking-bundle`
- **PR title:** `feat!: enforce naming convention and secure-by-default auth`

This plan implements the four breaking issues that ship together as one
PR. Decisions are locked from the campaign spec
(`docs/superpowers/specs/2026-05-02-mcp-builder-review-followup-design.md`,
§2 and §3 Phase 5). No deprecation aliases — clean break.

---

## #251 — Rename `get_date` → `extras_get_date`

### Approach

- Single source-line change: `name: 'get_date'` → `'extras_get_date'`.
- No alias. PR ships a major version, so an alias would be one-release-old
  immediately.
- `migrations.ts` references `{ get_date: true }` in the V3→V4 hop —
  already-migrated installs persist that key, so we leave the V3→V4 hop
  alone (rewriting historical migrations is out of scope) but add a
  V9→V10 hop that renames `extras.toolStates.get_date` →
  `extras.toolStates.extras_get_date` so the toggle keeps working after
  upgrade.

### Files touched

- `src/tools/extras/index.ts` — rename the tool name.
- `src/settings/migrations.ts` — V9→V10 hop renames the toolStates key.
- `tests/tools/extras/extras.test.ts` — every assertion that mentions
  `get_date`.
- `tests/settings.test.ts` — the four call sites that mention `get_date`
  in toolStates / discovery output.
- `tests/utils/debug-info.test.ts` — `get_date` in the debug bundle
  fixture.
- `tests/registry/module-registry.test.ts` — `get_date` mock-tool calls.
- `docs/help/en.md` — line 195 and 347 reference `get_date`.

### Tests to add / update

- All existing `get_date` references rewritten to `extras_get_date`.
- New migrations test: V9 → V10 renames `extras.toolStates.get_date` →
  `extras_get_date`, leaves other tool keys alone.

---

## #255 — Rename six `search_*` getters to `vault_get_*`

### Approach

The six tools (`search_frontmatter`, `search_headings`,
`search_outgoing_links`, `search_embeds`, `search_backlinks`,
`search_block_references`) do single-path field access — they are not
vault-wide search and conceptually belong with `vault_read` /
`vault_get_metadata`.

**Chosen path:** move the six tools out of the search module and into
`src/tools/vault/index.ts`. The handler logic stays where it currently
lives (the search handlers operate on the same adapter the vault module
already holds, so the move is purely a registry change — keep importing
`createSearchHandlers` from `src/tools/search/handlers.ts` for now and
let the handler module continue to live there). This keeps the vault
module's existing `handlers.ts` untouched and avoids a giant churn.

The `search` module is left with the genuine vault-search tools:
`search_fulltext`, `search_by_tag`, `search_by_frontmatter`,
`search_resolved_links`, `search_unresolved_links`, `search_tags`.

### Files touched

- `src/tools/search/index.ts` — remove the six getters.
- `src/tools/search/handlers.ts` — unchanged structurally (handlers
  exported and still used).
- `src/tools/vault/index.ts` — register the six new `vault_get_*` tools
  using the existing search handlers + schemas. Import them from
  `../search/handlers` and `../search/schemas`.
- `tests/tools/search/search.test.ts` — drop the moved tools' module-
  level tests; keep handler-level tests (handlers stay in place but the
  tool count drops to 6).
- `tests/tools/vault/module.test.ts` — assert the six new tools register.
- `docs/help/en.md` — update any references; the help doesn't currently
  list the affected tools by name (verify with grep).
- `docs/tools.generated.md` — regenerated.

### Renamed tools (old → new)

| Old | New |
|---|---|
| `search_frontmatter` | `vault_get_frontmatter` |
| `search_headings` | `vault_get_headings` |
| `search_outgoing_links` | `vault_get_outgoing_links` |
| `search_embeds` | `vault_get_embeds` |
| `search_backlinks` | `vault_get_backlinks` |
| `search_block_references` | `vault_get_block_references` |

### Tests to update

- `search.test.ts`: tool count drops from 12 → 6; `descriptionFor` /
  registration tests move to vault module.
- `vault/module.test.ts`: assert tool count after the move; assert each
  new `vault_get_*` name is registered with read annotations.

---

## #250 — Plugin-interop: execute DQL; rename JS / Templater stubs

### Approach (locked decisions)

- **`plugin_dataview_query`:** Option A — actually execute when the user
  passes a DQL query. Use the Dataview API's
  `app.plugins.plugins.dataview?.api.queryMarkdown(query)` (read-only,
  no JS evaluation). Return the rendered markdown along with the raw
  query in `structuredContent`.
- **dataview-js mode:** since the existing schema has a single `query`
  field with no mode discriminator, **do not** add JS support to the
  same tool. Add a separate tool
  `plugin_dataview_describe_js_query` that echoes the JS source verbatim
  with a note that the host must run it. Cleaner than a discriminated
  union in the schema for this size of change.
- **`plugin_templater_execute`:** rename to
  `plugin_templater_describe_template`. Schema unchanged. Description
  flips to "Echo a Templater template path for client-side execution.
  Returns the path and a note that the host must run it via Templater."
- **Adapter exposure:** add a typed `getDataviewApi()` method to
  `ObsidianAdapter` that returns `{ queryMarkdown(query: string):
  Promise<{ successful: boolean; value?: string; error?: string }> } |
  null`. Reading via the adapter keeps `RealObsidianAdapter` the only
  place that touches `app.plugins.plugins.<id>` and lets the mock stub
  it cleanly.
- **Error class:** add `PluginNotInstalledError` and
  `PluginApiUnavailableError` to `src/tools/shared/errors.ts`. Map them
  in `handleToolError` so they render as a normal MCP error envelope.

### Files touched

- `src/tools/shared/errors.ts` — two new error classes; map them in
  `handleToolError`.
- `src/obsidian/adapter.ts` — add `getDataviewApi()` to interface and
  `RealObsidianAdapter`.
- `src/obsidian/mock-adapter.ts` — add `getDataviewApi()` returning
  `null` by default + a setter `setDataviewApi(...)` for tests.
- `src/tools/plugin-interop/index.ts` — implement DQL execution; rename
  `plugin_templater_execute` → `plugin_templater_describe_template`;
  add new `plugin_dataview_describe_js_query` tool.
- `tests/tools/plugin-interop/plugin-interop.test.ts` — add tests for
  the renamed and the new tool; assert error classes for absent
  dataview; assert successful queryMarkdown round-trip.
- `docs/help/en.md` — only an indirect mention; update any references.
- `docs/tools.generated.md` — regenerated.

### Tests to add

- `plugin_dataview_query` with `getDataviewApi()` mocked to a successful
  `queryMarkdown` returns the rendered markdown and structured content.
- `plugin_dataview_query` when `getDataviewApi()` returns `null` →
  `PluginNotInstalledError` (or appropriate envelope).
- `plugin_dataview_describe_js_query` echoes the JS verbatim.
- `plugin_templater_describe_template` echoes the template path
  verbatim; old `plugin_templater_execute` no longer registers.

---

## #253 — Auth default flip + insecure-mode flag

### Approach (locked decisions)

- **Default flip:** `authEnabled: true`, `accessKey: ''`,
  `iAcceptInsecureMode: false` in `DEFAULT_SETTINGS`. Schema bumps to
  v10.
- **First-run behaviour:** if `authEnabled === true && accessKey === ''`
  on plugin load, auto-generate a 32-byte key
  (`randomBytes(32).toString('base64url')`), persist it, and surface it
  in the settings tab.
- **Insecure mode:** if `authEnabled === false &&
  iAcceptInsecureMode !== true`, the server refuses to start. A
  `Notice` directs the user to settings.
- **Grandfather migration:** in V9→V10:
  - Add `iAcceptInsecureMode: false` to all migrated objects.
  - If migrated object has `authEnabled === false && accessKey === ''`
    (the default-insecure historical state), set
    `iAcceptInsecureMode: true` so existing installs don't suddenly
    refuse to bind. Also rename `extras.toolStates.get_date` → ...
    (combined with #251's migration).
  - Show a one-time notice on next plugin load: "Auth is disabled.
    Click here to enable and generate a key." Track via a transient
    `seenInsecureWarning` flag (set true after the notice is dismissed
    or after first display).
- **Settings UI:**
  - Auth toggle becomes "Require Bearer authentication" — copy
    unchanged but the description is updated to mention insecure mode.
  - Add an "Accept insecure mode" toggle that is shown only when
    `authEnabled === false`. When toggled on, an `iAcceptInsecureMode`
    setting persists. When `authEnabled === true`, the toggle is
    hidden.
  - The access-key field still has Generate / Copy buttons (already
    present); add a small note that the key was auto-generated on
    first run.

### Files touched

- `src/types.ts` — bump `schemaVersion` to 10; add
  `iAcceptInsecureMode: boolean` and `seenInsecureWarning: boolean` to
  `McpPluginSettings`. Update `DEFAULT_SETTINGS`.
- `src/settings/migrations.ts` — V9→V10 hop covering the grandfather
  case + the `extras_get_date` rename.
- `src/main.ts` —
  - On `loadSettings`, if `authEnabled === true && accessKey === ''`,
    generate a fresh key and persist.
  - In `startServer()`, refuse to bind if `authEnabled === false &&
    iAcceptInsecureMode !== true`. Emit a `Notice` and a log line.
  - On first load after grandfather migration (detected via
    `seenInsecureWarning === false`), show the one-time notice
    pointing the user to settings; flip
    `seenInsecureWarning = true` on the same load.
- `src/settings/server-section.ts` — add the "Accept insecure mode"
  toggle when auth is off; otherwise unchanged. The Generate / Copy
  controls already exist.
- `src/lang/locale/en.ts` — new strings:
  `setting_insecure_mode_name`,
  `setting_insecure_mode_desc`,
  `notice_insecure_mode_refused`,
  `notice_grandfather_warning`,
  `notice_access_key_generated`.
- `tests/settings/migrations.test.ts` — V9→V10 hop tests
  (grandfather case, fresh-default case, explicit-auth-off-without-key
  case, also check `extras_get_date` rename).
- `tests/types.test.ts` — bump expected schemaVersion to 10; add
  assertions for the two new fields.
- `tests/main.test.ts` — update tests at lines 92 and 361 to reflect
  the new "no-bind without iAcceptInsecureMode" rule. Add positive
  test: `authEnabled === true && accessKey === ''` triggers
  auto-generation + persistence on load.
- `docs/help/en.md` — auth section: new default, the flag, grandfather
  behaviour.

### Tests to add

- Auto-generation: `loadSettings` with `authEnabled: true,
  accessKey: ''` produces a non-empty 32-byte base64url string and
  calls `saveData`.
- Refusal: `startServer()` with `authEnabled: false,
  iAcceptInsecureMode: false` does not call `httpServer.start()` and
  shows a Notice.
- Migration grandfather: V9 input with `authEnabled === false &&
  accessKey === ''` produces `iAcceptInsecureMode: true` after V9→V10.
- Migration non-grandfather: V9 input with `authEnabled === true &&
  accessKey === 'real-key'` produces `iAcceptInsecureMode: false`.

---

## Cross-cutting

- Run `npm run docs:tools` once at the end after all renames have
  landed to regenerate `docs/tools.generated.md`.
- Don't edit `CHANGELOG.md` manually (release-please is in charge).

## Ordering of commits

1. `docs(plans/258-phase5): plan for breaking bundle` — this file.
2. `fix(tools/extras)!: rename get_date to extras_get_date` — #251.
3. `refactor(tools)!: rename search_*_field getters to vault_get_*` —
   #255.
4. `feat(tools/plugin-interop)!: execute DQL queries; rename
   Templater/dataview-js to *_describe_*` — #250.
5. `feat(settings)!: enable auth by default and require explicit
   insecure-mode flag` — #253.
6. `docs: regenerate tools.generated.md and update help for breaking
   renames` — final commit. Cross-cutting docs.

Each `!:` commit triggers a major bump on its own. release-please
collapses them into a single major release.

## Deviations

- **#250:** New tool `plugin_dataview_describe_js_query` introduced
  rather than overloading the existing `plugin_dataview_query` schema
  with a `mode` field. Cleaner than mode-dispatch for a stub.
- **#251 V9→V10:** Adds a forward-looking rename for the tool-state
  key inside `extras.toolStates` (`get_date` → `extras_get_date`).
  This is an extra carry-along not explicitly listed in the spec but
  necessary so existing per-tool toggles keep working after the tool
  rename.
- **#253:** Two new persisted fields rather than one
  (`iAcceptInsecureMode` plus `seenInsecureWarning`). The latter is a
  one-shot "we showed the grandfather notice" flag. Used internally
  only — not exposed in UI.
