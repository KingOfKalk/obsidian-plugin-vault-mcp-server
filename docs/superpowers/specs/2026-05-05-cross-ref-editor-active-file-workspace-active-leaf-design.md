# Cross-reference `editor_get_active_file` and `workspace_get_active_leaf`

- Issue: [#299](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/299)
- Parent: [#289](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/289) ([PR #296](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/pull/296))
- Sibling deferred pair: [#298](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/298) ([PR #310](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/pull/310))
- Parent spec: [`2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](2026-05-03-tool-titles-and-sibling-cross-refs-design.md)

## Goal

Author the second of three deferred sibling cross-references listed in the parent spec — the `editor_get_active_file` ↔ `workspace_get_active_leaf` pair. Both answer "what is the user looking at?" — one returns the active file's vault path, the other returns the surrounding leaf (id, view type, plus `filePath`). Names alone don't disambiguate them at tool-selection time.

## Non-goals

- New `seeAlso` infrastructure. The slot already exists on `describeTool` ([`src/tools/shared/describe.ts`](../../../src/tools/shared/describe.ts)) and is enforced for symmetry by `SIBLING_PAIRS` in [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts).
- Cross-references for the third deferred pair (`template_create_from` ↔ `template_expand`). Separate follow-up issue.
- Cross-references for any *other* near-sibling involving these two tools (e.g. `editor_get_content` ↔ `workspace_get_active_leaf`). Not in the parent spec's deferred list.
- Tool renames, additions, removals, schema changes, or annotation-preset edits.

## Architecture

None. Pure data change — two `seeAlso` strings added to existing `describeTool` calls in two different module files, plus one row in the parametric symmetry test.

## Data overlap (why the wording is asymmetric)

Unlike the `editor_set_cursor` ↔ `editor_set_selection` pair (which return distinct shapes), `workspace_get_active_leaf` already includes `filePath` in its payload — the editor tool's full output is a strict subset of the workspace tool's. The contrast is therefore "richer object" vs "narrower string + cleaner error on no file":

- `editor_get_active_file` returns plain text (a path string), errors with `"No active file"` if no file is open.
- `workspace_get_active_leaf` returns `{ id, type, filePath }`; `filePath` can be `null` when the leaf holds no file.

The cross-ref strings reflect this with asymmetric framing — "*not just* the file path" in one direction, "*only* need the active file's path" in the other — rather than the strictly parallel "X — when you want A, not B." form used by the cleanly-disjoint pairs.

## Code changes

### [`src/tools/editor/index.ts`](../../../src/tools/editor/index.ts)

Add `seeAlso` to the `editor_get_active_file` `defineTool` block (currently around [`src/tools/editor/index.ts:327-339`](../../../src/tools/editor/index.ts#L327-L339)):

```ts
seeAlso: [
  'workspace_get_active_leaf — when you need the active pane/leaf (id and view type), not just the file path.',
],
```

### [`src/tools/workspace/index.ts`](../../../src/tools/workspace/index.ts)

Add `seeAlso` to the `workspace_get_active_leaf` `defineTool` block (currently around [`src/tools/workspace/index.ts:150-162`](../../../src/tools/workspace/index.ts#L150-L162)):

```ts
seeAlso: [
  'editor_get_active_file — when you only need the active file\'s path, not the surrounding leaf metadata.',
],
```

Markdown emphasis from the issue sketch (`**pane/leaf**`, `**file's path**`) is dropped — none of the existing `seeAlso` strings use it.

### [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts)

Append one entry to `SIBLING_PAIRS` (currently [`tests/registry/tool-titles.test.ts:43-53`](../../../tests/registry/tool-titles.test.ts#L43-L53)):

```ts
['editor_get_active_file', 'workspace_get_active_leaf'],
```

The parametric `it()` block then auto-generates two new symmetry assertions:

- `editor_get_active_file description names workspace_get_active_leaf`
- `workspace_get_active_leaf description names editor_get_active_file`

Both pass because `describeTool` renders the partner's registry name verbatim in the `See also:` block.

## Generated docs

[`docs/tools.generated.md`](../../tools.generated.md) does not render `seeAlso` content — per the parent spec's [Generated docs section](2026-05-03-tool-titles-and-sibling-cross-refs-design.md#L235-L246) the generator only emits the per-module title / `readOnlyHint` / `destructiveHint` table.

Re-running `npm run docs:tools` should produce no diff. CI's `npm run docs:check` step verifies this.

## User manual

No changes to [`docs/help/en.md`](../../help/en.md) (or sibling locales). `seeAlso` is protocol-level metadata that hosts surface in their own UI; the manual does not enumerate per-tool descriptions. Same stance as the parent spec and the #298 spec.

## Tests

No new test cases. The existing parametric symmetry block in `tests/registry/tool-titles.test.ts` covers the new pair the moment it is added to `SIBLING_PAIRS`.

## Verification gate

The issue's acceptance criteria require all four of these to be clean:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run docs:check`

## Branch and commits

- Branch: `feat/issue-299-cross-ref-editor-active-file-workspace-active-leaf` (already created off `origin/main` at commit `74c6780`).
- Three commits, mirroring the #298 workflow:
  1. `docs(specs): brainstorm cross-ref for editor_get_active_file and workspace_get_active_leaf` — this spec file.
  2. `docs(plans): implementation plan for cross-ref editor_get_active_file and workspace_get_active_leaf` — the plan file (added in the writing-plans phase).
  3. `feat(tools): cross-reference editor_get_active_file and workspace_get_active_leaf` — the three code edits. Body names the two `seeAlso` entries added and the new `SIBLING_PAIRS` row. Footer: `Refs #299`.
- PR title mirrors the feat commit subject. PR body has `Closes #299`, a Summary section, and a Test plan section listing the four verification commands.

## Risks

- **Wording drift from house style.** Mitigation: follows the existing `editor_get_content` ↔ `vault_read` pattern (the closest precedent for an asymmetric overlap pair). Reviewer can spot drift in 30 seconds.
- **Substring overlap in symmetry assertions.** The symmetry assertion uses `expect(description).toContain(name)`. Both new strings include the partner's full registry name verbatim, so this is a non-issue.
- **Accidental cross-name match.** Neither tool's name is a substring of the other (`editor_get_active_file` vs `workspace_get_active_leaf` share no suffix), so the `toContain` assertion cannot match the wrong direction.

## Out of scope (explicit)

- Tool renames, additions, removals, or schema changes.
- Editing `readOnlyHint` / `destructiveHint` presets.
- Cross-references for the third deferred pair (`template_create_from` ↔ `template_expand`).
- Cross-references for any other near-sibling involving these two tools.
