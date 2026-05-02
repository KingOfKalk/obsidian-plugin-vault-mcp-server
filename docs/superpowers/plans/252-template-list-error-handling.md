# Plan: stop swallowing all errors in `template_list` (Issue #252)

## Goal

`template_list` currently returns `[]` on **any** failure inside the
adapter call. That hides permission errors, adapter bugs, and config
problems behind an indistinguishable "no templates" response. After
this change, `[]` means exactly "the templates folder does not
exist"; every other failure surfaces through `handleToolError`.

## Typed-error decision

- Add **`FolderNotFoundError extends NotFoundError`** to
  `src/tools/shared/errors.ts`. This is what the issue actually asks
  for and what the handler will catch.
- Also add **`FileNotFoundError extends NotFoundError`** alongside
  it for symmetry. We don't use it in this PR, but it makes the
  typed-error pattern obvious to follow when other adapter throws
  get tightened. Cheap to add; loud signal to future contributors.
- Keep the message string `Folder not found: ${path}` byte-identical
  to the current `new Error(...)` message so existing assertions
  (`mock-adapter.test.ts` matches on the substring `'Folder not
  found'`) keep passing.

## Files touched

1. `src/tools/shared/errors.ts`
   - Add `class FolderNotFoundError extends NotFoundError`.
   - Add `class FileNotFoundError extends NotFoundError`.
   - `handleToolError` already routes `NotFoundError` correctly via
     `errorFrom(error.message)`, so no change there.

2. `src/obsidian/adapter.ts`
   - `getFolder()` throws `FolderNotFoundError(path)` instead of
     `new Error(\`Folder not found: ${path}\`)`. Message preserved.
   - **Do NOT touch** `getFile()` or `getAbstractFile()` — out of
     scope for #252; broader adapter typing is a future follow-up.

3. `src/obsidian/mock-adapter.ts`
   - `list()` and `listRecursive()` throw `FolderNotFoundError`
     instead of `new Error('Folder not found: …')` so the handler's
     `instanceof FolderNotFoundError` check passes in tests that
     drive through the mock adapter. Message preserved.
   - `deleteFolder()` likewise throws `FolderNotFoundError` for
     consistency (also exercises the same string today).

4. `src/tools/templates/index.ts`
   - Replace the bare `catch {}` in `listTemplates` with:
     ```ts
     try {
       const result = adapter.list(templatesFolder);
       return Promise.resolve(text(JSON.stringify(result.files)));
     } catch (err) {
       if (err instanceof FolderNotFoundError) {
         return Promise.resolve(text('[]'));
       }
       return Promise.resolve(handleToolError(err));
     }
     ```
   - Import `FolderNotFoundError` from `../shared/errors`.

## Tests

### `tests/tools/templates/templates.test.ts`

Add five regression tests (one per acceptance-criterion case):

- (a) Folder missing → `template_list` returns `[]`.
- (b) Folder present + empty → `template_list` returns `JSON.stringify([])`.
- (c) Folder present + populated → returns the file list as JSON
  (this case effectively already exists; keep the spirit, ensure
  it stays).
- (d) Permission denied → handler returns `handleToolError`-shaped
  envelope: `isError: true`, message contains `Permission denied`.
- (e) Unexpected error → adapter throws plain `new Error('boom')`
  → handler returns `isError: true`, message contains `boom`.

For (d) and (e) we'll subclass / wrap `MockObsidianAdapter` in the
test file to override `list()` and throw the desired error. Keeps
the production mock untouched.

### `tests/obsidian/mock-adapter.test.ts`

Add a single regression test:

- Calling `adapter.list('missing')` throws `FolderNotFoundError`
  (assert `toThrow(FolderNotFoundError)`). Pins the typed-error
  contract so a future refactor can't silently regress to plain
  `Error`.
- The existing `toThrow('Folder not found')` test still passes
  because the message is unchanged.

## Scope-creep notes

- **`getFile()` / `getAbstractFile()`** still throw plain `Error`.
  Tightening those is a separate follow-up; #252 is scoped to the
  templates handler. PR body will call this out.
- The `templatesFolder` is hardcoded to `'templates'` in
  `src/tools/templates/index.ts:72`. Not configurable today, so
  tests use the same hardcoded value. Out of scope to change here.
- No user-manual update needed: the only externally observable
  change is "errors that used to be silently swallowed now surface
  through the standard error envelope". Nothing to add to
  `docs/help/en.md`. Tool registry is unchanged so no
  `docs/tools.generated.md` regen.

## Commit plan

1. `docs(plans/252): plan for template_list error handling` — this file.
2. `fix(tools/shared): add FolderNotFoundError and FileNotFoundError`
   — typed errors + adapter wiring (`adapter.ts` + `mock-adapter.ts`)
   + the adapter regression test. Keeps the typed-error addition
   self-contained.
3. `fix(tools/templates): stop swallowing all errors in template_list`
   — narrow the catch in `index.ts` and add the five handler tests.

All commit bodies include `Refs #252`. No AI attribution.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm test`
- Confirm `mock-adapter.test.ts`'s existing `'Folder not found'`
  string assertions still pass after the throw is swapped to a
  typed error.
