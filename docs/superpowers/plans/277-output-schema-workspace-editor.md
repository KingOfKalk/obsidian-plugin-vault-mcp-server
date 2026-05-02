# Issue #277 — `outputSchema` declarations for Batch C (workspace + editor read tools)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare `outputSchema` on the 8 read tools that emit `structuredContent` in Batch C: 3 in the `workspace` module, 5 in the `editor` module — and parse-validate every shape with strict-mode Zod tests, except for the two opaque workspace tools, which use `.passthrough()`.

**Architecture:** Mirror Batch B (PR #286) and Batch A (PR #279) — module-level `outputSchema` raw-shape consts at the top of each `*/index.ts`, wired into `defineTool({ outputSchema: ... })`. Tests use `z.object(shape).strict().parse(result.structuredContent)` so any drift between renderer and structured payload fails loudly. The two exceptions (`workspace_get_active_leaf` and `workspace_get_layout`) use `.passthrough()` because the underlying Obsidian shape is not under our control.

**Tech Stack:** TypeScript, Zod, Vitest, MCP SDK (`@modelcontextprotocol/sdk`).

**Refs:** [Design](../specs/2026-05-02-output-schema-batches-bcd-design.md), #248 / PR #279 (framework + Batch A), #276 / PR #286 (Batch B), #258 (campaign tracker).

---

## Phase 0 — Branch and baseline

### Task 1: Create branch and capture baseline

**Files:** none modified yet.

- [ ] **Step 1: Verify the working tree is clean and on `main` at the latest tip**

Run: `git status && git log --oneline -1`
Expected: `working tree clean`. The latest commit subject should mention the merged Batch B PR (`feat(tools/search,vault): declare outputSchema for read tools (#286)` or similar).

- [ ] **Step 2: Create the feature branch from `main`**

Run:
```bash
git fetch origin
git checkout -b feat/issue-277-output-schema-workspace-editor origin/main
```

Expected: switches to a fresh branch off the latest `origin/main`.

- [ ] **Step 3: Run the baseline test suite to confirm green starting point**

Run: `npm test`
Expected: 607 / 607 tests passing (the count after Batch B merged). Capture for later comparison.

- [ ] **Step 4: Run lint and typecheck baseline**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

---

## Phase 1 — Workspace module (`src/tools/workspace/index.ts`)

The three workspace read tools that emit `structuredContent` today: `workspace_get_active_leaf`, `workspace_list_leaves`, `workspace_get_layout`. Verified against [`src/obsidian/adapter.ts`](../../../src/obsidian/adapter.ts):
- `getActiveLeafInfo()` declared as `Record<string, unknown> | null`; the runtime impl emits `{ id, type, filePath }` (see `src/obsidian/adapter.ts:376-385` and `MockObsidianAdapter.getActiveLeafInfo()` at `src/obsidian/mock-adapter.ts:400-405`).
- `getOpenFiles()` returns `Array<{ path, leafId }>` (typed at `src/obsidian/adapter.ts:69`).
- `getWorkspaceLayout()` returns `Record<string, unknown>` — fully opaque (passes through Obsidian's `app.workspace.getLayout()` at `src/obsidian/adapter.ts:416-418`; the mock returns `{ main: { type: 'split', children: [...] } }`).

### Task 2: Write the failing parse-validation tests

**Files:**
- Modify: `tests/tools/workspace/workspace.test.ts` (append a new top-level `describe` block; do NOT create a new file).

- [ ] **Step 1: Add the `z` import at the top of the file**

`tests/tools/workspace/workspace.test.ts` currently imports nothing from `zod`. Add `import { z } from 'zod';` so the imports look like:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createWorkspaceModule } from '../../../src/tools/workspace/index';
```

- [ ] **Step 2: Append the new top-level describe block at the end of the file**

Add this block AFTER the existing `describe('workspace module', ...)` block (the file's current top-level describe; its closing `});` is the file's last non-newline line).

```ts
/**
 * Batch C of #248: every workspace read tool that emits `structuredContent`
 * must declare an `outputSchema`, and that schema must accurately describe
 * the payload the handler produces.
 *
 * Two of the three tools — `workspace_get_active_leaf` and
 * `workspace_get_layout` — return Obsidian-internal shapes whose set of
 * fields is not under our control. Their schemas declare the documented
 * fields the adapter actually returns; tests use `.passthrough()` so future
 * Obsidian versions can add fields without churning this suite.
 */
