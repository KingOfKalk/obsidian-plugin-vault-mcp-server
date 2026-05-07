# Audit unit tests for leftover junk

- **Issue:** [#285](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/285)
- **Date:** 2026-05-07
- **Status:** approved

## Goal

Reduce noise in the test suite by removing tests that no longer exercise live code, and surface low-value tests for the maintainer's review — without changing what the suite actually verifies.

## Scope

In scope:

- All test files under `tests/`, including `tests/integration/`
- Categories:
  - Tests covering removed/renamed code paths
  - Skipped / `.skip` / `.todo` / `xit` / `xdescribe` tests
  - Mocks and fixtures no longer referenced by any test
  - Trivially-passing assertions and tests that test the mock instead of the code

Out of scope:

- `e2e/specs/`
- Duplicate coverage across files
- Slow / flaky test investigation
- Adding new tests, restyling existing tests, fixing real bugs uncovered (those become follow-up issues)
- Changes to production code under `src/`

Non-goals:

- Coverage tooling, vitest timing runs, repeated-run flake detection
- A reusable audit script committed to the repo

## Decision rules per category

### Removed / renamed code paths — delete inline

- Read each test file's `import` statements.
- For each imported symbol from `src/`, verify the path resolves and the symbol still exists at that path. If the path is gone or the symbol is gone, the test (or the affected `describe` / `it` block) is dead — delete.
- If the import resolves but the test references a method or field of the imported object that no longer exists, treat the same way.
- If a file's entire test surface is dead, delete the file. If only some blocks are dead, delete just those blocks.

### Abandoned `.skip` / `.todo` — delete or unskip

For every `it.skip` / `describe.skip` / `it.todo` / `test.skip` / `xit` / `xdescribe`:

- Inspect `git log -- <file>` and `git blame` for the line.
- If the skip references an open issue → leave; note in PR description.
- If the targeted code no longer exists → delete the skipped block.
- If the targeted code exists and there is no open-issue context → flag in PR description as a subjective item (unskip, delete, or leave — maintainer decides).

### Unreferenced mocks / fixtures — delete inline

- Walk `tests/__mocks__/`, `tests/obsidian/`, and any other fixture-looking directories.
- For each fixture file, grep the test tree for an `import` path that resolves to it. Zero references → delete the file.
- For exports inside referenced fixture files: if a single export is unused everywhere, delete that export (not the file).
- Do not modify the content of `tests/__mocks__/obsidian.ts` (only delete unused exports if any).

### Trivially-passing / mock-only — flag for maintainer review

Per-test-file pass. Patterns to flag:

- Assertion is `expect(mock).toHaveBeenCalledWith(x)` where `x` is the same value the test passed in, and the function under test is a thin pass-through.
- Assertion is on a hardcoded value the test itself constructs, with no transformation through real code.
- Setup mocks the function under test and the assertion is that the mock was called.
- Test name promises behaviour but the body only asserts type or shape.

Each finding goes into the PR description as `tests/foo.test.ts:42 — <pattern>: <one-line rationale>`. Maintainer decides per item; deletions land in a follow-up commit on the same branch.

### Risk gate (all categories)

`npm test` must stay green before and after each commit. Any "delete inline" decision that turns the suite red gets reverted and the entry reclassified as subjective.

## Methodology

### Phase 0 — baseline

- Run `npm test`. Suite must be green. Capture the test count for the PR description.

### Phase 1 — mechanical sweeps (objective categories)

1. **Skip / todo grep:** `grep -rEn '\b(it|describe|test)\.(skip|todo)\b|^\s*x(it|describe)\b' tests/` produces the worklist for the abandoned-skip category.
2. **Fixture usage graph:** list every file under `tests/__mocks__/` and `tests/obsidian/`. For each, grep the rest of `tests/` for an import path that resolves to it. Files with zero references → delete worklist.
3. **Dead-import scan:** for each file in `tests/`, parse its `import` statements that resolve into `src/`. For each imported symbol, verify it still exists in the target file. Mismatches → dead-test worklist (file or block level).

For each worklist entry: apply the decision rules from the previous section, stage the deletion. After each category, run `npm test`. Green → commit that category. Red → revert the offending entry and reclassify as subjective.

### Phase 2 — per-file walk (subjective category)

- Read every in-scope test file once with the trivially-passing / mock-only patterns in mind.
- For each candidate, append a line to a running list: `tests/foo.test.ts:42 — <pattern>: <rationale>`.
- No deletions in this phase. List goes verbatim into the PR description.

### Phase 3 — follow-ups

- Track non-cleanup findings (real bugs, coverage gaps, refactor opportunities) during phases 1 and 2.
- Open separate GitHub issues for each at the end, with appropriate labels (`test`, `bug`, etc., from the existing label set — no new labels).

### Tooling

Standard tools only — `grep`, `node` for ad-hoc AST or import-resolution checks, `npm test` for the gate. No new scripts committed.

## PR shape

### Branch and issue

- Branch: `chore/issue-285-audit-unit-tests`
- PR title: `chore(tests): audit and remove dead test cases`
- Commits reference `Refs #285` in their bodies.
- PR body includes `Closes #285`.

### Commit structure

One commit per category, in this order. If a category produces zero findings, its commit is omitted.

1. `chore(tests): drop tests for removed code paths` — dead-import deletions
2. `chore(tests): drop abandoned .skip and .todo tests` — skip / todo deletions or unskips
3. `chore(tests): drop unreferenced mocks and fixtures` — fixture deletions

(No subjective-category commit — those wait for the maintainer's per-item decisions on the PR; deletions land afterwards on the same branch.)

Each commit body lists what was removed and references the rule from the decision-rules section.

### PR description structure

- `Closes #285`
- **Summary:** counts per category — for example "Removed N dead-import tests, M abandoned skips, K unused fixtures."
- **Baseline:** test count before and after, both green.
- **Subjective findings:** the list from Phase 2, each item formatted `path:line — pattern: rationale`. Maintainer ticks or strikes each; deletions follow in a later commit on the same branch.
- **Follow-up issues:** links to any GitHub issues opened for substantive findings.

## Risk control

- `npm test`, `npm run lint`, `npm run typecheck` all green before push.
- Each commit individually green — re-run `npm test` between commits.
- No edits to `src/`, `e2e/`, or to the body of `tests/__mocks__/obsidian.ts` (only deletion of unused exports if found).
- No reformatting or unrelated cleanup. Pure deletions.
- If a deletion turns the suite red, revert and reclassify the entry as subjective.

## Success criteria

- PR is mergeable with green CI.
- Net negative line count.
- Subjective list is actionable: each item has a one-line rationale, not just "looks weird".
- Follow-up issues exist for any substantive findings, labelled with the existing repo label set.
