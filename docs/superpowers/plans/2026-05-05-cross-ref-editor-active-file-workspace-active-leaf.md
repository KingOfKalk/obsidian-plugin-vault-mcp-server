# Cross-reference `editor_get_active_file` and `workspace_get_active_leaf` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add symmetric `seeAlso` cross-references between `editor_get_active_file` and `workspace_get_active_leaf` so Claude doesn't confuse the two "what is the user looking at?" tools at tool-selection time.

**Architecture:** Pure data change — two `seeAlso` strings added to existing `describeTool` calls in two different module files (editor and workspace), plus one row added to the parametric `SIBLING_PAIRS` symmetry test. No new infrastructure; the slot, the renderer, and the test helper already exist.

**Tech Stack:** TypeScript (strict), Vitest, Zod for tool schemas, custom `describeTool` doc helper.

**Spec:** [`docs/superpowers/specs/2026-05-05-cross-ref-editor-active-file-workspace-active-leaf-design.md`](../specs/2026-05-05-cross-ref-editor-active-file-workspace-active-leaf-design.md)

**Issue:** [#299](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/299)

**Branch:** `feat/issue-299-cross-ref-editor-active-file-workspace-active-leaf` (already created off `origin/main` at `74c6780`; spec already committed as `822ea05`).

---

## File map

- **Modify** [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts) — append one entry to `SIBLING_PAIRS`. The parametric `it()` block then auto-generates two new symmetry assertions.
- **Modify** [`src/tools/editor/index.ts`](../../../src/tools/editor/index.ts) — add `seeAlso` array to the `editor_get_active_file` `defineTool` block.
- **Modify** [`src/tools/workspace/index.ts`](../../../src/tools/workspace/index.ts) — add `seeAlso` array to the `workspace_get_active_leaf` `defineTool` block.

No new files. No deletions. No schema changes.

---

## Task 1: Cross-reference `editor_get_active_file` and `workspace_get_active_leaf`

**Files:**
- Modify: `tests/registry/tool-titles.test.ts:43-53` (add row to `SIBLING_PAIRS` const)
- Modify: `src/tools/editor/index.ts:327-339` (add `seeAlso` to `editor_get_active_file`)
- Modify: `src/tools/workspace/index.ts:150-162` (add `seeAlso` to `workspace_get_active_leaf`)

### Step 1: Baseline check — make sure the test suite is green before any change

- [ ] **Step 1.1: Run the full test suite as the baseline**

Run: `npm test`

Expected: all tests pass. Note the pass count; we'll compare against it after the changes.

If the baseline is red, stop and surface the failure to the user before continuing — the new failures we are about to add must be cleanly distinguishable from any pre-existing ones.

### Step 2: Write the failing tests first (TDD)

- [ ] **Step 2.1: Add the new pair to `SIBLING_PAIRS`**

In [`tests/registry/tool-titles.test.ts`](../../../tests/registry/tool-titles.test.ts), the `SIBLING_PAIRS` constant currently looks like this (lines 43–53):

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
];
```

The parametric `for (const [a, b] of SIBLING_PAIRS)` block at line 62 will now auto-generate two new tests:

- `editor_get_active_file description names workspace_get_active_leaf`
- `workspace_get_active_leaf description names editor_get_active_file`

- [ ] **Step 2.2: Run the test suite — the two new tests must fail**

Run: `npm test -- tests/registry/tool-titles.test.ts`

Expected: two new failures, both in the `sibling cross-references` describe block:

```
FAIL  sibling cross-references > editor_get_active_file description names workspace_get_active_leaf
FAIL  sibling cross-references > workspace_get_active_leaf description names editor_get_active_file
```

The failure message will look like `expect(received).toContain(expected) … Expected substring: "workspace_get_active_leaf"` because the tool descriptions don't yet name their partners. All other tests should still pass.

If you see anything other than exactly these two new failures, stop and investigate before continuing. (For example: if a third test fails, something else is wrong; if no tests fail, the SIBLING_PAIRS edit didn't take effect.)

### Step 3: Add `seeAlso` to `editor_get_active_file`

- [ ] **Step 3.1: Add the `seeAlso` block**

In [`src/tools/editor/index.ts`](../../../src/tools/editor/index.ts), the `editor_get_active_file` `defineTool` block currently looks like this (lines 327–339):

```ts
        defineTool({
          name: 'editor_get_active_file',
          title: 'Get active file path',
          description: describeTool({
            summary: 'Get the vault-relative path of the currently active file.',
            returns: 'Plain text: the path, e.g. "notes/today.md".',
            errors: ['"No active file" if no file is open.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: getActiveFileOutputSchema,
          handler: h.getActivePath,
          annotations: annotations.read,
        }),
```

Replace it with:

```ts
        defineTool({
          name: 'editor_get_active_file',
          title: 'Get active file path',
          description: describeTool({
            summary: 'Get the vault-relative path of the currently active file.',
            returns: 'Plain text: the path, e.g. "notes/today.md".',
            errors: ['"No active file" if no file is open.'],
            seeAlso: [
              'workspace_get_active_leaf — when you need the active pane/leaf (id and view type), not just the file path.',
            ],
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: getActiveFileOutputSchema,
          handler: h.getActivePath,
          annotations: annotations.read,
        }),
```

Only one field is added: `seeAlso` between `errors` and the `}, readOnlySchema)` argument boundary of the `describeTool` call. The second positional argument (`readOnlySchema`) must remain — it is the schema-arg overload that lets `describeTool` document the shared `response_format` field.

### Step 4: Add `seeAlso` to `workspace_get_active_leaf`

- [ ] **Step 4.1: Add the `seeAlso` block**

In [`src/tools/workspace/index.ts`](../../../src/tools/workspace/index.ts), the `workspace_get_active_leaf` `defineTool` block currently looks like this (lines 150–162):

```ts
        defineTool({
          name: 'workspace_get_active_leaf',
          title: 'Get active leaf',
          description: describeTool({
            summary: 'Get info about the currently-focused leaf (pane).',
            returns: 'JSON: { id, type, ... } describing the active leaf.',
            errors: ['"No active leaf" if no leaf is focused.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: getActiveLeafOutputSchema,
          handler: h.getActiveLeaf,
          annotations: annotations.read,
        }),
```

Replace it with:

```ts
        defineTool({
          name: 'workspace_get_active_leaf',
          title: 'Get active leaf',
          description: describeTool({
            summary: 'Get info about the currently-focused leaf (pane).',
            returns: 'JSON: { id, type, ... } describing the active leaf.',
            errors: ['"No active leaf" if no leaf is focused.'],
            seeAlso: [
              'editor_get_active_file — when you only need the active file\'s path, not the surrounding leaf metadata.',
            ],
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: getActiveLeafOutputSchema,
          handler: h.getActiveLeaf,
          annotations: annotations.read,
        }),
```

The apostrophe inside `file's` is escaped (`\'`) because the surrounding string is single-quoted — matching the existing single-quote convention in this file (see e.g. [`src/tools/workspace/index.ts:209`](../../../src/tools/workspace/index.ts#L209) `Obsidian\'s layout descriptor …`).

### Step 5: Verify the targeted tests now pass

- [ ] **Step 5.1: Re-run the registry-titles test file**

Run: `npm test -- tests/registry/tool-titles.test.ts`

Expected: all tests in the file pass, including the two new ones from Step 2.2.

```
PASS  sibling cross-references > editor_get_active_file description names workspace_get_active_leaf
PASS  sibling cross-references > workspace_get_active_leaf description names editor_get_active_file
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

Expected: clean. `seeAlso?: string[]` is already declared on `ToolDoc` ([`src/tools/shared/describe.ts:38`](../../../src/tools/shared/describe.ts#L38)), so the new field is type-compatible.

- [ ] **Step 6.4: Generated-docs check**

Run: `npm run docs:check`

Expected: no diff. [`docs/tools.generated.md`](../../tools.generated.md) only renders the title / `readOnlyHint` / `destructiveHint` table and does not render `seeAlso` content (per the parent spec at [`2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](../specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md), section "Generated docs"). Adding `seeAlso` strings to two existing tools therefore should not change the generated file.

If `docs:check` reports a diff, run `npm run docs:tools` to regenerate, then read the diff to understand what changed before committing — the parent spec's claim about generator scope may have drifted.

### Step 7: Commit

- [ ] **Step 7.1: Stage the three modified files**

Run: `git add src/tools/editor/index.ts src/tools/workspace/index.ts tests/registry/tool-titles.test.ts`

Verify only those three files are staged:

Run: `git status`

Expected output (substring):

```
Changes to be committed:
        modified:   src/tools/editor/index.ts
        modified:   src/tools/workspace/index.ts
        modified:   tests/registry/tool-titles.test.ts
```

If anything else is staged or modified, stop and clean it up before committing. Per project rules, each commit represents exactly one logical change.

- [ ] **Step 7.2: Commit**

Run:

```bash
git commit -m "$(cat <<'EOF'
feat(tools): cross-reference editor_get_active_file and workspace_get_active_leaf

Add symmetric seeAlso entries so Claude can disambiguate the two
"what is the user looking at?" tools at tool-selection time:

- editor_get_active_file → workspace_get_active_leaf — when you need
  the active pane/leaf (id and view type), not just the file path.
- workspace_get_active_leaf → editor_get_active_file — when you only
  need the active file's path, not the surrounding leaf metadata.

Wording is asymmetric ("not just" vs "only") because
workspace_get_active_leaf already includes filePath in its payload;
the contrast is "richer object" vs "narrower string + cleaner error
on no file", not disjoint data.

Also extend SIBLING_PAIRS in tests/registry/tool-titles.test.ts with
the new pair so the existing parametric symmetry test enforces the
relationship.

Refs #299
EOF
)"
```

No `Co-Authored-By` footer. No AI attribution. (Project CLAUDE.md rule 16 + Rule 2.)

- [ ] **Step 7.3: Verify the commit message**

Run: `git log --oneline -1`

Expected: subject line is exactly `feat(tools): cross-reference editor_get_active_file and workspace_get_active_leaf`.

Run: `git log -1 --format=%B | head -25`

Expected: full message body matches the heredoc above.

### Step 8: Push and open the PR

- [ ] **Step 8.1: Push the branch**

Run: `git push -u origin feat/issue-299-cross-ref-editor-active-file-workspace-active-leaf`

Expected: branch creates on the remote. (Spec commit `822ea05` and the new feat commit are both included.)

- [ ] **Step 8.2: Open the pull request**

Run:

```bash
gh pr create --title "feat(tools): cross-reference editor_get_active_file and workspace_get_active_leaf" --body "$(cat <<'EOF'
Closes #299.

## Summary

- Add symmetric `seeAlso` entries between `editor_get_active_file` and `workspace_get_active_leaf` so Claude can disambiguate the two "what is the user looking at?" tools at tool-selection time.
- Extend `SIBLING_PAIRS` in `tests/registry/tool-titles.test.ts` with the new pair — the existing parametric symmetry test then enforces both directions automatically.

Implements the second of three deferred sibling pairs from the parent spec [`2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md). The first deferred pair shipped in #310; the third (`template_create_from` ↔ `template_expand`) remains open.

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

- Spec "Code changes → editor_get_active_file" → covered by Step 3.
- Spec "Code changes → workspace_get_active_leaf" → covered by Step 4.
- Spec "Code changes → SIBLING_PAIRS" → covered by Step 2.1.
- Spec "Verification gate (4 commands)" → covered by Steps 6.1–6.4.
- Spec "Branch and commits" → branch already exists; spec already committed; one feat commit per Step 7; PR per Step 8. (The spec also mentions a separate `docs(plans):` commit for this plan file — that lands as part of the brainstorming → writing-plans handoff, not as a step inside Task 1.)
- Spec "Generated docs / User manual" → no changes required; Step 6.4 verifies.

**Placeholder scan:** none. Every code change shows the exact before/after; every command shows the expected output; every commit/PR message is a verbatim heredoc.

**Type / name consistency:** `seeAlso` matches the field declared on `ToolDoc` ([`describe.ts:38`](../../../src/tools/shared/describe.ts#L38)). Tool registry names (`editor_get_active_file`, `workspace_get_active_leaf`) match `defineTool` calls verbatim. The new `SIBLING_PAIRS` row uses the same registry names. Apostrophe escaping (`file\'s`) matches the existing single-quote convention in the workspace module.
