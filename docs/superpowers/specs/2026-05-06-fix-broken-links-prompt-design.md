# `/fix-broken-links` MCP prompt

- Issue: [#305](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/305)
- Parent: [#293](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/293) ([PR #306](https://github.com/KingOfKalk/obsidian-plugin-mcp/pull/306))
- Parent spec: [`2026-05-03-mcp-prompts-slash-commands-design.md`](2026-05-03-mcp-prompts-slash-commands-design.md)
- Sibling spec: [`2026-05-05-daily-note-prompt-design.md`](2026-05-05-daily-note-prompt-design.md)

## Summary

Ship the `/fix-broken-links` MCP prompt deferred from #293 — the fifth and final canned prompt from that issue's candidate list. The prompt seeds Claude with a `search_unresolved_links` call and a per-link triage loop covering retarget / stub / delete / leave. It runs vault-wide by default; an optional `path` argument scopes the triage to a single source note. No new tool, no new adapter method — pure prompt orchestration over existing primitives.

## Goals

- Register a `/fix-broken-links` MCP prompt with one optional string argument `path`.
- Prompt body steers Claude to call `search_unresolved_links`, then propose **one** fix per broken link as a single tool call so the user confirms each through the host's normal MCP confirmation flow.
- Autocomplete on the `path` argument lists vault notes that currently contain unresolved links, sourced from `adapter.getUnresolvedLinks()`. Empty list → empty completion (correctly signals "nothing to fix").
- Soft-cap to ~20 source notes per vault-wide run, in prompt-body wording only — no new tool argument.
- Tests: handler (vault-wide and single-note variants), completer, integration (`prompts/list`, `prompts/get`, `completion/complete`).
- Update [`docs/help/en.md`](../../help/en.md). No `docs/tools.generated.md` regeneration (no tool added).

## Non-goals

- A new `vault_replace_text` (or similar) tool. The issue mentions the name speculatively; the existing edit primitives (`vault_update`, `vault_create`, `editor_replace`) are sufficient. If a dedicated link-fix tool is needed later, that's a separate issue.
- Auto-applying fixes without user confirmation. The prompt seeds the conversation; the user reviews each proposed edit through Claude's normal tool-call confirmation flow (per #305 out-of-scope).
- A "rename the existing note to fix many-to-one typos" strategy. Reserved for a future enhancement; would inflate the prompt body without addressing the common case.
- Inventing a `limit` / `offset` parameter on `search_unresolved_links`. The cap is enforced via prompt wording only.
- Localization beyond English (consistent with the rest of the MCP surface).
- A new module or adapter method. Everything lands in [`src/server/prompts.ts`](../../../src/server/prompts.ts).
- A settings toggle. The existing `enableMcpPrompts` toggle from #293 covers the new prompt automatically.

## Design decisions

| Decision                              | Choice                                                                                                                  | Rationale                                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt-only vs new tool               | Prompt-only. Reuses `search_unresolved_links`, `vault_read`, `vault_update`, `vault_create`, `editor_replace`.          | The issue's "out of scope" already excludes inventing a `fix-link` tool. Existing edit primitives cover all four fix strategies (retarget / stub / delete / leave).                                                    |
| Argument shape                        | Optional `path: string` (`completable`-wrapped). Omit → vault-wide.                                                     | Matches both real workflows: "I'm cleaning up the whole vault" vs. "I'm repairing *this* note after a rename." Mirrors `/daily-note`'s optional `date`. Defers no value to a sentinel — `undefined` is the no-arg signal. |
| Fix strategies enumerated             | Four: **retarget**, **create stub**, **delete link**, **leave as-is**.                                                  | Covers the realistic outcomes for an unresolved link. "Leave as-is" is explicit so Claude doesn't feel obligated to act on intentional placeholder links (`[[TODO]]`, `[[someday]]`).                                  |
| Tool naming in prompt body            | Tool-explicit (`vault_update`, `vault_create`, `search_fulltext`, `vault_list_recursive`, `editor_replace`).            | Consistent with `summarize-note` / `find-related` / `daily-note`'s tonal style — names tools backtick-fenced. Slight maintenance cost (rename → text update) is already paid by the existing four prompts.             |
| Edit-tool default                     | `vault_update` as default; `editor_replace` only mentioned for the active-editor case.                                  | A vault-wide triage cannot rely on the source note being the active editor. `vault_update` (read → modify → write back) is the universally-applicable verb; `editor_replace` is the optimization.                      |
| Per-fix confirmation                  | Prompt body explicitly says "propose **one** fix as a single tool call so the user can confirm" and "one at a time".    | The MCP host already gates each tool call. The prompt wording prevents Claude from batching multiple `vault_update` calls into one go-ahead, which would defeat the user-review intent from #305.                      |
| Soft cap on vault-wide runs           | Prompt body says "If more than ~20 source notes are returned, work on the first 20 and report the remaining count."     | Out-of-scope to add a new `limit` arg to `search_unresolved_links`. A soft cap is exactly the kind of steering prompts are for. Re-running the prompt is the user's continuation handle.                               |
| Single-note empty case                | Prompt body says "If `path` is not in the result, tell the user the note has no unresolved links and stop."             | Sauberer Exit when a user types a path that turns out to have no broken links. Prevents Claude from inventing fake links to "fix".                                                                                     |
| Autocomplete source                   | `Object.keys(adapter.getUnresolvedLinks())` (the source notes themselves), not all `.md` paths in the vault.            | Semantically correct (you triage a note that has broken links, not a random one), keeps the list small (typically dozens, not thousands), and reuses the same data path the prompt itself triggers — zero extra cost. |
| Completer cap                         | 100 entries (mirrors `templateCompleter`'s `COMPLETER_RESULT_LIMIT`).                                                   | Consistency with the existing completer in [`src/server/prompts.ts`](../../../src/server/prompts.ts).                                                                                                                  |
| Path validation                       | `validateVaultPath(args.path, …)` only when `args.path !== undefined`.                                                  | Matches `summarize-note` / `find-related`'s defense-in-depth pattern; skipping on `undefined` is the natural extension for an optional argument.                                                                       |
| Handler/file location                 | New functions in [`src/server/prompts.ts`](../../../src/server/prompts.ts).                                             | The file is the established home for all prompt handlers. No reason to fragment it.                                                                                                                                    |

## Architecture

```
createMcpServer(...)
  └── registerPrompts(...)            // existing — gains fix-broken-links
        ├── summarize-note            (existing)
        ├── find-related              (existing)
        ├── expand-template           (existing)
        ├── daily-note                (existing)
        └── fix-broken-links          (new)
```

```
prompt: /fix-broken-links [path?]
        │
        ├── if path given:
        │     validateVaultPath(path) — defense in depth
        │
        ├── completer (path argument):
        │     Object.keys(adapter.getUnresolvedLinks())
        │       .filter(case-insensitive substring match)
        │       .slice(0, 100)
        │
        └── handler returns one user-text message instructing Claude to:
              1. call search_unresolved_links
              2. (if path given) filter result to that source; if absent → stop
              3. (vault-wide) work on first ~20 sources, report remainder
              4. for each broken link, propose ONE of:
                   - retarget  → search_fulltext / vault_list_recursive → vault_update
                   - stub      → vault_create
                   - delete    → vault_read → vault_update
                   - leave     → no-op, with rationale
              5. apply fixes one at a time; wait for user confirmation each
```

`McpServer` capability declarations and the `enableMcpPrompts` toggle remain unchanged from #293/PR #306. Nothing about resources, tools, or settings is touched.

## Components

### 1. Handler (`createFixBrokenLinksHandler`)

New function in [`src/server/prompts.ts`](../../../src/server/prompts.ts), modelled on `createSummarizeNoteHandler` / `createDailyNoteHandler`:

```ts
interface FixBrokenLinksArgs {
  path?: string;
}

export function createFixBrokenLinksHandler(
  adapter: ObsidianAdapter,
): (args: FixBrokenLinksArgs) => Promise<GetPromptResult> {
  // async so a synchronous throw from validateVaultPath surfaces as a
  // rejected promise rather than a synchronous throw at the call site.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    if (args.path !== undefined) {
      validateVaultPath(args.path, adapter.getVaultPath());
    }
    const text = args.path
      ? singleNoteBody(args.path)
      : vaultWideBody();
    return userTextMessage(text);
  };
}
```

The two body strings are private constants/functions inside the file. Verbatim wording:

**Vault-wide body** (`args.path === undefined`):

> Fix broken links across the vault. First call `search_unresolved_links` to enumerate them — the result is a `Record<source, Record<target, count>>` mapping each note containing broken links to its unresolved targets. If more than ~20 source notes are returned, work on the first 20 and report the remaining count so the user can re-run this prompt to continue. For each broken link, propose **one** fix as a single tool call so the user can confirm before it's applied:
>
> - **Retarget** to an existing note: locate the intended target with `search_fulltext` or `vault_list_recursive`, then read the source note with `vault_read`, rewrite the link, and write it back with `vault_update` (or `editor_replace` if the source is the active editor and you know the exact range).
> - **Create a stub** for the missing note: call `vault_create` at the link's target path with a minimal placeholder body.
> - **Delete the link**: read the source with `vault_read`, remove just the wikilink (keep surrounding prose), and write back with `vault_update`.
> - **Leave as-is**: skip and explain why (e.g. it's an intentional placeholder).
>
> Apply fixes one at a time. Wait for the user to confirm each tool call before moving on.

**Single-note body** (`args.path` is a backtick-quoted string):

> Fix broken links in `<path>`. First call `search_unresolved_links` and pull out the entry whose source matches `<path>` — the value is a `Record<target, count>` of unresolved targets in this note. If `<path>` is not in the result, tell the user the note has no unresolved links and stop. For each broken link, propose **one** fix as a single tool call so the user can confirm before it's applied:
>
> - **Retarget** to an existing note: locate the intended target with `search_fulltext` or `vault_list_recursive`, then read `<path>` with `vault_read`, rewrite the link, and write it back with `vault_update` (or `editor_replace` if `<path>` is the active editor and you know the exact range).
> - **Create a stub** for the missing note: call `vault_create` at the link's target path with a minimal placeholder body.
> - **Delete the link**: read `<path>` with `vault_read`, remove just the wikilink (keep surrounding prose), and write back with `vault_update`.
> - **Leave as-is**: skip and explain why.
>
> Apply fixes one at a time. Wait for the user to confirm each tool call before moving on.

(`<path>` interpolates as a backtick-fenced literal of `args.path`.)

### 2. Completer (`createUnresolvedSourcesCompleter`)

```ts
export function createUnresolvedSourcesCompleter(
  adapter: ObsidianAdapter,
): (partial: string) => Promise<string[]> {
  // async so the return type matches the SDK's CompleteCallback signature
  // (string[] | Promise<string[]>), keeping this consistent with other
  // async-by-convention callbacks in this module.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (partial) => {
    try {
      const map = adapter.getUnresolvedLinks();
      const needle = partial.toLowerCase();
      return Object.keys(map)
        .filter((p) => p.toLowerCase().includes(needle))
        .slice(0, COMPLETER_RESULT_LIMIT);
    } catch {
      return [];
    }
  };
}
```

`COMPLETER_RESULT_LIMIT = 100` is already defined in [`src/server/prompts.ts`](../../../src/server/prompts.ts) and reused.

### 3. Registration

In `registerPrompts(...)`, after the existing four:

```ts
const fixBrokenLinks = createFixBrokenLinksHandler(adapter);
const unresolvedSourcesCompleter = createUnresolvedSourcesCompleter(adapter);

logger.debug('Registering prompt: fix-broken-links');
server.registerPrompt(
  'fix-broken-links',
  {
    title: 'Triage broken (unresolved) wikilinks',
    description:
      'Enumerate broken wikilinks (vault-wide or for one note) and walk through retargeting, stubbing out, or deleting them.',
    argsSchema: {
      path: completable(
        z
          .string()
          .optional()
          .describe('Optional vault-relative path. Omit to triage the whole vault.'),
        (value) => unresolvedSourcesCompleter(value),
      ),
    },
  },
  (args: { path?: string }, _extra) => fixBrokenLinks(args),
);
```

**Open implementation detail:** the SDK's `completable()` may not accept a `z.optional()` schema directly. If the type check fails, the fallback is to wrap the inner `z.string()` in `completable(...)` and then `.optional()` on the outside, or to define the schema as `z.string().optional()` without `completable()` and rely on the host showing a free-text field. The plan should resolve this experimentally during implementation; either form preserves the prompt's behaviour, only the autocomplete UX is affected.

## Tests

### `tests/server/prompts.test.ts`

New `describe('fix-broken-links handler', ...)` block:

- **No path → vault-wide body**: handler called with `{}` returns one user-role text message; body contains `search_unresolved_links`, `vault_create`, `vault_update`, the four strategy labels (`Retarget`, `Create a stub`, `Delete the link`, `Leave as-is`), and the soft-cap phrase (`~20`). Body does **not** contain "in `" (i.e. the single-note opener).
- **With path → single-note body**: handler called with `{ path: 'notes/foo.md' }` returns one user-role text message; body contains `notes/foo.md` (backtick-fenced), `search_unresolved_links`, the four strategy labels, and the "If … is not in the result, tell the user … and stop" exit phrase.
- **Both bodies enforce per-fix confirmation**: both contain "one at a time" and "propose **one** fix" (or the markdown-rendered equivalent).
- **Path traversal rejected**: `{ path: '../etc/passwd' }` → rejects with `PathTraversalError`.

New `describe('unresolvedSourcesCompleter', ...)` block (mirrors the existing `templateCompleter` tests):

- **Empty map → []**: fresh `MockObsidianAdapter` (no files) → completer returns `[]` for any partial.
- **Filters case-insensitive substring**: adapter populated with three notes whose `metadata.links` reference missing targets, completer with partial `'WeEK'` returns only the matching source.
- **Cap at 100**: adapter populated with 150 notes that each have one unresolved link, completer with empty partial returns 100 entries.
- **Adapter throw → []**: a throwing adapter does not propagate.

### `tests/integration/prompts.test.ts`

Extend the existing single test to cover the new prompt:

- Update the `prompts/list` expected array to include `'fix-broken-links'` (now five entries).
- Add a `prompts/get` smoke check for `fix-broken-links` with no arguments — assert the response has one message and contains `search_unresolved_links`.
- Add a `prompts/get` smoke check for `fix-broken-links` with `{ path: 'notes/foo.md' }` — assert the body contains `notes/foo.md`.
- Add a `completion/complete` check for the `path` argument: pre-populate the mock adapter with a note whose metadata declares an unresolved link, then call `client.complete({ ref: { type: 'ref/prompt', name: 'fix-broken-links' }, argument: { name: 'path', value: '<partial>' } })` and assert the source path appears in `completion.values`.

The mock's `getUnresolvedLinks()` derives broken links from `file.metadata.links`, so tests populate by adding files with link metadata that points at missing targets — no new mock setter required. (See [`src/obsidian/mock-adapter.ts:287-300`](../../../src/obsidian/mock-adapter.ts#L287-L300).)

## Documentation

- [`docs/help/en.md`](../../help/en.md), under `## Prompts`:
  - Bump the count in the section intro (`four canned MCP prompts` → `five canned MCP prompts`).
  - Add `/fix-broken-links` to the host-rendering example line (`/mcp__obsidian__fix-broken-links`).
  - Update the **Settings** table row (currently lists the four prompts in the description) to include the fifth.
  - New bullet under **Available prompts**:

    > **`fix-broken-links`** — argument: `path` (optional, vault-relative). Enumerates broken `[[wikilinks]]` via `search_unresolved_links` and walks Claude through fixing them — retarget to an existing note, create a stub, or delete the link. With `path`, scopes to that one source note; without, walks the whole vault (capped at ~20 source notes per run, re-run to continue). Each proposed edit lands as a separate tool call so you confirm or reject one at a time. Autocomplete on `path` lists vault notes that currently contain unresolved links.
- No `docs/tools.generated.md` regeneration needed — no new tool registered.
- Locale siblings of `docs/help/en.md`: at the time of writing, none exist (`ls docs/help/` shows `en.md` only). If sibling locales are added before this PR lands, mirror the change.

## Risks & open questions

- **Prompt body becomes the "fix recipe" — drift risk.** If `vault_update` is renamed or `search_unresolved_links` returns a different shape, the prompt body silently misleads Claude. Mitigation: tests assert the tool names appear in the body, so a rename in either tool's name (without a body update) shows up as a failed test. Same approach already used by `summarize-note` / `find-related` tests.
- **`completable()` over `z.optional()`.** The MCP SDK's `completable()` adapter is documented for required string args. If TypeScript/runtime rejects the optional wrapper, see the fallback noted in §Components/Registration. Either fallback ships the prompt; only autocomplete UX degrades.
- **Stale `getUnresolvedLinks()` snapshot.** Obsidian's metadata cache is eventually-consistent. A user who just renamed a note may still see the old broken link in the autocomplete for a few seconds. Acceptable: the same staleness already affects `search_unresolved_links` itself.
- **"Source path matching"-Heuristik bei Single-Note.** The prompt body says "pull out the entry whose source matches `<path>`." `search_unresolved_links` returns vault-relative paths, which match `validateVaultPath`'s normalized form — but if a user passes a path with a leading `/` or trailing whitespace, the prompt-side comparison is up to Claude. Acceptable: `validateVaultPath` already normalizes leading slashes; remaining edge cases are minor and Claude can handle them via natural-language reasoning.
- **20-sources soft cap is a heuristic.** A vault with 19 source notes that each have 100 broken links still floods the context. Mitigation: future enhancement could cap on total link count, not source count. Out of scope for v1.
