# MCP prompts (slash commands) for vault workflows

**Issue:** [#293](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/293)
**Date:** 2026-05-03
**Status:** Proposed

## Summary

Expose three canned MCP prompts so hosts surface them as slash commands and
users can kick off common vault workflows without spelling out the tool
sequence. Adds a `prompts: {}` capability gated by a new
`promptsEnabled` setting (default on, parallel to `resourcesEnabled`):

- `/summarize-note <path>` — summarize a vault note.
- `/find-related <path>` — surface related notes via `search_fulltext` +
  `vault_get_backlinks`.
- `/expand-template <template>` — discover a template's placeholders and
  walk through filling them in. The `template` argument uses the SDK's
  `completable()` helper to autocomplete against the vault's `templates/`
  folder.

`/daily-note` and `/fix-broken-links` are deferred to follow-up issues
[#304](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/304) and
[#305](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/305) — the
former needs a daily-notes primitive that does not exist yet, and the
latter has no "propose fixes" tool to back it.

## Goals

- Ship the `prompts: {}` capability so hosts can enumerate canned vault
  workflows alongside the existing tools and resources surfaces.
- Three prompts that each map cleanly onto an existing tool combo — no
  new tools invented in this PR.
- Reuse `validateVaultPath` for argument validation (defence in depth).
- Settings toggle `promptsEnabled` independent of `resourcesEnabled`, per
  the issue's scope.
- Keep the implementation self-contained in one file
  (`src/server/prompts.ts`) without widening `ModuleRegistry`.

## Non-goals

- `/daily-note`. Deferred to [#304](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/304)
  pending a decision on whether to add a thin daily-notes tool.
- `/fix-broken-links`. Deferred to [#305](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/305).
- Vault-wide path autocomplete for `/summarize-note` and `/find-related`.
  Only `/expand-template` gets autocomplete in v1; vault-wide completion
  requires a caching/invalidation strategy that is more complexity than
  this PR warrants.
- Sampling-based prompt handlers.
- Embedding `obsidian://vault/{path}` resource references in prompt
  messages. v1 uses text instructions ("call `vault_read`") so prompts
  work whether or not `resourcesEnabled` is on. A follow-up could switch
  to embedded resources once both surfaces are universally enabled.
- Localizing prompt content beyond English (consistent with the rest of
  the MCP surface — only the settings toggle copy is translated).
- Folding prompts into `ModuleRegistry`. Possible later cleanup; out of
  scope here.

## Design decisions

| Decision                  | Choice                                                                                                  | Rationale                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial prompt set        | Three: `summarize-note`, `find-related`, `expand-template`                                              | Each maps directly to existing tools (`vault_read`, `search_fulltext` + `vault_get_backlinks`, `template_expand`). `/daily-note` and `/fix-broken-links` deferred to #304/#305. |
| Prompt naming             | Bare names — `summarize-note`, not `obsidian:summarize-note`                                            | Hosts namespace by server (Claude Code surfaces them as `/mcp__obsidian__summarize-note`); a server-level prefix would double-namespace.                                        |
| `find-related` arguments  | Single `path` — Claude drives the traversal                                                             | Minimal surface; matches the issue's "favor combos of existing tools" guidance. No `depth` or `query` knobs in v1.                                                              |
| `expand-template` args    | Single `template` — handler discovers placeholders, message asks Claude to collect values from the user | Avoids the awkward UX of typing JSON or `key=value` strings into a slash-command field. Discovery is the value-add.                                                             |
| Autocomplete              | `completable()` only on `expand-template`'s `template` argument                                         | Templates folder is small (typically under 50 entries) and cheap to list; vault-wide path completion needs caching. Issue calls autocomplete a "soft enhancement."              |
| Message-content shape     | Plain text in a single user-role message (no embedded resource refs, no system role)                    | Loose coupling: prompts work whether or not `resourcesEnabled` is on. Costs one extra tool-call turn vs. embedding the file.                                                    |
| Settings toggle           | Single global `promptsEnabled`, default `true`                                                          | Matches the `resourcesEnabled` precedent. Per-prompt toggles would be premature.                                                                                                |
| File location             | `src/server/prompts.ts`                                                                                 | Prompts are a different MCP primitive than tools. Side-by-side with `resources.ts` at the server layer; keeps `mcp-server.ts` thin.                                             |
| Handler error policy      | Throw; let the SDK render `prompts/get` error envelopes                                                 | Same as the resources surface — no `handlePromptError` wrapper needed.                                                                                                          |
| Templates folder location | Hardcoded `'templates'` (matches `template_list`/`template_create_from`)                                | Single source of truth; if the convention changes later it changes in one place.                                                                                                |

## Architecture

A new file `src/server/prompts.ts` exports
`registerPrompts(server, adapter, logger)`, called from `createMcpServer`
after `registerResources` when the settings flag is on. Self-contained: it
owns each prompt's `argsSchema`, handler, the placeholder extractor, and
the `templateCompleter` closure. No changes to `ModuleRegistry`.

```
createMcpServer(registry, adapter, settings, logger)
  ├── registerTools(server, registry, logger)        // existing
  ├── if (settings.resourcesEnabled)
  │     registerResources(server, adapter, logger)   // existing
  └── if (settings.promptsEnabled)
        registerPrompts(server, adapter, logger)     // new
```

`McpServer` is constructed with `capabilities.prompts: {}` only when
`settings.promptsEnabled === true`. When false, the capability is omitted
and `registerPrompts` is not called — the host sees a server without a
prompts surface, identical to today.

Three registrations performed inside `registerPrompts`:

```ts
server.registerPrompt('summarize-note',  { title, description, argsSchema }, summarizeNoteHandler);
server.registerPrompt('find-related',    { title, description, argsSchema }, findRelatedHandler);
server.registerPrompt('expand-template', { title, description, argsSchema }, expandTemplateHandler);
```

## Components

`src/server/prompts.ts` exposes `registerPrompts(...)` and contains:

### 1. `extractPlaceholders(body: string): string[]`

Pure helper. Scans a template body for `{{name}}` placeholders matching
`/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g`. Dedupes (preserves first-seen
order). Filters out the built-ins that `template_expand` auto-resolves:
`date`, `time`, `title`. Returns the remaining placeholder names.

### 2. `summarizeNoteHandler(args)`

`argsSchema`:

```ts
{ path: z.string().min(1).describe('Vault-relative path to the note to summarize') }
```

Steps:

1. `validateVaultPath(args.path, adapter.getVaultPath())` — throws
   `PathTraversalError` on bad input.
2. Return:

   ```ts
   {
     messages: [{
       role: 'user',
       content: {
         type: 'text',
         text: `Summarize the note at \`${path}\`. First call \`vault_read\` to fetch its contents, then produce a concise summary covering the main points and any actionable items.`,
       },
     }],
   }
   ```

### 3. `findRelatedHandler(args)`

`argsSchema`:

```ts
{ path: z.string().min(1).describe('Vault-relative path to the seed note') }
```

Steps:

1. `validateVaultPath(args.path, adapter.getVaultPath())`.
2. Return one user-role text message:

   > Find notes related to `{path}`. First read it with `vault_read`,
   > then run `search_fulltext` on its key terms and
   > `vault_get_backlinks` on its path. Cross-reference the results and
   > report the most relevant connections.

### 4. `expandTemplateHandler(args)`

`argsSchema`:

```ts
{
  template: completable(
    z.string().min(1).describe('Vault-relative path to the template file'),
    templateCompleter,
  ),
}
```

Steps:

1. `validateVaultPath(args.template, adapter.getVaultPath())`.
2. `body = await adapter.readFile(template)` — propagates
   `FileNotFoundError` if the template is missing.
3. `placeholders = extractPlaceholders(body)`.
4. Build the message:
   - If `placeholders.length === 0`:
     > Expand the template at `{template}`. It has no user-fillable
     > placeholders — call `template_expand` directly with the template
     > body.
   - Otherwise:
     > Expand the template at `{template}`. It contains these
     > placeholders: `a, b, c`. Ask the user for values for each
     > placeholder, then call `template_expand` with the template body
     > and the variables. If the user wants the result written to a new
     > note, use `template_create_from` instead.
5. Return as one user-role text message.

### 5. `templateCompleter(partial: string): Promise<string[]>`

Closure built inside `registerPrompts(adapter, …)`:

```ts
const templateCompleter = async (partial: string): Promise<string[]> => {
  try {
    const list = adapter.list('templates');
    const needle = partial.toLowerCase();
    return list.files
      .filter((p) => p.toLowerCase().includes(needle))
      .slice(0, 100);
  } catch {
    return [];
  }
};
```

Notes:

- Substring match (case-insensitive) — Obsidian users name templates
  inconsistently; substring beats prefix here.
- Capped at 100 entries; real template folders are typically under 50.
- Folder missing → `[]` (no throw); autocomplete must never error out the
  prompt.
- No caching: in-memory metadata call is cheap, and cache invalidation on
  vault changes is more complexity than v1 needs.

### 6. `registerPrompts(server, adapter, logger)`

Builds the three handlers and the completer, then calls
`server.registerPrompt(...)` three times. `logger.debug('Registering
prompt: <name>')` per registration; no other logging.

## Data flow

### `prompts/get` for `/summarize-note path=notes/foo.md`

```
SDK validates argsSchema → args = { path: "notes/foo.md" }
  → summarizeNoteHandler(args)
     → validateVaultPath("notes/foo.md", vaultPath) → "notes/foo.md"
     → return { messages: [{ role: "user", content: { type: "text", text: "Summarize the note at `notes/foo.md`. ..." } }] }
```

### `prompts/get` for `/find-related path=notes/foo.md`

```
SDK validates argsSchema → args = { path: "notes/foo.md" }
  → findRelatedHandler(args)
     → validateVaultPath → "notes/foo.md"
     → return { messages: [{ role: "user", content: { type: "text", text: "Find notes related to `notes/foo.md`. ..." } }] }
```

### `prompts/get` for `/expand-template template=templates/weekly.md`

```
SDK validates argsSchema → args = { template: "templates/weekly.md" }
  → expandTemplateHandler(args)
     → validateVaultPath → "templates/weekly.md"
     → adapter.readFile → "# {{title}} for {{week}}\n\n{{notes}}"
     → extractPlaceholders → ["week", "notes"]   // {{title}} stripped as built-in
     → return { messages: [{ role: "user", content: { type: "text", text: "Expand the template at `templates/weekly.md`. It contains these placeholders: `week, notes`. ..." } }] }
```

### `completion/complete` for `/expand-template`'s `template` argument with partial="week"

```
SDK routes to templateCompleter("week")
  → adapter.list("templates") → { files: ["templates/weekly.md", "templates/daily.md", ...] }
  → filter substring "week" → ["templates/weekly.md"]
  → return ["templates/weekly.md"]
```

### Bad path (traversal)

```
summarizeNoteHandler({ path: "../etc/passwd" })
  → validateVaultPath throws PathTraversalError
  → SDK maps thrown error to prompts/get error response
```

### Missing template

```
expandTemplateHandler({ template: "templates/missing.md" })
  → validateVaultPath → "templates/missing.md"
  → adapter.readFile throws FileNotFoundError
  → SDK maps thrown error to prompts/get error response
```

## Settings

### Schema change

`McpPluginSettings` gains:

```ts
/** When true, the server exposes canned slash-command prompts via the MCP prompts surface. */
promptsEnabled: boolean;
```

`DEFAULT_SETTINGS.promptsEnabled = true`.

### Migration

`src/settings/migrations.ts` adds a v11 → v12 step:

- Bump `schemaVersion` from 11 to 12.
- Set `promptsEnabled: true` if the field is missing (existing installs
  opt in by default).
- Update the migration-chain test fixture and the `debug-info`
  schemaVersion fixture to reflect v12.

### UI

`src/settings/server-section.ts` gains one toggle, sibling to the
resources toggle:

- Label: "Expose MCP slash-command prompts" (en string; translatable).
- Description: "When on, hosts can run canned vault workflows
  (`/summarize-note`, `/find-related`, `/expand-template`) through the
  MCP prompts surface. Restart the server to apply changes."
- Bound to `settings.promptsEnabled` with `saveSettings` on change, same
  pattern as other server-section toggles.

A server restart is required for the change to take effect — same as
other server-affecting settings today; no special handling beyond the
existing "restart the server" hint.

## Testing

New file: `tests/server/prompts.test.ts`. Tests use mock `ObsidianAdapter`
instances built with the project's existing patterns (see
`tests/__mocks__/obsidian.ts` and `tests/server/resources.test.ts`).

### `extractPlaceholders`

- Empty body → `[]`.
- Single placeholder (`{{name}}`) → `['name']`.
- Repeated placeholder (`{{a}}{{a}}`) → `['a']` (deduped).
- Mixed with built-ins (`{{date}} {{title}} {{author}}`) → `['author']`
  (built-ins stripped).
- Malformed (`{{ name }}` with spaces, `{{name`, `{{}}`) → not matched.
- Order preserved by first-seen (`{{b}}{{a}}` → `['b', 'a']`).

### `summarize-note` handler

- Valid path → returns one user-role text message containing the path
  verbatim and naming `vault_read`.
- Traversal path (`../etc/passwd`) → throws `PathTraversalError`.
- Empty path → schema rejects via `z.string().min(1)`.

### `find-related` handler

- Valid path → returns one user-role text message naming
  `search_fulltext` and `vault_get_backlinks`.
- Traversal path → throws `PathTraversalError`.

### `expand-template` handler

- Template with `{{a}} {{b}}` → message lists `a, b` as placeholders.
- Template with only built-ins (`{{date}}`) → message says "no
  user-fillable placeholders".
- Template with duplicates (`{{a}}{{a}}{{b}}`) → message lists `a, b`
  once each.
- Missing template file → propagates `FileNotFoundError`.
- Traversal path → throws `PathTraversalError`.

### `templateCompleter`

- Empty partial → returns up to 100 entries from `templates/`.
- Partial matches a template name (substring, case-insensitive) →
  filtered list.
- Templates folder missing → `[]` (no throw).
- Vault has 200 templates → result capped at 100.

### Settings-toggle gating

- `createMcpServer` with `promptsEnabled: false` → server capabilities
  exclude `prompts`; no prompt registrations performed.
- `promptsEnabled: true` → all three prompts registered and
  `capabilities.prompts === {}`.

### Settings migration

- v11 settings (no `promptsEnabled`) → migrated to v12,
  `promptsEnabled: true`.
- v12 settings with explicit `false` → preserved.
- Full migration-chain test (v0 → v12) passes.

### Integration smoke test

In `tests/server/mcp-server.test.ts` (or co-located): an end-to-end
`prompts/list` + `prompts/get` round-trip via the in-memory MCP transport,
confirming SDK wiring actually surfaces the three prompts. A second
round-trip drives `completion/complete` for `/expand-template`'s
`template` argument and asserts the completer is invoked.

## Documentation

CLAUDE.md rule 5 requires the user manual to stay in sync with
user-facing surface changes.

- `docs/help/en.md` — add a "Prompts (slash commands)" section under the
  MCP surface description, mirroring the structure of the Resources
  section. Covers:
  - The three prompts with their argument signatures and one-sentence
    purpose.
  - That `template` autocompletes against the `templates/` folder.
  - The `promptsEnabled` settings toggle.
  - Brief: hosts surface them as slash commands (e.g. Claude Code shows
    `/mcp__obsidian__summarize-note`).
- `docs/help/de.md` (and any other locale siblings) — same section
  translated where translations exist.
- `docs/tools.generated.md` — **no change.** Prompts don't live in the
  tool registry, so the generator output is unaffected. Verify by
  running `npm run docs:tools` and confirming a clean diff.

## Files added / modified

### Added

- `src/server/prompts.ts`
- `tests/server/prompts.test.ts`

### Modified

- `src/server/mcp-server.ts` — declare `prompts: {}` capability when
  `settings.promptsEnabled === true`; call `registerPrompts(...)` after
  `registerResources(...)`.
- `src/types.ts` — add `promptsEnabled: boolean` to `McpPluginSettings`
  and to `DEFAULT_SETTINGS` as `true`. Bump `schemaVersion` to 12.
- `src/settings/migrations.ts` — v11 → v12 step.
- `src/settings/server-section.ts` — one new toggle.
- `src/lang/locale/en.ts` and `src/lang/locale/de.ts` — strings for the
  new toggle.
- `docs/help/en.md` (and locale siblings) — Prompts section.
- `tests/settings/migrations.test.ts` — v11 → v12 chain test.
- `tests/utils/debug-info.test.ts` — schemaVersion fixture bump.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test` all green.
- `npm run docs:tools` produces no diff.
- Manual smoke test: start server, run `initialize` followed by
  `prompts/list` and `prompts/get` for each of the three prompts; confirm
  that `promptsEnabled: false` causes the capability to disappear and
  `prompts/list` returns "Method not found" or empty per the host.
