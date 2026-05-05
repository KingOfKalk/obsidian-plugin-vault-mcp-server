# Cross-reference `template_create_from` and `template_expand`

- Issue: [#300](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/300)
- Parent: [#289](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/289) ([PR #296](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/pull/296))
- Sibling deferred pairs already shipped: [#298](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/298) ([PR #310](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/pull/310)), [#299](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/299) ([PR #311](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/pull/311))
- Parent spec: [`2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](2026-05-03-tool-titles-and-sibling-cross-refs-design.md)

## Goal

Author the third and final deferred sibling cross-reference listed in the parent spec — the `template_create_from` ↔ `template_expand` pair. Both consume a template; only one writes to the vault. Names alone don't disambiguate them at tool-selection time.

## Non-goals

- New `seeAlso` infrastructure. The slot already exists on `describeTool` ([`src/tools/shared/describe.ts`](../../../src/tools/shared/describe.ts)) and is enforced for symmetry by `SIBLING_PAIRS` in [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts).
- Cross-references for any other near-sibling involving these two tools (e.g. `template_list` ↔ `template_create_from`). Not in the parent spec's deferred list.
- Tool renames, additions, removals, schema changes, or annotation-preset edits.

## Architecture

None. Pure data change — two `seeAlso` strings added to existing `describeTool` calls in one module file, plus one row in the parametric symmetry test.

## Pair shape (why parallel framing fits)

This pair is **cleanly disjoint**, unlike the `editor_get_active_file` ↔ `workspace_get_active_leaf` overlap pair from #299 where one tool's output was a strict subset of the other:

- `template_create_from` takes `templatePath` + `destPath`, **writes** a new vault file, returns plain text `Created <dest> from template <src>`.
- `template_expand` takes an inline template **string**, returns the expanded string, has no side-effects.

Different inputs, different outputs, different side-effects. Parallel "X — when you want A, not B." framing fits — same precedent as `vault_list` ↔ `vault_list_recursive` and `search_tags` ↔ `search_by_tag`.

## Code changes

### [`src/tools/templates/index.ts`](../../../src/tools/templates/index.ts)

Add `seeAlso` to the `template_create_from` `defineTool` block (currently around [`src/tools/templates/index.ts:169-188`](../../../src/tools/templates/index.ts#L169-L188)):

```ts
seeAlso: [
  'template_expand — when you want the expanded template content returned inline, not written to a new vault file.',
],
```

Add `seeAlso` to the `template_expand` `defineTool` block (currently around [`src/tools/templates/index.ts:189-204`](../../../src/tools/templates/index.ts#L189-L204)):

```ts
seeAlso: [
  'template_create_from — when you want the expanded template written to a new vault file, not just returned as text.',
],
```

### [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts)

Append one entry to `SIBLING_PAIRS` (currently [`tests/registry/tool-titles.test.ts:43-54`](../../../tests/registry/tool-titles.test.ts#L43-L54)):

```ts
['template_create_from', 'template_expand'],
```

The parametric `it()` block then auto-generates two new symmetry assertions:

- `template_create_from description names template_expand`
- `template_expand description names template_create_from`

Both pass because `describeTool` renders the partner's registry name verbatim in the `See also:` block.

## Generated docs

[`docs/tools.generated.md`](../../tools.generated.md) does not render `seeAlso` content — per the parent spec's [Generated docs section](2026-05-03-tool-titles-and-sibling-cross-refs-design.md#L235-L246) the generator only emits the per-module title / `readOnlyHint` / `destructiveHint` table.

Re-running `npm run docs:tools` should produce no diff. CI's `npm run docs:check` step verifies this.

## User manual

No changes to [`docs/help/en.md`](../../help/en.md) (or sibling locales). `seeAlso` is protocol-level metadata that hosts surface in their own UI; the manual does not enumerate per-tool descriptions. Same stance as the parent spec and the #298 / #299 specs.

## Tests

No new test cases. The existing parametric symmetry block in [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts) covers the new pair the moment it is added to `SIBLING_PAIRS`.

## Verification gate

The issue's acceptance criteria require all four of these to be clean:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run docs:check`

## Branch and commits

- Branch: `feat/issue-300-cross-ref-template-create-from-expand`, created off `origin/main` at commit `b20197d` (the squash-merge of PR #311).
- Three commits, mirroring the #298 / #299 workflow:
  1. `docs(specs): brainstorm cross-ref for template_create_from and template_expand` — this spec file.
  2. `docs(plans): implementation plan for cross-ref template_create_from and template_expand` — the plan file (added in the writing-plans phase).
  3. `feat(tools): cross-reference template_create_from and template_expand` — the two `seeAlso` entries plus the new `SIBLING_PAIRS` row. Footer: `Refs #300`.
- PR title mirrors the feat commit subject. PR body has `Closes #300`, a Summary section, and a Test plan section listing the four verification commands.

## Risks

- **Wording drift from house style.** Mitigation: follows the existing `vault_list` ↔ `vault_list_recursive` and `search_tags` ↔ `search_by_tag` parallel-pair precedent. Reviewer can spot drift in 30 seconds.
- **Substring overlap in symmetry assertions.** The symmetry assertion uses `expect(description).toContain(name)`. Both new strings include the partner's full registry name verbatim, so this is a non-issue.
- **Accidental cross-name match.** `template_create_from` and `template_expand` share only the `template_` prefix; neither name is a substring of the other, so the `toContain` assertion cannot match the wrong direction.

## Out of scope (explicit)

- Tool renames, additions, removals, or schema changes.
- Editing `readOnlyHint` / `destructiveHint` presets.
- Cross-references for any other near-sibling involving these two tools.
- Anything not in the parent spec's "Deferred" section.
