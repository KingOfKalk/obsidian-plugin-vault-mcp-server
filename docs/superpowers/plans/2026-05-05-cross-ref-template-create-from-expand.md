# Cross-reference `template_create_from` and `template_expand` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add symmetric `seeAlso` cross-references between `template_create_from` and `template_expand` so Claude doesn't confuse the two template-consuming tools at tool-selection time. `template_create_from` writes to the vault; `template_expand` does not.

**Architecture:** Pure data change — two `seeAlso` strings added to existing `describeTool` calls in the same module file (templates), plus one row added to the parametric `SIBLING_PAIRS` symmetry test. No new infrastructure; the slot, the renderer, and the test helper already exist. Pair is cleanly disjoint (different inputs, different outputs, different side-effects), so wording follows the parallel "X — when you want A, not B." precedent of `vault_list` ↔ `vault_list_recursive`.

**Tech Stack:** TypeScript (strict), Vitest, Zod for tool schemas, custom `describeTool` doc helper.

**Spec:** [`docs/superpowers/specs/2026-05-05-cross-ref-template-create-from-expand-design.md`](../specs/2026-05-05-cross-ref-template-create-from-expand-design.md)

**Issue:** [#300](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/300)

**Branch:** `feat/issue-300-cross-ref-template-create-from-expand` (already created off `origin/main` at `b20197d`; spec already committed as `411dd6d`).

---

## File map

- **Modify** [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts) — append one entry to `SIBLING_PAIRS`. The parametric `it()` block then auto-generates two new symmetry assertions.
- **Modify** [`src/tools/templates/index.ts`](../../../src/tools/templates/index.ts) — add `seeAlso` array to two `defineTool` blocks in the same file: `template_create_from` and `template_expand`.

No new files. No deletions. No schema changes.

---

## Task 1: Cross-reference `template_create_from` and `template_expand`

**Files:**
- Modify: `tests/registry/tool-titles.test.ts:43-54` (add row to `SIBLING_PAIRS` const)
- Modify: `src/tools/templates/index.ts:169-188` (add `seeAlso` to `template_create_from`)
- Modify: `src/tools/templates/index.ts:189-204` (add `seeAlso` to `template_expand`)

### Step 1: Baseline check — make sure the test suite is green before any change

- [ ] **Step 1.1: Run the full test suite as the baseline**

Run: `npm test`

Expected: all tests pass. Note the pass count; we'll compare against it after the changes.

If the baseline is red, stop and surface the failure to the user before continuing — the new failures we are about to add must be cleanly distinguishable from any pre-existing ones.

### Step 2: Write the failing tests first (TDD)

- [ ] **Step 2.1: Add the new pair to `SIBLING_PAIRS`**

In [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts), the `SIBLING_PAIRS` constant currently looks like this (lines 43–54):

```ts
const SIBLING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['editor_get_content', 'vault_read'],
  ['vault_list', 'vault_list_recursive'],
  ['search_resolved_links', 'search_unresolved_links'],
  ['extras_get_date', 'vault_get_metadata'],
  ['editor_insert', 'editor_replace'],
  ['editor_insert', 'editor_delete'],
  ['editor_replace', 'editor_delete'],
  ['search_tags', 'search_by_tag'],
  ['editor_set_cursor', 'editor_set_selection'],
  ['editor_get_active_file', 'workspace_get_active_leaf'],
];
```

Replace it with:

```ts
const SIBLING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['editor_get_content', 'vault_read'],
  ['vault_list', 'vault_list_recursive'],
  ['search_resolved_links', 'search_unresolved_links'],
  ['extras_get_date', 'vault_get_metadata'],
  ['editor_insert', 'editor_replace'],
  ['editor_insert', 'editor_delete'],
  ['editor_replace', 'editor_delete'],
  ['search_tags', 'search_by_tag'],
  ['editor_set_cursor', 'editor_set_selection'],
  ['editor_get_active_file', 'workspace_get_active_leaf'],
  ['template_create_from', 'template_expand'],
];
```

The parametric `for (const [a, b] of SIBLING_PAIRS)` block will now auto-generate two new tests:

- `template_create_from description names template_expand`
- `template_expand description names template_create_from`

- [ ] **Step 2.2: Run the test suite — the two new tests must fail**

Run: `npm test -- tests/registry/tool-titles.test.ts`

Expected: two new failures, both in the `sibling cross-references` describe block:

```
FAIL  sibling cross-references > template_create_from description names template_expand
FAIL  sibling cross-references > template_expand description names template_create_from
```

The failure message will look like `expect(received).toContain(expected) … Expected substring: "template_expand"` because the tool descriptions don't yet name their partners. All other tests should still pass.

If you see anything other than exactly these two new failures, stop and investigate before continuing. (For example: if a third test fails, something else is wrong; if no tests fail, the SIBLING_PAIRS edit didn't take effect.)

### Step 3: Add `seeAlso` to `template_create_from`

- [ ] **Step 3.1: Add the `seeAlso` block**

In [`src/tools/templates/index.ts`](../../../src/tools/templates/index.ts), the `template_create_from` `defineTool` block currently looks like this (lines 169–188):

```ts
        defineTool({
          name: 'template_create_from',
          title: 'Create file from template',
          description: describeTool({
            summary: 'Create a file by expanding {{variable}} placeholders in a template.',
            args: [
              'templatePath (string): Template source file.',
              'destPath (string): New file path.',
              'variables (Record<string,string>, optional): Variable map. date/time/title are built in.',
            ],
            returns: 'Plain text "Created <dest> from template <src>".',
            errors: [
              '"File not found" if templatePath is missing.',
              '"File already exists" if destPath is taken.',
            ],
          }, createFromTemplateSchema),
          schema: createFromTemplateSchema,
          handler: h.createFromTemplate,
          annotations: annotations.additive,
        }),
```

Replace it with:

```ts
        defineTool({
          name: 'template_create_from',
          title: 'Create file from template',
          description: describeTool({
            summary: 'Create a file by expanding {{variable}} placeholders in a template.',
            args: [
              'templatePath (string): Template source file.',
              'destPath (string): New file path.',
              'variables (Record<string,string>, optional): Variable map. date/time/title are built in.',
            ],
            returns: 'Plain text "Created <dest> from template <src>".',
            errors: [
              '"File not found" if templatePath is missing.',
              '"File already exists" if destPath is taken.',
            ],
            seeAlso: [
              'template_expand — when you want the expanded template content returned inline, not written to a new vault file.',
            ],
          }, createFromTemplateSchema),
          schema: createFromTemplateSchema,
          handler: h.createFromTemplate,
          annotations: annotations.additive,
        }),
```

Only one field is added: `seeAlso` between `errors` and the `}, createFromTemplateSchema)` argument boundary of the `describeTool` call. The second positional argument (`createFromTemplateSchema`) must remain — it is the schema-arg overload that lets `describeTool` document any shared schema fields. The `seeAlso` string contains no apostrophes, so no escaping is required despite the surrounding single-quote convention.

### Step 4: Add `seeAlso` to `template_expand`

- [ ] **Step 4.1: Add the `seeAlso` block**

In [`src/tools/templates/index.ts`](../../../src/tools/templates/index.ts), the `template_expand` `defineTool` block currently looks like this (lines 189–204):

```ts
        defineTool({
          name: 'template_expand',
          title: 'Expand template inline',
          description: describeTool({
            summary: 'Expand {{variable}} placeholders in a supplied string without writing any file.',
            args: [
              'template (string): Template body containing {{variable}} tokens.',
              'variables (Record<string,string>, optional): Variable map.',
            ],
            returns: 'Plain text: the expanded string.',
          }, expandVariablesSchema),
          schema: expandVariablesSchema,
          outputSchema: templateExpandOutputSchema,
          handler: h.expandVariables,
          annotations: annotations.read,
        }),
```

Replace it with:

```ts
        defineTool({
          name: 'template_expand',
          title: 'Expand template inline',
          description: describeTool({
            summary: 'Expand {{variable}} placeholders in a supplied string without writing any file.',
            args: [
              'template (string): Template body containing {{variable}} tokens.',
              'variables (Record<string,string>, optional): Variable map.',
            ],
            returns: 'Plain text: the expanded string.',
            seeAlso: [
              'template_create_from — when you want the expanded template written to a new vault file, not just returned as text.',
            ],
          }, expandVariablesSchema),
          schema: expandVariablesSchema,
          outputSchema: templateExpandOutputSchema,
          handler: h.expandVariables,
          annotations: annotations.read,
        }),
```

The `seeAlso` field goes between `returns` and the `}, expandVariablesSchema)` argument boundary. Unlike `template_create_from`, this tool has no `errors` array, so `seeAlso` is the last field of the `ToolDoc` object before the schema arg. The `seeAlso` string contains no apostrophes, so no escaping is required.

### Step 5: Verify the targeted tests now pass

- [ ] **Step 5.1: Re-run the registry-titles test file**

Run: `npm test -- tests/registry/tool-titles.test.ts`

Expected: all tests in the file pass, including the two new ones from Step 2.2.

```
PASS  sibling cross-references > template_create_from description names template_expand
PASS  sibling cross-references > template_expand description names template_create_from
```

If either test still fails, the most likely cause is that the `seeAlso` string in Step 3 or Step 4 doesn't contain the partner's exact registry name. Check for typos.

### Step 6: Run the full verification gauntlet (issue acceptance criteria)

The issue requires four checks to be clean before merge.

- [ ] **Step 6.1: Full test suite**

Run: `npm test`

Expected: all tests pass. Pass count should be exactly two higher than the Step 1.1 baseline (the two new sibling-cross-reference assertions).

- [ ] **Step 6.2: Lint**

Run: `npm run lint`

Expected: no errors, no warnings. The change adds only string literals to existing arrays, so lint failures here would be surprising — but the rule is mandatory.

- [ ] **Step 6.3: Type-check**

Run: `npm run typecheck`

Expected: clean. `seeAlso?: string[]` is already declared on `ToolDoc` ([`src/tools/shared/describe.ts`](../../../src/tools/shared/describe.ts)), so the new field is type-compatible.

- [ ] **Step 6.4: Generated-docs check**

Run: `npm run docs:check`

Expected: no diff. [`docs/tools.generated.md`](../../tools.generated.md) only renders the title / `readOnlyHint` / `destructiveHint` table and does not render `seeAlso` content (per the parent spec at [`2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](../specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md), section "Generated docs"). Adding `seeAlso` strings to two existing tools therefore should not change the generated file.

If `docs:check` reports a diff, run `npm run docs:tools` to regenerate, then read the diff to understand what changed before committing — the parent spec's claim about generator scope may have drifted.

### Step 7: Commit

- [ ] **Step 7.1: Stage the two modified files**

Run: `git add src/tools/templates/index.ts tests/registry/tool-titles.test.ts`

Verify only those two files are staged:

Run: `git status`

Expected output (substring):

```
Changes to be committed:
        modified:   src/tools/templates/index.ts
        modified:   tests/registry/tool-titles.test.ts
```

If anything else is staged or modified, stop and clean it up before committing. Per project rules, each commit represents exactly one logical change.

- [ ] **Step 7.2: Commit**

Run:

```bash
git commit -m "$(cat <<'EOF'
feat(tools): cross-reference template_create_from and template_expand

Add symmetric seeAlso entries so Claude can disambiguate the two
template-consuming tools at tool-selection time. Both expand
{{variable}} placeholders; only one writes to the vault:

- template_create_from -> template_expand — when you want the expanded
  template content returned inline, not written to a new vault file.
- template_expand -> template_create_from — when you want the expanded
  template written to a new vault file, not just returned as text.

The pair is cleanly disjoint (different inputs, different outputs,
different side-effects), so wording follows the parallel "X — when
you want A, not B." precedent of vault_list / vault_list_recursive
and search_tags / search_by_tag rather than the asymmetric overlap
form used for editor_get_active_file / workspace_get_active_leaf.

Also extend SIBLING_PAIRS in tests/registry/tool-titles.test.ts with
the new pair so the existing parametric symmetry test enforces the
relationship.

Completes the three deferred sibling pairs from the parent #289 spec:
- editor_set_cursor / editor_set_selection (#298, PR #310)
- editor_get_active_file / workspace_get_active_leaf (#299, PR #311)
- template_create_from / template_expand (this commit)

Refs #300
EOF
)"
```

No `Co-Authored-By` footer. No AI attribution. (Project CLAUDE.md rule 16 + Rule 2.)

- [ ] **Step 7.3: Verify the commit message**

Run: `git log --oneline -1`

Expected: subject line is exactly `feat(tools): cross-reference template_create_from and template_expand`.

Run: `git log -1 --format=%B | head -30`

Expected: full message body matches the heredoc above.

### Step 8: Push and open the PR

- [ ] **Step 8.1: Push the branch**

Run: `git push -u origin feat/issue-300-cross-ref-template-create-from-expand`

Expected: branch creates on the remote. (Spec commit `411dd6d`, the plan commit added during the writing-plans phase, and the new feat commit are all included.)

- [ ] **Step 8.2: Open the pull request**

Run:

```bash
gh pr create --title "feat(tools): cross-reference template_create_from and template_expand" --body "$(cat <<'EOF'
Closes #300.

## Summary

- Add symmetric `seeAlso` entries between `template_create_from` and `template_expand` so Claude can disambiguate the two template-consuming tools at tool-selection time. `template_create_from` writes to the vault; `template_expand` returns the expanded text inline.
- Extend `SIBLING_PAIRS` in `tests/registry/tool-titles.test.ts` with the new pair — the existing parametric symmetry test then enforces both directions automatically.

Completes the three deferred sibling pairs from the parent spec [`2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md). The first two shipped in #310 and #311.

## Test plan

- [x] `npm test` — all tests pass; two new sibling-cross-reference assertions pass.
- [x] `npm run lint` — clean.
- [x] `npm run typecheck` — clean.
- [x] `npm run docs:check` — clean (no diff in `docs/tools.generated.md`; the generator does not emit `seeAlso` content).
EOF
)"
```

No `Co-Authored-By`, no `Generated with`, no Claude session links. (Project rule 2.)

- [ ] **Step 8.3: Report the PR URL**

Print the PR URL returned by `gh pr create` so the user can review it.

---

## Self-review checklist (the planner ran this before saving)

**Spec coverage:**

- Spec "Code changes → template_create_from" → covered by Step 3.
- Spec "Code changes → template_expand" → covered by Step 4.
- Spec "Code changes → SIBLING_PAIRS" → covered by Step 2.1.
- Spec "Verification gate (4 commands)" → covered by Steps 6.1–6.4.
- Spec "Branch and commits" → branch already exists; spec already committed; one feat commit per Step 7; PR per Step 8. (The spec also mentions a separate `docs(plans):` commit for this plan file — that lands as part of the brainstorming → writing-plans handoff, not as a step inside Task 1.)
- Spec "Generated docs / User manual" → no changes required; Step 6.4 verifies.

**Placeholder scan:** none. Every code change shows the exact before/after; every command shows the expected output; every commit/PR message is a verbatim heredoc.

**Type / name consistency:** `seeAlso` matches the field declared on `ToolDoc` in [`src/tools/shared/describe.ts`](../../../src/tools/shared/describe.ts). Tool registry names (`template_create_from`, `template_expand`) match `defineTool` calls verbatim. The new `SIBLING_PAIRS` row uses the same registry names. No apostrophes in either `seeAlso` string, so no escaping concerns despite the surrounding single-quote convention.
