# Plan: fix CI required-check name mismatch (Issue #267)

## Problem

The repo's default ruleset requires a status check named `build-and-test`,
but `.github/workflows/ci.yml` uses a `strategy.matrix` with
`node-version: [20]`. GitHub appends the matrix value to the reported
check name, so the actual check on every PR is `build-and-test (20)`.
The required check `build-and-test` never fires, silently bypassing
branch protection.

## Approach (Option A from the issue)

Drop `strategy.matrix` from `ci.yml`. The job name `build-and-test`
will then match the ruleset's required context exactly, with no
parenthesised suffix.

## Changes

- `.github/workflows/ci.yml`:
  - Remove the `strategy.matrix.node-version` block.
  - Replace `${{ matrix.node-version }}` with the literal `20` in the
    `node-version` field of `actions/setup-node@v6`.
  - Update the step name from `Use Node.js ${{ matrix.node-version }}`
    to `Use Node.js 20`.
  - Leave every other step untouched: lint, typecheck, docs:check,
    test:coverage, build, `test -f main.js`.

## Verification

- The change is workflow-only; no `src/` or `tests/` change.
- Still run `npm run lint`, `npm run typecheck`, `npm test` for hygiene.
- Real verification is on the PR itself: GitHub must report the check as
  exactly `build-and-test` (no `(20)` suffix), and the required-status-check
  rule must enforce.

## Out of scope

- Adding more Node versions to CI.
- Touching other workflows (`codeql.yml`, `release.yml`, etc.).
