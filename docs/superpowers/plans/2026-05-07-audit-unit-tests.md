# Audit Unit Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead and abandoned tests under `tests/` and surface low-value tests for maintainer review, without changing what the suite verifies.

**Architecture:** Three mechanical sweeps + one per-file walk, gated by `npm test` after each delete. Findings ship as one PR with category-grouped commits; subjective findings live in the PR description for the maintainer to triage.

**Tech Stack:** Vitest, TypeScript, `grep`, `node` for ad-hoc import resolution, `gh` for PR work.

**Spec:** [docs/superpowers/specs/2026-05-07-audit-unit-tests-design.md](../specs/2026-05-07-audit-unit-tests-design.md)

**Issue:** [#285](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/285)

**Branch:** `chore/issue-285-audit-unit-tests` (already created off `main`)

---

## Conventions across all tasks

- **Working directory:** `/workspaces/obsidian-plugin-mcp`
- **In-scope test roots:** `tests/` (including `tests/integration/`). Out of scope: `e2e/`.
- **Worktree exclusion:** ignore everything under `.claude/worktrees/` — these are agent worktrees that contain duplicate copies of the test tree.
- **Green gate:** `npm test` must succeed before each commit. If it fails after a deletion, revert the deletion and reclassify the entry as a subjective finding for the PR description.
- **No code changes outside `tests/`:** never edit `src/`, `e2e/`, or production config.
- **Commit messages:** Conventional Commits, scope `tests` (or `tests/<area>` if narrow), body must include `Refs #285`.
- **No AI attribution** in commit messages or PR description.
- **Grep helper:** when running `grep -r` against `tests/`, exclude worktrees: `grep -rEn ... tests/ --exclude-dir=worktrees`. Worktrees live under `.claude/worktrees/` not `tests/`, so this is not strictly needed when starting from `tests/`. But verify the search did not pick up paths beginning with `.claude/worktrees/` before acting on results.

---

## File Structure

This plan does not create new source files. It deletes test files / blocks / fixtures, and creates one transient artifact:

- **Created:** `docs/superpowers/findings/2026-05-07-audit-unit-tests-findings.md` — running scratchpad for subjective findings during Phase 2. Used to assemble the PR description; deleted before pushing the branch.
- **Modified / deleted:** files under `tests/` only.

---

## Task 1: Baseline check

**Files:**
- None modified.

- [ ] **Step 1: Confirm we are on the right branch**

Run: `git rev-parse --abbrev-ref HEAD`
Expected: `chore/issue-285-audit-unit-tests`

If not on that branch, stop and switch: `git checkout chore/issue-285-audit-unit-tests`.

- [ ] **Step 2: Confirm working tree is clean**

Run: `git status --short`
Expected: empty output (the design doc was already committed in the brainstorming step).

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: all tests pass.

If any test fails on `main` baseline, stop and report — the audit cannot proceed against a red suite.

- [ ] **Step 4: Capture baseline test count**

Run: `npm test 2>&1 | tail -20`
Record the line that reports total tests (e.g. `Tests  XYZ passed`). Save this number for the PR description; you'll compare it after each commit.

- [ ] **Step 5: Create the scratchpad for subjective findings**

Create file `docs/superpowers/findings/2026-05-07-audit-unit-tests-findings.md` with this initial content:

```markdown
# Subjective findings — issue #285 audit

Format per line: `path:line — pattern: rationale`

## Trivially-passing / mock-only candidates

(append during Phase 2)

## Skip/todo entries needing maintainer call

(append during the skip/todo sweep)

## Follow-up issues to open

(append throughout the audit)
```

This file is **not** committed. It is gitignored by virtue of being created on a feature branch and deleted at the end. Verify:

Run: `cat .gitignore | grep -i findings || true`
Expected: no result (it's not gitignored, but we'll delete it before pushing).

---

## Task 2: Sweep — tests for removed/renamed code paths

**Goal:** Delete tests whose imported `src/` symbols no longer exist.

**Files:**
- Modify or delete: any file under `tests/` flagged by the import scan.

- [ ] **Step 1: List all test files in scope**

Run:
```bash
find tests -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) | sort
```
Expected: ~50 files. None should start with `.claude/`. Save this list as the input for the next step.

- [ ] **Step 2: For each test file, parse imports that resolve into `src/`**

For each file in the list, extract import lines via:
```bash
grep -nE "^import .* from ['\"]\.\./" <test-file>
```
And import lines that resolve to `src/` (relative paths from `tests/...` typically look like `../../src/...` or `../src/...`).

Write the result to a transient list of `(test-file, import-path, imported-symbols)` tuples. You can keep this in your working memory or use a `/tmp` scratchpad — do not commit it.

- [ ] **Step 3: For each imported symbol, verify it still exists at the resolved path**

Resolve the import path relative to the test file. For each imported symbol, grep the resolved file for the symbol's definition.

Example check:
```bash
# test imports { fooBar } from '../../src/utils/foo'
# Resolved path: src/utils/foo.ts
grep -nE "(^|\s)(export (const|function|class|interface|type|enum) fooBar\b|export \{[^}]*\bfooBar\b[^}]*\})" src/utils/foo.ts
```
Mismatch (zero hits) → flag the test file (or the affected `describe`/`it` block) for deletion.

If the resolved path itself does not exist (file was renamed/removed), the entire test file targeting it is a deletion candidate.

- [ ] **Step 4: Build the deletion worklist**

For each candidate, decide:
- Whole file gone or broken? → delete the whole file (`rm tests/.../X.test.ts`).
- Only some `describe`/`it` blocks reference dead symbols? → delete just those blocks.

Document each entry with `path[:block-name] — reason: <import or symbol> no longer exists at <resolved-path>`. Save these notes for the commit body.

- [ ] **Step 5: Apply deletions**

Use the Read + Edit tools (for partial-file edits) or `git rm` (for whole-file deletions). Do not reformat untouched code.

After each deletion:
- Re-run `npm test`. Green → continue. Red → revert this deletion (`git checkout -- <file>` or `git restore <file>`) and append to the scratchpad's "Subjective findings" section as `path:line — dead-import deletion failed: <error>`. Move on.

- [ ] **Step 6: Run full lint + typecheck + tests on the resulting worklist**

Run sequentially:
```bash
npm run lint
```
Expected: pass.

```bash
npm run typecheck
```
Expected: pass.

```bash
npm test
```
Expected: pass; total test count = baseline minus the number of deleted tests.

If any of these fail, fix only the test side (never touch `src/`). If a fix isn't trivial, revert the offending deletion and reclassify.

- [ ] **Step 7: Commit**

If at least one test/file was deleted:

```bash
git add -A tests/
git commit -m "$(cat <<'EOF'
chore(tests): drop tests for removed code paths

<bulleted list of deletions, one per line: file or file:block — reason>

Refs #285
EOF
)"
```

If zero deletions, skip this step entirely (no empty commit).

---

## Task 3: Sweep — abandoned `.skip` / `.todo` tests

**Goal:** Decide each skipped or todo'd test: delete (abandoned), unskip (still relevant and passing), or flag (subjective).

**Files:**
- Modify or delete: test files containing skipped/todo'd blocks.

- [ ] **Step 1: Build the skip/todo worklist**

Run:
```bash
grep -rEn "\b(it|describe|test)\.(skip|todo)\b|^\s*x(it|describe)\b" tests/
```
Expected: a list of file:line:matched-text entries. Capture all of them.

If the list is empty, skip to Step 6 and do not commit.

- [ ] **Step 2: For each entry, check git history for context**

For each `path:line` in the worklist:

```bash
git log --oneline -- <path> | head -10
git blame -L <line>,<line> -- <path>
```

Look for: an issue number reference, a commit message explaining why it was skipped, or any indication that this is intentional and ongoing.

- [ ] **Step 3: For each entry, classify**

Use this decision tree:
1. The skip references an open GitHub issue (e.g. `// see #123`) → leave; record in scratchpad's "Skip/todo entries needing maintainer call" section.
2. The targeted code (function, module, behaviour) no longer exists in `src/` → delete the skipped block. Confirm the target is gone with a quick `grep -rn` against `src/`.
3. The targeted code exists, the skip has no open-issue context, and the test would presumably pass if unskipped → flag in scratchpad as subjective. Do not unskip in this PR (would require running the test, fixing it if broken, and is out of scope).
4. Otherwise → flag in scratchpad as subjective with rationale.

- [ ] **Step 4: Apply class-2 deletions**

For each entry classified as "delete the skipped block":
- Read the file, identify the exact `it.skip(...)` / `describe.skip(...)` block boundaries.
- Edit the file to remove the entire block (including its trailing comma if it's an object-style call, but vitest uses function-style so this is rarely needed).
- If the deletion empties a `describe` block, delete the empty `describe` too.
- If the file becomes empty (no remaining `it`/`describe`), delete the file.

After each deletion: `npm test`. Green → continue. Red → revert and reclassify as subjective.

- [ ] **Step 5: Verify and commit**

If at least one block/file was deleted:

```bash
npm run lint
npm run typecheck
npm test
```
All expected: pass.

```bash
git add -A tests/
git commit -m "$(cat <<'EOF'
chore(tests): drop abandoned .skip and .todo tests

<bulleted list of deletions, one per line: file:line — reason>

Refs #285
EOF
)"
```

- [ ] **Step 6: If nothing was deleted, just record findings**

The scratchpad already holds class-1 and class-3/4 entries; nothing more to do here.

---

## Task 4: Sweep — unreferenced mocks / fixtures

**Goal:** Delete fixture files no test imports; delete unused exports inside referenced fixtures.

**Files:**
- Walk: `tests/__mocks__/`, `tests/obsidian/`, and any other fixture-shaped directories under `tests/` (e.g. `tests/fixtures/` if present).
- Delete: any file with zero importers.

- [ ] **Step 1: Enumerate fixture files**

Run:
```bash
find tests/__mocks__ tests/obsidian -type f 2>/dev/null | sort
ls tests/ | grep -iE 'fixture|mock|stub' || true
```
Expected: a list of fixture candidates. Capture it.

- [ ] **Step 2: For each fixture file, count importers across the test tree**

For a fixture at `tests/__mocks__/foo.ts`, possible import patterns from other tests are:
```
from '../__mocks__/foo'
from '../../__mocks__/foo'
from 'tests/__mocks__/foo'  (rare)
```

Run for each fixture:
```bash
grep -rEn "from ['\"][^'\"]*$(basename <fixture> .ts)['\"]" tests/ src/ \
  | grep -v "^<fixture-path>:" || true
```
Expected: zero or more importer entries. Zero → deletion candidate.

Be careful with similarly-named files. If `mock-adapter.ts` exists alongside `mock-adapter.test.ts`, the test file is not an importer; refine the grep to ignore the fixture's own path.

- [ ] **Step 3: Special case — `tests/__mocks__/obsidian.ts`**

Per spec: do not modify the body of this file. Verify it has importers (it should — it's the global Obsidian API mock). If it has zero importers, that's a surprise — escalate, don't delete.

For other fixtures: if the file has importers but exports a symbol that no importer uses, delete that single export. Use the Edit tool with the exact export to remove.

- [ ] **Step 4: Apply deletions**

For each unreferenced fixture file:
```bash
git rm tests/__mocks__/<file>.ts
```
Or, for a single unused export, edit the file to remove just that export.

After each deletion: `npm test`. Green → continue. Red → revert (`git restore --staged <file> && git checkout -- <file>`, or undo the edit) and append to scratchpad as subjective.

- [ ] **Step 5: Verify and commit**

If at least one file/export was deleted:

```bash
npm run lint
npm run typecheck
npm test
```
All expected: pass.

```bash
git add -A tests/
git commit -m "$(cat <<'EOF'
chore(tests): drop unreferenced mocks and fixtures

<bulleted list of deletions, one per line>

Refs #285
EOF
)"
```

If nothing was deleted, skip the commit.

---

## Task 5: Per-file walk — trivially-passing & mock-only candidates

**Goal:** Read every in-scope test file once, flag patterns for the maintainer. **No deletions.**

**Files:**
- Read-only: every file under `tests/` matching `*.test.ts` or `*.spec.ts`.
- Append: scratchpad findings file.

- [ ] **Step 1: Build the read list**

Run:
```bash
find tests -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) | sort
```
This is the full per-file walk list. Some files were already deleted in Tasks 2–4; those won't appear.

- [ ] **Step 2: For each file, scan for the four patterns**

Patterns from the spec's "Trivially-passing / mock-only" section:

1. `expect(mock).toHaveBeenCalledWith(x)` where `x` is the same value the test passed in and the function under test is a thin pass-through.
2. Assertion on a hardcoded value that the test itself constructs, with no transformation through real code.
3. Test mocks the function under test, then asserts the mock was called.
4. Test name promises behaviour but body only asserts type/shape.

Open each file. Read it once, top to bottom. For each `it(...)` / `test(...)` block, ask: "If this assertion is satisfied, what did the production code actually do?" If the answer is "nothing meaningful" or "only the mock was exercised," it's a candidate.

- [ ] **Step 3: Append candidates to the scratchpad**

For each candidate, add a line to the "Trivially-passing / mock-only candidates" section of `docs/superpowers/findings/2026-05-07-audit-unit-tests-findings.md`:

```
tests/foo/bar.test.ts:42 — pattern <1-4>: <one-line rationale>
```

Be specific in the rationale. "Looks weird" is unacceptable. "Asserts mock returned the value the test stubbed" or "asserts on `result.length === 3` after constructing a 3-element fixture and skipping the function under test" — that's the level.

- [ ] **Step 4: Open follow-up findings**

If during the walk you spot anything that's _not_ in scope but worth tracking — a real bug, missing coverage of a live code path, a refactor opportunity in `src/` — note it in the "Follow-up issues to open" section of the scratchpad. Format: `<short title> — <one-paragraph context>`.

Do **not** open issues yet; that happens in Task 6.

- [ ] **Step 5: No commit for this task**

The scratchpad is not committed. The findings will land in the PR description in Task 7.

---

## Task 6: Open follow-up GitHub issues

**Goal:** File issues for substantive findings, using existing labels only.

**Files:**
- None modified.

- [ ] **Step 1: Review the scratchpad's "Follow-up issues to open" section**

Open `docs/superpowers/findings/2026-05-07-audit-unit-tests-findings.md`. Read each entry.

If the section is empty, skip this task.

- [ ] **Step 2: List existing labels**

Run:
```bash
gh label list --limit 100
```
Capture the available labels. Do not create new ones.

- [ ] **Step 3: For each entry, open one issue**

For each entry:
```bash
gh issue create \
  --title "<short title>" \
  --body "<context paragraph>

Found during audit in #285." \
  --label "<existing-label>"
```

Pick the most accurate existing label (`test`, `bug`, `enhancement`, etc.). If no label fits cleanly, omit `--label`.

- [ ] **Step 4: Record issue links in the scratchpad**

Edit the scratchpad's "Follow-up issues to open" section: prefix each entry with the resulting issue URL, so the PR description can link them.

---

## Task 7: PR — push, open, attach findings

**Goal:** Push the branch, open the PR, paste the subjective findings into the description.

**Files:**
- Delete locally (not committed): the scratchpad findings file.

- [ ] **Step 1: Final verification**

```bash
npm run lint
npm run typecheck
npm test
```
All expected: pass. Capture the final test count.

- [ ] **Step 2: Verify commit log**

```bash
git log --oneline main..HEAD
```
Expected: between 1 and 4 commits — the design-doc commit (already there), and 0–3 cleanup commits depending on what was found. Each cleanup commit's subject must follow `chore(tests): ...`.

- [ ] **Step 3: Build the PR description**

Open the scratchpad. Assemble the PR description using this template:

```markdown
Closes #285

## Summary

- Removed N tests for removed code paths
- Removed M abandoned skips / todos
- Removed K unreferenced mocks / fixtures

(Adjust counts; omit lines that are zero.)

## Baseline

- Before: <baseline-count> tests passing
- After: <final-count> tests passing
- Lint, typecheck, tests: green

## Subjective findings

The following tests look low-value but I left them in place. Please tick the ones to delete; I'll follow up with a single deletion commit on this branch.

- [ ] tests/foo/bar.test.ts:42 — pattern 1: <rationale>
- [ ] tests/baz.test.ts:107 — pattern 3: <rationale>
...

## Skip / todo entries kept

(If any class-1 or class-3/4 entries from Task 3 — list them with rationale. Omit section if empty.)

## Follow-up issues opened

- #<n> <title>
- #<n> <title>

(Omit section if empty.)
```

Save this text as a temp file, e.g. `/tmp/pr-body.md`, **outside the repo**.

- [ ] **Step 4: Delete the scratchpad**

The scratchpad is local-only and must not land in the PR.

```bash
rm docs/superpowers/findings/2026-05-07-audit-unit-tests-findings.md
git status
```
Expected: working tree clean (the file was never committed). If it shows as untracked, it's correctly removed; nothing to commit.

If the directory `docs/superpowers/findings/` is now empty, leave it — it's harmless and not committed.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin chore/issue-285-audit-unit-tests
```

- [ ] **Step 6: Open the PR**

```bash
gh pr create \
  --title "chore(tests): audit and remove dead test cases" \
  --body-file /tmp/pr-body.md
```

Expected: the PR URL is printed. Open it in the browser to verify the description rendered correctly and the checkboxes are clickable.

- [ ] **Step 7: Stop**

Do not merge the PR. The maintainer reviews the diff, ticks the subjective items they want gone, and either you (in a follow-up session) or they handle the per-item deletion commit. CI must be green.

---

## Self-Review

**1. Spec coverage**

| Spec section                       | Plan task(s)         |
| ---------------------------------- | -------------------- |
| Goal & scope                       | Header, Task 1       |
| Removed code paths rules           | Task 2               |
| Skip/todo rules                    | Task 3               |
| Unreferenced fixtures rules        | Task 4               |
| Trivially-passing / mock-only flag | Task 5               |
| Risk gate (`npm test` green)       | Tasks 2–4 each       |
| Methodology Phase 0 baseline       | Task 1               |
| Methodology Phase 1 sweeps         | Tasks 2–4            |
| Methodology Phase 2 walk           | Task 5               |
| Methodology Phase 3 follow-ups     | Task 6               |
| PR shape (branch, title, commits)  | Header + Task 2/3/4 commit messages + Task 7 |
| PR description structure           | Task 7 Step 3        |
| Risk control (lint/typecheck/test) | Each commit task + Task 7 Step 1 |
| Success criteria                   | Task 7 (final verification, PR open) |

All sections covered.

**2. Placeholder scan**

- No "TBD" / "TODO" / "implement later" left in the plan body. The phrase "TODO" appears in the scratchpad context but only as a literal user-facing string the maintainer might paste — fine.
- Each step has either an exact command or an exact decision rule. No "add appropriate error handling" placeholders.
- The PR-body template uses `<placeholders>` that the engineer fills in from real counts; this is intended, not a plan failure.

**3. Type / name consistency**

- Branch name `chore/issue-285-audit-unit-tests` consistent across header, Task 1, Task 7.
- Scratchpad path `docs/superpowers/findings/2026-05-07-audit-unit-tests-findings.md` consistent across Tasks 1, 5, 6, 7.
- Commit subject prefixes (`chore(tests): drop ...`) consistent and match the spec's PR shape section.
- Order of cleanup commits: dead imports → skip/todo → fixtures, matching the spec.