describe('workspace read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
    { passthrough = false } = {},
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    const obj = z.object(tool.outputSchema);
    return passthrough ? obj.passthrough() : obj.strict();
  }

  it('workspace_get_active_leaf declares outputSchema (passthrough) and parses against handler output', async () => {
    // Obsidian's leaf state may carry additional fields beyond { id, type, filePath } in
    // future versions; .passthrough() absorbs those without test churn.
    const adapter = new MockObsidianAdapter();
    adapter.addFile('test.md', 'content');
    adapter.addOpenLeaf('test.md', 'leaf-1');
    adapter.setActiveLeafId('leaf-1');
    const tool = createWorkspaceModule(adapter).tools().find((t) => t.name === 'workspace_get_active_leaf')!;
    const schema = getStructured(tool, { passthrough: true });

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.id).toBe('leaf-1');
    expect(parsed.type).toBe('markdown');
    expect(parsed.filePath).toBe('test.md');
  });

  it('workspace_list_leaves declares outputSchema (strict) and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'A');
    adapter.addOpenLeaf('a.md', 'leaf-A');
    const tool = createWorkspaceModule(adapter).tools().find((t) => t.name === 'workspace_list_leaves')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.leaves).toEqual([{ leafId: 'leaf-A', path: 'a.md' }]);
  });

  it('workspace_get_layout declares outputSchema (passthrough) and parses against handler output', async () => {
    // Obsidian's layout descriptor (returned by app.workspace.getLayout()) is
    // an opaque nested tree whose internal shape is not stable across versions.
    // The schema is `{}` so .passthrough() accepts any object.
    const adapter = new MockObsidianAdapter();
    const tool = createWorkspaceModule(adapter).tools().find((t) => t.name === 'workspace_get_layout')!;
    const schema = getStructured(tool, { passthrough: true });

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(typeof parsed).toBe('object');
  });
});
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run: `npx vitest run tests/tools/workspace/workspace.test.ts -t "workspace read tools — outputSchema declarations"`
Expected: every `it(...)` in the new block fails with `Error: expected outputSchema to be declared`. The pre-existing tests in `workspace.test.ts` should still pass.

- [ ] **Step 4: Run lint and typecheck on the new test file**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 3: Add `outputSchema` consts and wire them to `defineTool` calls

**Files:**
- Modify: `src/tools/workspace/index.ts`

- [ ] **Step 1: The `z` import is already present at line 1 of the file (the existing schemas use Zod). No new import needed — verify by reading line 1**

The file already has `import { z } from 'zod';` at line 1. Skip this step's edit if confirmed; otherwise add it.

- [ ] **Step 2: Add three `outputSchema` raw-shape consts immediately before `interface WorkspaceHandlers` (currently line 45)**

Insert this block immediately AFTER the existing `setActiveLeafSchema` declaration (currently lines 37-43) and BEFORE `interface WorkspaceHandlers` (currently line 45):

```ts
/**
 * Output schemas for the workspace read tools that emit `structuredContent`
 * (Batch C of #248). Two of these are `.passthrough()`-tested because their
 * payload comes from an Obsidian-internal shape whose set of fields is not
 * under our control:
 *
 * - `workspace_get_active_leaf` — adapter returns `{ id, type, filePath }`
 *   today, but Obsidian's leaf state may grow more fields in future versions.
 * - `workspace_get_layout` — fully opaque pass-through of
 *   `app.workspace.getLayout()`. Schema is empty; tests rely on
 *   `.passthrough()` to assert "an object, contents not described".
 */
const getActiveLeafOutputSchema = {
  id: z.string().describe('Leaf id (Obsidian-internal handle).'),
  type: z.string().describe('View type for the leaf, e.g. "markdown".'),
  filePath: z
    .string()
    .nullable()
    .describe('Vault-relative path of the file in this leaf, or null when none.'),
};

const listLeavesOutputSchema = {
  leaves: z
    .array(
      z.object({
        leafId: z.string().describe('Obsidian-internal leaf id.'),
        path: z.string().describe('Vault-relative path of the file in this leaf.'),
      }),
    )
    .describe('All open leaves that hold a file.'),
};

const getLayoutOutputSchema: z.ZodRawShape = {};
```

**Implementation note:** the explicit `: z.ZodRawShape` annotation is required so TypeScript widens `{}` to the index-signature shape that `defineTool({ outputSchema })` expects. If the MCP SDK rejects the empty shape at runtime (some SDK versions construct a strict Zod object from the raw shape and may reject any structured content that has extra keys) — observed by `npm test` failing in `tests/server/` or `tests/tools/workspace/` — fall back to declaring a single permissive field instead:

```ts
const getLayoutOutputSchema = {
  main: z.unknown().optional().describe('Top-level pane tree (Obsidian-internal shape).'),
};
```

