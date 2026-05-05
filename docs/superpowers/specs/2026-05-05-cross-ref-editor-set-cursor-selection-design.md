# Cross-reference `editor_set_cursor` and `editor_set_selection`

- Issue: [#298](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/298)
- Parent: [#289](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/289) ([PR #296](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/pull/296))
- Parent spec: [`2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](2026-05-03-tool-titles-and-sibling-cross-refs-design.md)

## Goal

Author one of the three deferred sibling cross-references listed in the parent spec — the `editor_set_cursor` ↔ `editor_set_selection` pair. Both tools move the caret in the active editor; one collapses to a point, the other selects a range. The names alone don't disambiguate them at tool-selection time.

## Non-goals

- New `seeAlso` infrastructure. The slot already exists on `describeTool` ([`src/tools/shared/describe.ts`](../../../src/tools/shared/describe.ts)) and is already enforced for symmetry by `SIBLING_PAIRS` in [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts).
- Cross-references for the mirror getter pair `editor_get_cursor` ↔ `editor_get_selection`. Those return distinct shapes (`{line, ch}` vs `{from, to, text}`), so the confusion risk is materially lower than between the setters. Not in the issue, not in the parent spec's deferred list.
- Cross-references for the other two deferred pairs (`editor_get_active_file` ↔ `workspace_get_active_leaf`; `template_create_from` ↔ `template_expand`). Each gets its own follow-up issue.

## Architecture

None. This is a pure data change — two `seeAlso` strings added to existing `describeTool` calls, plus one row in the parametric symmetry test.

## Code changes

### `src/tools/editor/index.ts`

Add `seeAlso` to both `defineTool` blocks:

- `editor_set_cursor` (currently around line 440):

  ```ts
  seeAlso: [
    'editor_set_selection — when you want to select a range, not collapse the caret to a point.',
  ],
  ```

- `editor_set_selection` (currently around line 472):

  ```ts
  seeAlso: [
    'editor_set_cursor — when you want to place the caret at a point, not select a range.',
  ],
  ```

The wording follows the contrastive house style established by the editor triple (`editor_insert` / `editor_replace` / `editor_delete`): *"`<sibling>` — when you want `<X>`, not `<Y>`."* The two strings are written so that each describes the partner in terms of the contrast against the current tool — symmetrically, not via "without" / negation asymmetry.

### `tests/registry/tool-titles.test.ts`

Append one entry to `SIBLING_PAIRS`:

```ts
['editor_set_cursor', 'editor_set_selection'],
```

The parametric `it()` block then auto-generates two new symmetry assertions:

- `editor_set_cursor description names editor_set_selection`
- `editor_set_selection description names editor_set_cursor`

Both pass because the `seeAlso` rendering in `describeTool` includes the partner's registry name verbatim.

## Generated docs

[`docs/tools.generated.md`](../../tools.generated.md) does not render `seeAlso` content — per the parent spec's [Generated docs section](2026-05-03-tool-titles-and-sibling-cross-refs-design.md#L235-L246) the generator only emits the per-module title / `readOnlyHint` / `destructiveHint` table.

Re-running `npm run docs:tools` should produce no diff. CI's `npm run docs:check` step verifies this.

## User manual

No changes to [`docs/help/en.md`](../../help/en.md) (or sibling locales). `seeAlso` is protocol-level metadata that hosts surface in their own UI; the manual does not enumerate per-tool descriptions. Same stance as the parent spec.

## Tests

No new test cases. The existing parametric symmetry block in `tests/registry/tool-titles.test.ts` covers the new pair the moment it is added to `SIBLING_PAIRS`.

## Verification gate

The issue's acceptance criteria require all four of these to be clean:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run docs:check`

## Branch and commits

- Branch: `feat/issue-298-cross-ref-editor-set-cursor-selection` (already created off `origin/main`).
- One commit on top of the spec commit:
  - Subject: `feat(tools/editor): cross-reference set_cursor and set_selection`
  - Body: brief — names the two `seeAlso` entries added and the new `SIBLING_PAIRS` row. Footer: `Refs #298`.
- PR title mirrors the commit subject. PR body has `Closes #298`, a Summary section, and a Test plan section listing the four verification commands.

## Risks

- **Wording drift from house style.** Mitigation: follow the existing `editor_insert` / `editor_replace` / `editor_delete` triple's exact pattern. Reviewer can spot drift in 30 seconds.
- **Hidden symmetry: substring overlap.** The symmetry assertion uses `expect(description).toContain(name)`. Both new strings include the partner's full registry name verbatim, so this is a non-issue.

## Out of scope (explicit)

- Tool renames, additions, removals, or schema changes.
- Editing `readOnlyHint` / `destructiveHint` presets.
- The mirror getter pair (`editor_get_cursor` / `editor_get_selection`).
- The other two deferred sibling pairs from the parent spec.
