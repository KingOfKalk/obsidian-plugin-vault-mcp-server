# `/daily-note` prompt and `vault_daily_note` tool

- Issue: [#304](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/304)
- Parent: [#293](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/293) ([PR #306](https://github.com/KingOfKalk/obsidian-plugin-mcp/pull/306))
- Parent spec: [`2026-05-03-mcp-prompts-slash-commands-design.md`](2026-05-03-mcp-prompts-slash-commands-design.md)

## Summary

Ship the `/daily-note` MCP prompt deferred from #293, backed by a new thin `vault_daily_note` tool that wraps Obsidian's `daily-notes` core (internal) plugin. The tool resolves today's (or a user-supplied) daily note path from the plugin's configured `format`/`folder`/`template`, creates the file from the configured template if it's missing, and returns `{ path, created, content }`. The prompt body steers Claude to call `vault_daily_note` and then `workspace_open_file` on the returned path so the note becomes the active leaf.

## Goals

- Add a thin `vault_daily_note` tool that wraps the daily-notes plugin's settings into a single deterministic verb. (Issue #304 prefers a tool over having the prompt assemble paths from settings.)
- Register a `/daily-note` MCP prompt with one optional string argument `date` (`YYYY-MM-DD`).
- Reuse existing primitives (`vault_create`, `vault_read`, `workspace_open_file`, `validateVaultPath`, the template-expand path) — no parallel implementations.
- Hard-fail with a typed error when the `daily-notes` core plugin is disabled, consistent with how `plugin-interop` handles missing plugins (`PluginApiUnavailableError`).
- Tests: adapter, tool, prompt handler, integration registration.
- Update [`docs/help/en.md`](../../help/en.md) and regenerate [`docs/tools.generated.md`](../../tools.generated.md) (`npm run docs:tools`).

## Non-goals

- Weekly / monthly / yearly notes. Daily only for v1.
- Localization beyond English (consistent with the rest of the MCP surface).
- Templater **execution**. When the configured daily-note template contains Templater markers (`<%` … `%>`), the tool copies the template body raw — same policy as [`plugin_templater_describe_template`](../../../src/tools/plugin-interop/index.ts).
- Workspace open from inside the tool. Opening the leaf is left to the prompt's orchestration (`workspace_open_file`), keeping `vault_*` and `workspace_*` cleanly separated as elsewhere in the codebase.
- A `force` / `overwrite` / `recreate` flag. A second call for the same date is naturally idempotent: existing files are read, not rewritten.
- A "defaults fallback" when the daily-notes plugin is disabled. Silent defaults can land notes in the wrong folder; a typed error is the right signal.
- Date DSL beyond ISO `YYYY-MM-DD` (no `today` / `yesterday` / `+1` shortcuts in v1).
- Relative-date timezone overrides. "Today" is local-machine local time, the same definition `daily-notes` itself uses.
- Vault-wide path autocompletion on the `date` argument (dates aren't enumerable).
- A new `daily-notes`-specific module. The tool lives in the existing `vault` module.

## Design decisions

| Decision                              | Choice                                                                                                                  | Rationale                                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool vs prompt-only                   | Add `vault_daily_note` tool; prompt calls it.                                                                           | Date math, format strings, and template resolution are exactly the things a tool should encapsulate. A prompt-only design leaks Obsidian-internal-plugin shape into the prompt text.                                   |
| Tool behavior                         | Resolve + ensure-exists. Returns `{ path, created, content }`. Does not open the leaf.                                  | Matches the issue title ("open or create"). Keeps side effects bounded to a single vault write. Workspace concerns (`workspace_open_file`) are kept separate, mirroring the existing `vault_*` vs `workspace_*` split. |
| Date argument                         | Optional `date: string` validated against `^\d{4}-\d{2}-\d{2}$`. Omitted → today (local time).                          | One-line zod regex; no DSL surface. Local time matches `daily-notes`'s own definition (it formats `moment()` against the configured `format`).                                                                         |
| Plugin-disabled behavior              | Hard error (`PluginApiUnavailableError`).                                                                               | The whole premise is "wrap the daily-notes plugin." Silent defaults could land a note in the wrong folder. The error is a clean signal Claude can surface to the user.                                                 |
| Templater handling                    | If template body contains `<%` … `%>`, copy raw without expansion. Otherwise expand `{{date}} / {{time}} / {{title}}`.  | Templater can run arbitrary user JS — execution must remain client-side, consistent with `plugin_templater_describe_template`. Plain `{{...}}` templates use the existing `template_expand` plumbing.                  |
| Broken-template fallback              | Log a warning and create with empty body if the configured template path can't be read.                                 | The user has explicitly asked for today's daily note; a missing/moved template shouldn't block that. A warning surfaces the misconfiguration without failing the call.                                                 |
| Tool location                         | `src/tools/vault/` (new handler in `handlers.ts`, schema in `schemas.ts`, registration in `index.ts`).                  | The user-facing verb is "give me today's daily note" — a vault operation. Consistent with the rest of the `vault_*` family.                                                                                            |
| Annotations                           | `annotations.additive` preset; `title: 'Open or create the daily note'` set on `defineTool`.                            | Matches `vault_create`'s preset (this tool may write on first call, no destruction). Idempotency is internal logic — kept out of the declared annotations rather than introducing an unused-elsewhere `additiveIdempotent` preset for a single tool.                                                                                    |
| Prompt orchestration                  | Two-step instruction: `vault_daily_note` → `workspace_open_file`. If `created: true`, surface that fact to the user.    | Matches the slash-command mental model ("open or create today's daily note") — emphasis on *open*. Mirrors what Obsidian's own `daily-notes:goto-today` command does end-to-end.                                       |
| Adapter API for plugin settings       | New method `getDailyNotesSettings()` returning `{ format, folder, template } \| null`.                                  | Encapsulates the `app.internalPlugins.plugins['daily-notes']` access (and the unsafe-`any` it requires) inside the adapter, where the rest of the unsafe Obsidian-API surface already lives.                           |
| `format` / `folder` / `template` defaults inside the adapter | The adapter normalizes missing fields to `'YYYY-MM-DD' / '' / ''`, so callers never see undefined.    | Lets the tool stay branchless on the option shape. The "plugin off" branch is the only one callers must handle.                                                                                                        |

## Architecture

```
createMcpServer(...)
  ├── registerTools(...)              // existing — picks up vault_daily_note
  ├── if (resourcesEnabled)
  │     registerResources(...)
  └── if (promptsEnabled)
        registerPrompts(...)          // existing — gains daily-note prompt
```

```
prompt: /daily-note ──▶ vault_daily_note  ──▶ workspace_open_file
                          │
                          ├── adapter.getDailyNotesSettings()
                          ├── moment(...) format ──▶ vault path
                          ├── adapter.exists(path)
                          │     ├── true  → adapter.readFile(path)
                          │     └── false → resolve template body
                          │                   ├── Templater? → copy raw
                          │                   └── plain    → expand {{date/time/title}}
                          │                 → adapter.createFile(path, body)
                          └── return { path, created, content }
```

`McpServer` capability declarations and the `promptsEnabled` toggle remain unchanged from #293/PR #306. Nothing about resources is touched.

## Components

### 1. `ObsidianAdapter.getDailyNotesSettings()`

New method on the [`ObsidianAdapter`](../../../src/obsidian/adapter.ts) interface:

```ts
getDailyNotesSettings(): { format: string; folder: string; template: string } | null;
```

Implementation reads `(app as unknown as { internalPlugins: ... }).internalPlugins.plugins['daily-notes']`. Returns `null` when:

- `internalPlugins` is missing from the host environment (defensive — never expected on a real Obsidian build),
- the plugin entry is missing,
- `plugin.enabled` is `false`,
- or `plugin.instance.options` is `undefined`.

Otherwise returns:

```ts
{
  format: options.format ?? 'YYYY-MM-DD',
  folder: options.folder ?? '',
  template: options.template ?? '',
}
```

The `MockObsidianAdapter` in [`src/obsidian/mock-adapter.ts`](../../../src/obsidian/mock-adapter.ts) gains a backing field plus a setter (`setDailyNotesSettings(value | null)`) so tests can flip "plugin enabled with these settings" / "plugin disabled".

### 2. `vault_daily_note` tool

**Schema** ([`src/tools/vault/schemas.ts`](../../../src/tools/vault/schemas.ts)):

```ts
export const dailyNoteSchema = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional()
    .describe('Optional ISO date (YYYY-MM-DD). Omit for today (local time).'),
  ...responseFormatField,
};
```

**Output schema** (mirrors return shape, consistent with the outputSchema rollout in #279/#286/#287/#288):

```ts
export const dailyNoteOutputSchema = {
  path: z.string(),
  created: z.boolean(),
  content: z.string(),
};
```

**Handler** ([`src/tools/vault/handlers.ts`](../../../src/tools/vault/handlers.ts)) — `dailyNote(params)`:

1. `const settings = adapter.getDailyNotesSettings();`
   `if (!settings) throw new PluginApiUnavailableError('daily-notes plugin is disabled — enable it in Obsidian Settings → Core plugins to use vault_daily_note');`
2. Resolve the target moment using Obsidian's bundled `moment` (imported from `'obsidian'`):
   - `params.date` present → `moment(params.date, 'YYYY-MM-DD', true)` (strict). If `.isValid()` is false, throw a Zod-style validation error message ("date must be a valid calendar date").
   - else → `moment()`.
3. `const filename = m.format(settings.format) + '.md';` (only append `.md` when not already present, e.g. exotic formats like `YYYY-MM-DD.md`).
4. `const path = settings.folder ? \`${settings.folder}/${filename}\` : filename;` Normalize repeated/leading slashes.
5. `validateVaultPath(path, adapter.getVaultPath())` — defense in depth (`format` is user-controlled, could in principle contain path separators).
6. If `await adapter.exists(path)`:
   - `const content = await adapter.readFile(path);`
   - return `makeResponse({ path, created: false, content }, ..., readResponseFormat(params))`.
7. Else, resolve initial body:
   - `if (!settings.template)` → `body = ''`.
   - else, attempt `templateBody = await adapter.readFile(settings.template)`. On read failure → `logger.warn(\`vault_daily_note: configured template "${settings.template}" not readable; creating empty note\`); body = '';`.
   - On read success: detect Templater markers (`templateBody.includes('<%')`).
     - Templater → `body = templateBody;` (raw copy).
     - Plain → `body = expandBuiltinPlaceholders(templateBody, m, basenameOf(path));` — reuse the existing template-expand path's `{{date}} / {{time}} / {{title}}` substitution. (Implementation can be a small helper extracted from the current `template_expand` flow if it isn't already exported, or a direct call to that helper if it is.)
8. Ensure parent folder exists (mirrors `vault_create`'s convention), then `await adapter.createFile(path, body);`.
9. return `makeResponse({ path, created: true, content: body }, ..., readResponseFormat(params))`.

**Registration** ([`src/tools/vault/index.ts`](../../../src/tools/vault/index.ts)):

```ts
defineTool({
  name: 'vault_daily_note',
  title: 'Open or create the daily note',
  description: describeTool({
    summary: "Resolve today's daily-note path from the daily-notes core plugin's settings, creating the note from the configured template if it does not yet exist. Returns { path, created, content }.",
    args: ['date (string, optional, YYYY-MM-DD): omit for today (local time).'],
    examples: ['Use when: starting a daily review and you need today\'s note as context.'],
  }),
  annotations: annotations.additive,
  schema: dailyNoteSchema,
  outputSchema: dailyNoteOutputSchema,
  handler: h.dailyNote,
}),
```

### 3. `/daily-note` prompt

Registered in [`src/server/prompts.ts`](../../../src/server/prompts.ts) alongside the existing three prompts.

```ts
function createDailyNoteHandler(): (args: { date?: string }) => Promise<GetPromptResult> {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    if (args.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error('date must be YYYY-MM-DD');
    }
    const dateClause = args.date ? ` for \`${args.date}\`` : '';
    const dateArg = args.date ? ` with \`date: "${args.date}"\`` : '';
    return userTextMessage(
      `Open the daily note${dateClause}. First call \`vault_daily_note\`${dateArg} — it returns the note's \`path\`, \`content\`, and a \`created\` flag (true when a new note was just created from the configured template). Then call \`workspace_open_file\` with the returned \`path\` so the note becomes the active leaf. If \`created\` is \`true\`, mention to the user that a fresh daily note was just created.`,
    );
  };
}

server.registerPrompt(
  'daily-note',
  {
    title: "Open or create today's daily note",
    description: "Resolve, create-if-missing, and open today's daily note (or a given date).",
    argsSchema: {
      date: z.string().optional().describe('Optional ISO date (YYYY-MM-DD). Omit for today (local time).'),
    },
  },
  (args: { date?: string }, _extra) => dailyNote(args),
);
```

The prompt does **not** depend on the tool being registered — but if the daily-notes plugin is disabled or the `vault_daily_note` tool has been turned off in module settings, Claude will see the resulting tool error and surface it verbatim, which is the right failure mode.

## Tests

### `tests/obsidian/adapter.test.ts` (or sibling)

- `getDailyNotesSettings` returns `null` when the internal plugin is missing.
- Returns `null` when the plugin entry exists but `enabled` is `false`.
- Returns `null` when `instance.options` is `undefined`.
- Returns the populated `{ format, folder, template }` shape when all three options are set.
- Falls back to `'YYYY-MM-DD' / '' / ''` when individual options are missing.

### `tests/tools/vault/daily-note.test.ts` (new)

- **Existing-file path:** when the resolved file exists, returns `{ path, created: false, content }` with the file's actual content; does not call `createFile`.
- **Empty-template create:** when `settings.template === ''`, creates the file with `''` and returns `created: true`.
- **Plain-template create:** template body containing `{{date}} / {{title}}` is expanded; resulting note contains the formatted date and the basename.
- **Templater-template create:** template body containing `<%` is copied **verbatim** (no expansion).
- **Broken-template fallback:** template path doesn't exist → tool succeeds with `body = ''` and a logger warning is recorded.
- **Plugin-disabled error:** `getDailyNotesSettings` returns `null` → tool throws `PluginApiUnavailableError` with a message naming the plugin.
- **Malformed `date`:** `date: 'not-a-date'` → input rejected before reaching the handler (zod regex).
- **Out-of-calendar `date`:** `date: '2026-13-40'` → handler-level validation error ("date must be a valid calendar date").
- **Path-traversal-safe:** if `format` evaluates to a value containing `..`, `validateVaultPath` rejects it.
- **Idempotent re-call:** call twice with the same date → second call returns `created: false` and the same content.
- **Folder creation:** when `settings.folder = 'Daily/2026'` and no such folder exists, the parent is created before the file write (mirrors `vault_create`).

### `tests/server/prompts.test.ts`

Extend with a `describe('daily-note handler', ...)` block:

- Returns one user-role text message when called with no arguments. Message names `vault_daily_note` and `workspace_open_file`.
- Threads the `date` argument into the message text and into the suggested `vault_daily_note` call.
- Rejects malformed `date` (`'not-a-date'`) with a clear error.

### `tests/integration/prompts.test.ts`

Extend the existing prompt-listing assertions to include `daily-note` (title, description, arg shape).

## Documentation

- [`docs/help/en.md`](../../help/en.md), under `## Prompts`:
  - Bump the count in the section intro (`three canned MCP prompts` → `four canned MCP prompts`).
  - Add the example name to the host-rendering line (`/mcp__obsidian__daily-note`).
  - New bullet under **Available prompts** describing `daily-note`: the optional `date` argument (ISO `YYYY-MM-DD`, omit for today / local time), the two-tool sequence (`vault_daily_note` then `workspace_open_file`), and the precondition that the `daily-notes` core plugin must be enabled in Obsidian for the underlying tool to work.
- Run `npm run docs:tools` to regenerate [`docs/tools.generated.md`](../../tools.generated.md) — covers `vault_daily_note` automatically from the registry. Per [`CLAUDE.md`](../../../CLAUDE.md) rule 5, CI's `docs:check` step fails otherwise.

## Risks & open questions

- **Internal-plugin shape stability.** `app.internalPlugins.plugins['daily-notes'].instance.options` is undocumented internal API. Mitigation: the adapter wraps the access, normalizes the shape, and treats absent fields as defaults; if Obsidian renames an option in a future release, only one method changes.
- **Format-string injection.** A user could in principle configure `format = '../../etc/passwd'` in the daily-notes plugin. `validateVaultPath` is the backstop. Acceptable: any user who can edit Obsidian settings can already write anywhere in the vault.
- **Templater detection by substring.** `'<%'` is a coarse heuristic. False positives (a non-Templater template that happens to contain `<%`) yield "raw copy" — strictly more conservative than expanding placeholders Obsidian itself wouldn't have expanded. False negatives (Templater template using only `tp.*` JS without `<%` markers) aren't possible — Templater syntax requires the angle-bracket delimiters.
- **Cross-day races.** If midnight ticks between the moment the tool resolves "today" and the file write, the file lands in the previous day's slot. Acceptable: matches Obsidian's own behavior; the user's `date` argument is the escape hatch.