`z.unknown()` accepts any value and `.optional()` lets the field be absent; combined with `.passthrough()` at the test boundary this is structurally equivalent to the empty-shape choice but avoids the empty-properties JSON Schema corner case. Prefer the empty shape if it works (it's the most honest "we don't describe this"), but switch if the SDK pushes back.

- [ ] **Step 3: Wire each schema to its `defineTool` call**

In the same file, modify the three workspace `defineTool({...})` blocks by adding an `outputSchema:` field directly after the existing `schema:` field. Three edits in file order:

For `workspace_get_active_leaf` (currently around line 116-126):
```ts
schema: readOnlySchema,
outputSchema: getActiveLeafOutputSchema,
handler: h.getActiveLeaf,
```

For `workspace_list_leaves` (currently around line 142-151):
```ts
schema: readOnlySchema,
outputSchema: listLeavesOutputSchema,
handler: h.listLeaves,
```

For `workspace_get_layout` (currently around line 164-173):
```ts
schema: readOnlySchema,
outputSchema: getLayoutOutputSchema,
handler: h.getLayout,
```

- [ ] **Step 4: Run the workspace outputSchema tests and confirm they pass**

Run: `npx vitest run tests/tools/workspace/workspace.test.ts -t "workspace read tools — outputSchema declarations"`
Expected: all 3 new tests pass; the existing workspace tests still pass.

- [ ] **Step 5: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

---

## Phase 2 — Editor module (`src/tools/editor/index.ts`)

The five editor read tools that emit `structuredContent` today: `editor_get_content`, `editor_get_active_file`, `editor_get_cursor`, `editor_get_selection`, `editor_get_line_count`. All five use the strict-mode default — none are passthrough.

### Task 4: Write the failing parse-validation tests

**Files:**
- Modify: `tests/tools/editor/editor.test.ts` (append a new top-level `describe` block).

- [ ] **Step 1: Add the `z` import at the top of the file**

Add `import { z } from 'zod';` so the imports look like:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createEditorModule } from '../../../src/tools/editor/index';
```

- [ ] **Step 2: Append the new top-level describe block at the end of the file**

Add this block AFTER the existing `describe('editor module', ...)` block:

```ts
/**
 * Batch C of #248: every editor read tool that emits `structuredContent`
 * must declare an `outputSchema`, and that schema must accurately describe
 * the payload the handler produces. Strict-mode parsing catches drift
 * between the markdown renderer and the structured payload.
 */
describe('editor read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }

  it('editor_get_content declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('note.md', '# Hello\nWorld');
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_content')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.content).toBe('# Hello\nWorld');
  });

  it('editor_get_active_file declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('notes/today.md', 'content');
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_active_file')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('notes/today.md');
  });

  it('editor_get_cursor declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('note.md', 'one\ntwo\nthree');
    adapter.setCursorPosition(1, 2);
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_cursor')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.line).toBe(1);
    expect(parsed.ch).toBe(2);
  });

  it('editor_get_selection declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('note.md', 'one\ntwo\nthree');
    adapter.setSelection(0, 0, 0, 3);
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_selection')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.from).toEqual({ line: 0, ch: 0 });
    expect(parsed.to).toEqual({ line: 0, ch: 3 });
    expect(parsed.text).toBe('one');
  });

  it('editor_get_line_count declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('note.md', 'one\ntwo\nthree');
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_line_count')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.lineCount).toBe(3);
  });
});
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run: `npx vitest run tests/tools/editor/editor.test.ts -t "editor read tools — outputSchema declarations"`
Expected: every `it(...)` in the new block fails with `Error: expected outputSchema to be declared`. The pre-existing tests in `editor.test.ts` should still pass.

- [ ] **Step 4: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 5: Add `outputSchema` consts and wire them to `defineTool` calls

**Files:**
- Modify: `src/tools/editor/index.ts`

- [ ] **Step 1: Verify `z` is already imported (it is — line 1)**

The file already has `import { z } from 'zod';` at line 1. No new import needed.

- [ ] **Step 2: Add five `outputSchema` raw-shape consts immediately AFTER the existing `setSelectionSchema` declaration (currently lines 94-99) and BEFORE `interface EditorHandlers` (currently line 101)**

Insert this block:

```ts
/**
 * Output schemas for the editor read tools that emit `structuredContent`
 * (Batch C of #248). Each shape mirrors what the corresponding handler in
 * this file puts on `result.structuredContent`.
 */
const getContentOutputSchema = {
  content: z.string().describe('Full text content of the active editor.'),
};

const getActiveFileOutputSchema = {
  path: z.string().describe('Vault-relative path of the active file.'),
};

const getCursorOutputSchema = {
  line: z.number().describe('Zero-based line index of the cursor.'),
  ch: z.number().describe('Zero-based column index of the cursor.'),
};

const getSelectionOutputSchema = {
  from: z
    .object({
      line: z.number().describe('Zero-based start line (inclusive).'),
      ch: z.number().describe('Zero-based start column (inclusive).'),
    })
    .describe('Selection start.'),
  to: z
    .object({
      line: z.number().describe('Zero-based end line (exclusive).'),
      ch: z.number().describe('Zero-based end column (exclusive).'),
    })
    .describe('Selection end.'),
  text: z.string().describe('Selected text.'),
};

const getLineCountOutputSchema = {
  lineCount: z.number().describe('Number of lines in the active editor.'),
};
```

- [ ] **Step 3: Wire each schema to its `defineTool` call**

In the same file, modify the five editor read-only `defineTool({...})` blocks by adding an `outputSchema:` field directly after the existing `schema:` field. Five edits in file order:

For `editor_get_content` (currently around line 273-283):
```ts
schema: readOnlySchema,
outputSchema: getContentOutputSchema,
handler: h.getContent,
```

For `editor_get_active_file` (currently around line 284-293):
```ts
schema: readOnlySchema,
outputSchema: getActiveFileOutputSchema,
handler: h.getActivePath,
```

For `editor_get_cursor` (currently around line 354-362):
```ts
schema: readOnlySchema,
outputSchema: getCursorOutputSchema,
handler: h.getCursor,
```

For `editor_get_selection` (currently around line 383-392):
```ts
schema: readOnlySchema,
outputSchema: getSelectionOutputSchema,
handler: h.getSelection,
```

For `editor_get_line_count` (currently around line 411-419):
```ts
schema: readOnlySchema,
outputSchema: getLineCountOutputSchema,
handler: h.getLineCount,
```

- [ ] **Step 4: Run the editor outputSchema tests and confirm they pass**

Run: `npx vitest run tests/tools/editor/editor.test.ts -t "editor read tools — outputSchema declarations"`
Expected: all 5 new tests pass; the existing editor tests still pass.

- [ ] **Step 5: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 6: Commit the workspace + editor work

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add src/tools/workspace/index.ts src/tools/editor/index.ts \
        tests/tools/workspace/workspace.test.ts tests/tools/editor/editor.test.ts
git commit -m "$(cat <<'EOF'
feat(tools/workspace,editor): declare outputSchema for read tools

Declare outputSchema on the eight read tools that emit structuredContent
in workspace and editor modules: workspace_get_active_leaf,
workspace_list_leaves, workspace_get_layout, editor_get_content,
editor_get_active_file, editor_get_cursor, editor_get_selection,
editor_get_line_count.

`workspace_get_active_leaf` and `workspace_get_layout` use
`.passthrough()` parse tests because their payloads come from
Obsidian-internal shapes whose set of fields is not under our control.
The other six use strict-mode parsing.

Refs #277
Refs #258
EOF
)"
```

Expected: commit succeeds.

---

## Phase 3 — Verification gate, docs, push, PR

### Task 7: Regenerate `docs/tools.generated.md` and run the full gate

**Files:**
- Possibly modify: `docs/tools.generated.md` (if regeneration produces a diff).

- [ ] **Step 1: Regenerate the tools doc**

Run: `npm run docs:tools`
Expected: the script runs to completion. The current generator only lists tool names, so there should be NO diff for this batch (no tools were added or renamed). Verify with `git status`.

- [ ] **Step 2: If `git status` shows a diff for `docs/tools.generated.md`, commit it**

If there's a diff (unexpected for this batch), inspect first:
```bash
git diff docs/tools.generated.md
```

If the diff is purely from regeneration, commit:
```bash
git add docs/tools.generated.md
git commit -m "$(cat <<'EOF'
docs(tools): regenerate tools.generated.md after Batch C

Refs #277
EOF
)"
```

If there's no diff, skip this step.

- [ ] **Step 3: Run the full verification gate**

Run each command separately (per CLAUDE.md rule 15):
```bash
npm test
```

Expected: 615 / 615 passing (607 baseline + 8 new). All green.

```bash
npm run lint
```

Expected: clean.

```bash
npm run typecheck
```

Expected: clean.

```bash
npm run docs:check
```

Expected: clean.

If any of the four commands fails:
- `npm test` failing → re-check the schema descriptions match what the handler emits. For the two passthrough tests, confirm the schema is being constructed via `.passthrough()` not `.strict()`.
- `npm run lint` failing → most likely an unused const if a wiring step missed one of the eight tools.
- `npm run typecheck` failing → `outputSchema` field's type must be `z.ZodRawShape`. The empty raw shape (`getLayoutOutputSchema: z.ZodRawShape = {}`) needs the explicit annotation; otherwise TypeScript infers `{}` which is incompatible.
- `npm run docs:check` failing → re-run `npm run docs:tools` and commit any diff.

### Task 8: Push and open the PR

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/issue-277-output-schema-workspace-editor`
Expected: branch is created on `origin` and tracks the local branch.

- [ ] **Step 2: Open the PR with `gh`**

Run:
```bash
gh pr create --title "feat(tools/workspace,editor): declare outputSchema for read tools" --body "$(cat <<'EOF'
Closes #277

## Summary

- Declare \`outputSchema\` on the three workspace read tools (\`workspace_get_active_leaf\`, \`workspace_list_leaves\`, \`workspace_get_layout\`).
- Declare \`outputSchema\` on the five editor read tools (\`editor_get_content\`, \`editor_get_active_file\`, \`editor_get_cursor\`, \`editor_get_selection\`, \`editor_get_line_count\`).
- Strict-mode (\`z.object(shape).strict().parse(...)\`) parse tests for six of the eight tools, mirroring PR #279 / PR #286.

## Two passthrough exceptions

\`workspace_get_active_leaf\` and \`workspace_get_layout\` use \`.passthrough()\` parse tests because their payloads come from Obsidian-internal shapes whose set of fields is not under our control:

- \`workspace_get_active_leaf\` declares the documented fields the adapter actually returns (\`id\`, \`type\`, \`filePath\`); future Obsidian versions may add more, so \`.passthrough()\` absorbs those without test churn.
- \`workspace_get_layout\` is a pass-through of \`app.workspace.getLayout()\`, whose internal shape is not stable. The schema is empty; tests assert "an object, contents not described".

The other six tools are strict-mode tested.

## Test plan

- [x] \`npm test\` — 615 / 615 passing (was 607 after Batch B; +8 new strict-mode and passthrough parse tests covering all 8 in-scope tools).
- [x] \`npm run lint\` — clean.
- [x] \`npm run typecheck\` — clean.
- [x] \`npm run docs:check\` — clean (no diff: the generator only lists tool names, no new tools or renames in this PR).

## Refs

- Builds on #248 / PR #279 (framework + Batch A) and #276 / PR #286 (Batch B).
- Tracker: #258.
- Followup: #278 (Batch D — extras + plugin-interop + templates + \`vault_read_binary\` retrofit).
EOF
)"
```

Expected: PR is created on GitHub and `gh` prints the URL.

- [ ] **Step 3: Print the PR URL**

Run: `gh pr view --json url -q .url`
Expected: the URL is printed for the user to open. Stop here and wait for review/merge before starting Plan 3 (Batch D / #278).

---

## Self-review checklist (run after writing this plan)

This section is for the plan author. Check before handing off:

- **Spec coverage.** Each item in the design's PR-2 scope has a task:
  - 3 workspace schemas → Task 3 step 2
  - 5 editor schemas → Task 5 step 2
  - 3 workspace tests (1 strict + 2 passthrough) → Task 2 step 2
  - 5 editor tests (all strict) → Task 4 step 2
  - `docs/tools.generated.md` regen → Task 7 step 1
  - `npm test`, `npm run lint`, `npm run typecheck`, `npm run docs:check` gate → Task 7 step 3
  - PR body documenting the two passthrough exceptions → Task 8 step 2
- **No placeholders.** Every code step contains the actual code; every command step contains the actual command. No "TBD"/"TODO"/"add appropriate error handling".
- **Type consistency.** `outputSchema` field used everywhere matches `ToolDefinition`'s optional `z.ZodRawShape` field (already typed by PR #279). The `getStructured` helper appears in both test files; the workspace variant accepts the optional `{ passthrough }` argument while the editor variant does not. Tests use `module.tools().find(...)!` inline rather than a helper, matching the existing pattern in both `tests/tools/workspace/workspace.test.ts` (lines 22-43) and `tests/tools/editor/editor.test.ts` (lines 28-50).
- **Empty-shape annotation.** `getLayoutOutputSchema: z.ZodRawShape = {}` carries the explicit type annotation so TypeScript widens correctly when assigning into `outputSchema?: z.ZodRawShape`.

## Out of scope (here, deferred to Batch D)

- Extras + plugin-interop + templates schemas — Plan 3 (#278).
- `vault_read_binary` `structuredContent` retrofit — Plan 3 (#278).
- Framework changes (`src/registry/types.ts`, `src/server/mcp-server.ts`) — already shipped in #279.
