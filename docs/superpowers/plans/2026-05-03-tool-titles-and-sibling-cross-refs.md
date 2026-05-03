# Tool titles and sibling cross-references — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill the missing `title` annotation on all 54 tools and add structured `seeAlso` cross-references between documented sibling pairs, per spec [`docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`](../specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md).

**Architecture:** Add a required top-level `title: string` field on `ToolDefinition`; forward it to **both** `Tool.title` and `ToolAnnotations.title` at registration time. Add a `seeAlso?: string[]` slot to `describeTool` rendered as a `See also:` block. Register the title via a single source of truth in tool definitions; never duplicate.

**Tech Stack:** TypeScript, Zod, vitest, MCP TS SDK (`@modelcontextprotocol/sdk`), tsx for the docs generator script.

**Issue:** [#289](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/289)
**Branch:** `feat/issue-289-tool-titles-and-sibling-cross-refs` (already created — verify `git rev-parse --abbrev-ref HEAD` returns this).

**Title catalogue and sibling pairs are defined in the spec — refer to that doc when filling in titles in tasks 4–10 and `seeAlso` blocks in tasks 11–14.**

**Sequencing rationale:** the type change to `ToolDefinition` flips compile-time errors on every `defineTool` call site at once. We add `title` as **optional** first, backfill all 54 tools, then flip to **required** in one commit. This keeps every intermediate commit green for `tsc`.

---

## Task 1: Plumbing — add optional `title` field, forward at registration

**Files:**
- Modify: `src/registry/types.ts:30-48` (interface), `src/registry/types.ts:65-69` (defineTool)
- Modify: `src/server/mcp-server.ts:88-97` (registerTool call)
- Test: `tests/server/mcp-server.test.ts` (new test case in the existing describe block)

- [ ] **Step 1: Write the failing test in `tests/server/mcp-server.test.ts`**

Add a new `it` block inside the existing `describe('createMcpServer', …)` that captures the `registerTool` config calls (the test already has a `capturedRegisterToolCalls` mechanism — reuse it):

```typescript
it('forwards tool.title to both Tool.title and annotations.title', async () => {
  const { ModuleRegistry } = await import('../../src/registry/module-registry');
  const { createMcpServer } = await import('../../src/server/mcp-server');

  const titledTool = {
    name: 'titled',
    title: 'Pretty title',
    description: 'has title',
    schema: { foo: z.string() },
    handler: () =>
      Promise.resolve({ content: [{ type: 'text' as const, text: 'ok' }] }),
    annotations: annotations.read,
  } as unknown as ToolDefinition;

  const stubModule: ToolModule = {
    metadata: { id: 'stub', name: 'Stub', description: 'test' },
    tools: () => [titledTool],
  };

  const registry = new ModuleRegistry(makeLogger());
  registry.registerModule(stubModule);
  createMcpServer(registry, makeLogger());

  const call = capturedRegisterToolCalls.find((c) => c.name === 'titled');
  expect(call).toBeDefined();
  expect(call?.config.title).toBe('Pretty title');
  expect(call?.config.annotations?.title).toBe('Pretty title');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest run tests/server/mcp-server.test.ts -t 'forwards tool.title'
```

Expected: FAIL — `call?.config.title` is `undefined` (forwarding code not yet present); also `tool.title` does not exist on `ToolDefinition`.

- [ ] **Step 3: Add the optional `title` field to `ToolDefinition`**

In `src/registry/types.ts`, change the interface (at lines 30-48):

```typescript
export interface ToolDefinition<
  Shape extends z.ZodRawShape = z.ZodRawShape,
> {
  name: string;
  /**
   * Human-readable title used by hosts in confirmation / auto-approve UI.
   * Sentence case, no module prefix, ≤40 characters. See spec
   * `docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`.
   *
   * Marked optional during the backfill rollout (#289). Will become required
   * once every defineTool call site has been updated.
   */
  title?: string;
  description: string;
  schema: Shape;
  outputSchema?: z.ZodRawShape;
  handler: TypedHandler<Shape>;
  annotations: ToolAnnotations;
}
```

- [ ] **Step 4: Forward `title` to both slots in `src/server/mcp-server.ts`**

Replace the `server.registerTool` call (currently lines 88-97):

```typescript
server.registerTool(
  tool.name,
  {
    title: tool.title,
    description: tool.description,
    inputSchema: tool.schema,
    outputSchema: tool.outputSchema,
    annotations: tool.title
      ? { ...tool.annotations, title: tool.title }
      : tool.annotations,
  },
  createToolDispatcher(tool, logger),
);
```

(The conditional spread keeps `annotations` referentially identical when `title` is absent — preserves a property the existing tests assert.)

- [ ] **Step 5: Run the new test to verify it passes**

```
npx vitest run tests/server/mcp-server.test.ts -t 'forwards tool.title'
```

Expected: PASS.

- [ ] **Step 6: Run the full mcp-server suite to confirm no regression**

```
npx vitest run tests/server/mcp-server.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```
git add src/registry/types.ts src/server/mcp-server.ts tests/server/mcp-server.test.ts
git commit -m "feat(registry): add optional title field and forward to both spec slots

Refs #289"
```

---

## Task 2: Plumbing — add `seeAlso` section to `describeTool`

**Files:**
- Modify: `src/tools/shared/describe.ts:33-39` (interface), `src/tools/shared/describe.ts:55-106` (renderer)
- Test: `tests/tools/shared/describe.test.ts` (new cases)

- [ ] **Step 1: Write the failing test cases**

Append to `tests/tools/shared/describe.test.ts` inside the existing `describe('describeTool', …)`:

```typescript
it('renders a See also section when seeAlso entries are supplied', () => {
  const out = describeTool({
    summary: 'Read a thing.',
    seeAlso: [
      'other_tool — when you want the other variant.',
    ],
  });
  expect(out).toContain('See also:');
  expect(out).toContain('  - other_tool — when you want the other variant.');
});

it('places See also between Examples and Errors', () => {
  const out = describeTool({
    summary: 'Read.',
    examples: ['Use when: testing.'],
    seeAlso: ['other_tool — alternative.'],
    errors: ['"boom" on failure.'],
  });
  const examplesIdx = out.indexOf('Examples:');
  const seeAlsoIdx = out.indexOf('See also:');
  const errorsIdx = out.indexOf('Errors:');
  expect(examplesIdx).toBeGreaterThan(0);
  expect(seeAlsoIdx).toBeGreaterThan(examplesIdx);
  expect(errorsIdx).toBeGreaterThan(seeAlsoIdx);
});

it('omits See also when no seeAlso entries are supplied', () => {
  const out = describeTool({ summary: 'Read.' });
  expect(out).not.toContain('See also:');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run tests/tools/shared/describe.test.ts -t 'See also'
```

Expected: FAIL — `seeAlso` is not on the type yet, and the helper does not render it.

- [ ] **Step 3: Add `seeAlso` to the `ToolDoc` interface**

In `src/tools/shared/describe.ts`, update the interface (lines 33-39):

```typescript
export interface ToolDoc {
  summary: string;
  args?: string[];
  returns?: string;
  examples?: string[];
  seeAlso?: string[];
  errors?: string[];
}
```

- [ ] **Step 4: Render the `See also:` block**

In the same file, immediately after the `Examples:` rendering block (currently around lines 95-98) and before the `Errors:` block (lines 100-103), insert:

```typescript
if (doc.seeAlso && doc.seeAlso.length > 0) {
  lines.push('', 'See also:');
  for (const s of doc.seeAlso) lines.push(`  - ${s}`);
}
```

- [ ] **Step 5: Run the new tests to verify they pass**

```
npx vitest run tests/tools/shared/describe.test.ts
```

Expected: all PASS (the new cases plus all 9 existing ones).

- [ ] **Step 6: Commit**

```
git add src/tools/shared/describe.ts tests/tools/shared/describe.test.ts
git commit -m "feat(tools/shared): add seeAlso section to describeTool

Refs #289"
```

---

## Task 3: Registry test — title presence, length cap, uniqueness

**Files:**
- Create: `tests/registry/tool-titles.test.ts`

- [ ] **Step 1: Create the test file**

Write `tests/registry/tool-titles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { discoverModules } from '../../src/tools';
import type { ToolDefinition } from '../../src/registry/types';

function allTools(): ToolDefinition[] {
  const adapter = new MockObsidianAdapter();
  return discoverModules(adapter).flatMap((m) => m.tools());
}

describe('tool titles', () => {
  it('every tool has a non-empty title (after trim)', () => {
    const missing = allTools()
      .filter((t) => !t.title || t.title.trim().length === 0)
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('every title is at most 40 characters', () => {
    const tooLong = allTools()
      .filter((t) => (t.title ?? '').length > 40)
      .map((t) => `${t.name}: "${t.title ?? ''}" (${String((t.title ?? '').length)} chars)`);
    expect(tooLong).toEqual([]);
  });

  it('titles are unique across the registry', () => {
    const tools = allTools();
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const t of tools) {
      const title = t.title ?? '';
      const prior = seen.get(title);
      if (prior !== undefined) {
        duplicates.push(`${prior} and ${t.name} share title "${title}"`);
      } else {
        seen.set(title, t.name);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — expect ALL three to fail**

```
npx vitest run tests/registry/tool-titles.test.ts
```

Expected: FAIL on the non-empty assertion (54 missing titles); the length and uniqueness tests will spuriously pass since `''` is short and unique-empty-strings are deduped to one entry. That's fine — they will become load-bearing as titles get filled in.

- [ ] **Step 3: Commit the failing test**

```
git add tests/registry/tool-titles.test.ts
git commit -m "test(registry): assert every tool has a non-empty unique title ≤40 chars

Test fails until the title backfill across modules is complete (#289).

Refs #289"
```

---

## Task 4: Backfill titles — vault module

**Files:**
- Modify: `src/tools/vault/index.ts` (22 `defineTool` call sites)

For every `defineTool({ name: 'vault_*', ...})` block, add a `title: '<value>'` line directly after `name`. Use the catalogue from the spec — copied here for convenience (do not deviate):

| Name | Title |
|---|---|
| `vault_create` | Create file |
| `vault_read` | Read file |
| `vault_update` | Replace file content |
| `vault_delete` | Delete file |
| `vault_append` | Append to file |
| `vault_get_metadata` | Get file metadata |
| `vault_rename` | Rename file |
| `vault_move` | Move file |
| `vault_copy` | Copy file |
| `vault_create_folder` | Create folder |
| `vault_delete_folder` | Delete folder |
| `vault_rename_folder` | Rename folder |
| `vault_list` | List folder |
| `vault_list_recursive` | List folder (recursive) |
| `vault_read_binary` | Read binary file |
| `vault_write_binary` | Write binary file |
| `vault_get_frontmatter` | Get frontmatter |
| `vault_get_headings` | Get headings |
| `vault_get_outgoing_links` | Get outgoing links |
| `vault_get_embeds` | Get embeds |
| `vault_get_backlinks` | Get backlinks |
| `vault_get_block_references` | Get block references |

Pattern (example):

```typescript
defineTool({
  name: 'vault_create',
  title: 'Create file',
  description: describeTool({ … }),
  schema: createFileSchema,
  handler: handlers.createFile,
  annotations: annotations.additive,
}),
```

- [ ] **Step 1: Add the title to all 22 `vault_*` definitions in `src/tools/vault/index.ts`**

- [ ] **Step 2: Run typecheck and the registry test**

```
npm run typecheck
npx vitest run tests/registry/tool-titles.test.ts
```

Expected: typecheck PASS; the registry test still FAILS (32 tools across other modules still untitled), but the failure list should now be exactly those 32 names — verify `vault_*` names are absent from the failure output.

- [ ] **Step 3: Commit**

```
git add src/tools/vault/index.ts
git commit -m "feat(tools/vault): add title annotation to every vault tool

Refs #289"
```

---

## Task 5: Backfill titles — editor module

**Files:**
- Modify: `src/tools/editor/index.ts` (10 `defineTool` call sites)

| Name | Title |
|---|---|
| `editor_get_content` | Get active file content |
| `editor_get_active_file` | Get active file path |
| `editor_insert` | Insert at cursor |
| `editor_replace` | Replace range |
| `editor_delete` | Delete range |
| `editor_get_cursor` | Get cursor position |
| `editor_set_cursor` | Set cursor position |
| `editor_get_selection` | Get selection |
| `editor_set_selection` | Set selection |
| `editor_get_line_count` | Get line count |

- [ ] **Step 1: Add titles**

- [ ] **Step 2: Verify**

```
npm run typecheck
npx vitest run tests/registry/tool-titles.test.ts
```

Expected: typecheck PASS; failure list shrinks by 10.

- [ ] **Step 3: Commit**

```
git add src/tools/editor/index.ts
git commit -m "feat(tools/editor): add title annotation to every editor tool

Refs #289"
```

---

## Task 6: Backfill titles — search module

**Files:**
- Modify: `src/tools/search/index.ts` (6 `defineTool` call sites)

| Name | Title |
|---|---|
| `search_fulltext` | Full-text search |
| `search_tags` | List tags |
| `search_resolved_links` | Find resolved links |
| `search_unresolved_links` | Find unresolved links |
| `search_by_tag` | Find notes by tag |
| `search_by_frontmatter` | Find notes by frontmatter |

- [ ] **Step 1: Add titles**

- [ ] **Step 2: Verify**

```
npm run typecheck
npx vitest run tests/registry/tool-titles.test.ts
```

- [ ] **Step 3: Commit**

```
git add src/tools/search/index.ts
git commit -m "feat(tools/search): add title annotation to every search tool

Refs #289"
```

---

## Task 7: Backfill titles — workspace module

**Files:**
- Modify: `src/tools/workspace/index.ts` (5 `defineTool` call sites)

| Name | Title |
|---|---|
| `workspace_get_active_leaf` | Get active leaf |
| `workspace_open_file` | Open file in workspace |
| `workspace_list_leaves` | List open leaves |
| `workspace_set_active_leaf` | Set active leaf |
| `workspace_get_layout` | Get workspace layout |

- [ ] **Step 1: Add titles**

- [ ] **Step 2: Verify**

```
npm run typecheck
npx vitest run tests/registry/tool-titles.test.ts
```

- [ ] **Step 3: Commit**

```
git add src/tools/workspace/index.ts
git commit -m "feat(tools/workspace): add title annotation to every workspace tool

Refs #289"
```

---

## Task 8: Backfill titles — ui, templates, plugin-interop, extras

**Files:**
- Modify: `src/tools/ui/index.ts` (1 site)
- Modify: `src/tools/templates/index.ts` (3 sites)
- Modify: `src/tools/plugin-interop/index.ts` (6 sites)
- Modify: `src/tools/extras/index.ts` (1 site)

| Name | Title |
|---|---|
| `ui_notice` | Show notice |
| `template_list` | List templates |
| `template_create_from` | Create file from template |
| `template_expand` | Expand template inline |
| `plugin_list` | List plugins |
| `plugin_check` | Check plugin enabled |
| `plugin_dataview_query` | Run Dataview query |
| `plugin_dataview_describe_js_query` | Describe Dataview JS query |
| `plugin_templater_describe_template` | Describe Templater template |
| `plugin_execute_command` | Execute command |
| `extras_get_date` | Get current date |

- [ ] **Step 1: Add titles to all four files**

- [ ] **Step 2: Verify the registry test now PASSES**

```
npm run typecheck
npx vitest run tests/registry/tool-titles.test.ts
```

Expected: all three test cases PASS — non-empty, ≤40 chars, unique.

- [ ] **Step 3: Commit**

```
git add src/tools/ui/index.ts src/tools/templates/index.ts src/tools/plugin-interop/index.ts src/tools/extras/index.ts
git commit -m "feat(tools): add title annotation to remaining modules

Completes the title backfill from #289 across ui, templates, plugin-interop,
and extras modules — every active tool now ships a non-empty title.

Refs #289"
```

---

## Task 9: Flip `title` from optional to required + fix test fixtures

With every `defineTool` call site carrying a title, we can promote `title` from optional to required so future tools fail at compile time without one.

**Files:**
- Modify: `src/registry/types.ts` (interface)
- Modify: `tests/registry/module-registry.test.ts:15-26` (`createMockTool`)
- Modify: `tests/server/mcp-server.test.ts:100-117` (the two inline ToolDefinition stubs)

The `tests/server/dispatcher.test.ts` `makeTool` returns a plain object with `Partial<ToolDefinition>` overrides spread; once `title` is required, the default object literal must include it. Update that file too.

- [ ] **Step 1: Change `title?:` to `title:` in `src/registry/types.ts`**

Update the interface (the field added in Task 1, around line 36):

```typescript
/**
 * Human-readable title used by hosts in confirmation / auto-approve UI.
 * Sentence case, no module prefix, ≤40 characters. See spec
 * `docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`.
 */
title: string;
```

Remove the rollout-phase note from the JSDoc.

- [ ] **Step 2: Run typecheck — expect fixture failures**

```
npm run typecheck
```

Expected: FAIL with errors in `tests/registry/module-registry.test.ts` (the `createMockTool` factory no longer satisfies `ToolDefinition`) and in `tests/server/mcp-server.test.ts` (the two `as unknown as ToolDefinition` casts still compile, but TypeScript may flag inconsistencies depending on strictness — note any errors and fix). `tests/server/dispatcher.test.ts:makeTool` returns `ToolDefinition` directly so it will fail.

- [ ] **Step 3: Update `tests/registry/module-registry.test.ts:createMockTool`**

```typescript
function createMockTool(name: string, readOnly: boolean): ToolDefinition {
  return {
    name,
    title: `Mock ${name}`,
    description: `Mock tool: ${name}`,
    schema: {},
    handler: (): Promise<CallToolResult> =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'ok' }],
      }),
    annotations: readOnly ? annPresets.read : annPresets.destructive,
  };
}
```

- [ ] **Step 4: Update `tests/server/dispatcher.test.ts:makeTool`**

In the default object (around line 15) add:

```typescript
return {
  name: 'demo_tool',
  title: 'Demo tool',
  description: 'Demo tool for the dispatcher tests',
  …
};
```

- [ ] **Step 5: Update `tests/server/mcp-server.test.ts`**

Add `title: 'tool with output'` to the `toolWithOutputSchema` literal (around line 100), `title: 'tool without output'` to `toolWithoutOutputSchema` (around line 110), and `title: 'test tool'` to the second `makeTool` (around line 167) inside `describe('createToolDispatcher', …)`.

- [ ] **Step 6: Run typecheck and the full test suite**

```
npm run typecheck
npm test
```

Expected: typecheck PASS; all tests PASS.

- [ ] **Step 7: Commit**

```
git add src/registry/types.ts tests/registry/module-registry.test.ts tests/server/dispatcher.test.ts tests/server/mcp-server.test.ts
git commit -m "feat(registry)!: make title required on ToolDefinition

Now that every defineTool call site carries a title, promote the field to
required so a future tool added without a title fails at compile time.

Test fixtures that hand-construct ToolDefinition values updated accordingly.

Refs #289"
```

(Conventional Commits: `!` because the public `ToolDefinition` interface gains a required field — strict semver-MAJOR. Same scope token as the type lives in.)

---

## Task 10: Sibling cross-references — issue-scope pairs

**Files:**
- Modify: `src/tools/vault/index.ts` (`vault_read`, `vault_list`, `vault_list_recursive`, `vault_get_metadata`)
- Modify: `src/tools/editor/index.ts` (`editor_get_content`)
- Modify: `src/tools/search/index.ts` (`search_resolved_links`, `search_unresolved_links`)
- Modify: `src/tools/extras/index.ts` (`extras_get_date`)

Each pair is symmetric — both sides add a `seeAlso` entry naming the other tool.

- [ ] **Step 1: `editor_get_content` ↔ `vault_read`**

In `src/tools/editor/index.ts` for `editor_get_content`, add to the `describeTool` call:

```typescript
seeAlso: [
  'vault_read — when reading any file by path, not just the active one.',
],
```

In `src/tools/vault/index.ts` for `vault_read`, add:

```typescript
seeAlso: [
  'editor_get_content — when reading the file currently open in the editor (no path needed).',
],
```

- [ ] **Step 2: `vault_list` ↔ `vault_list_recursive`**

In `src/tools/vault/index.ts` for `vault_list`:

```typescript
seeAlso: [
  'vault_list_recursive — when you also need files in subfolders.',
],
```

For `vault_list_recursive`:

```typescript
seeAlso: [
  'vault_list — when you only need direct children of one folder.',
],
```

- [ ] **Step 3: `search_resolved_links` ↔ `search_unresolved_links`**

In `src/tools/search/index.ts` for `search_resolved_links`:

```typescript
seeAlso: [
  'search_unresolved_links — when you want broken/dangling links instead.',
],
```

For `search_unresolved_links`:

```typescript
seeAlso: [
  'search_resolved_links — when you want only links that successfully resolve.',
],
```

- [ ] **Step 4: `extras_get_date` ↔ `vault_get_metadata`**

In `src/tools/extras/index.ts` for `extras_get_date`:

```typescript
seeAlso: [
  'vault_get_metadata — when you need a file\'s modified/created timestamp, not today\'s date.',
],
```

In `src/tools/vault/index.ts` for `vault_get_metadata`:

```typescript
seeAlso: [
  'extras_get_date — when you need the current date in a specific format, not a file\'s timestamp.',
],
```

- [ ] **Step 5: Run typecheck and the full suite**

```
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/tools/vault/index.ts src/tools/editor/index.ts src/tools/search/index.ts src/tools/extras/index.ts
git commit -m "feat(tools): cross-reference siblings called out in #289

Adds symmetric seeAlso entries between four documented sibling pairs so
Claude's description sees both sides of the choice.

Refs #289"
```

---

## Task 11: Sibling cross-references — in-scope expansion (editor triple, search_tags ↔ search_by_tag)

**Files:**
- Modify: `src/tools/editor/index.ts` (`editor_insert`, `editor_replace`, `editor_delete`)
- Modify: `src/tools/search/index.ts` (`search_tags`, `search_by_tag`)

- [ ] **Step 1: `editor_insert` / `editor_replace` / `editor_delete` triple — each lists the other two**

In `src/tools/editor/index.ts` for `editor_insert`:

```typescript
seeAlso: [
  'editor_replace — when you want to overwrite an existing range, not insert at a point.',
  'editor_delete — when you want to remove a range without writing anything in its place.',
],
```

For `editor_replace`:

```typescript
seeAlso: [
  'editor_insert — when you want to add text at a single point without overwriting anything.',
  'editor_delete — when you want to remove a range without writing anything in its place.',
],
```

For `editor_delete`:

```typescript
seeAlso: [
  'editor_insert — when you want to add text at a single point without overwriting anything.',
  'editor_replace — when you want to overwrite an existing range, not just remove it.',
],
```

- [ ] **Step 2: `search_tags` ↔ `search_by_tag`**

In `src/tools/search/index.ts` for `search_tags`:

```typescript
seeAlso: [
  'search_by_tag — when you want notes carrying a tag, not the list of tags.',
],
```

For `search_by_tag`:

```typescript
seeAlso: [
  'search_tags — when you want the list of tags in the vault, not notes.',
],
```

- [ ] **Step 3: Run typecheck and the suite**

```
npm run typecheck
npm test
```

- [ ] **Step 4: Commit**

```
git add src/tools/editor/index.ts src/tools/search/index.ts
git commit -m "feat(tools): cross-reference editor triple and search tag siblings

Expanded sibling-disambiguation scope of #289 with confusable cases noticed
during review: editor_insert/replace/delete and search_tags/search_by_tag.

Refs #289"
```

---

## Task 12: Sibling-symmetry registry test

**Files:**
- Modify: `tests/registry/tool-titles.test.ts` (append the symmetry block)

- [ ] **Step 1: Append the symmetry test cases**

Add to the existing `describe('tool titles', …)` block in `tests/registry/tool-titles.test.ts`:

```typescript
const SIBLING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['editor_get_content', 'vault_read'],
  ['vault_list', 'vault_list_recursive'],
  ['search_resolved_links', 'search_unresolved_links'],
  ['extras_get_date', 'vault_get_metadata'],
  ['editor_insert', 'editor_replace'],
  ['editor_insert', 'editor_delete'],
  ['editor_replace', 'editor_delete'],
  ['search_tags', 'search_by_tag'],
];

describe('sibling cross-references', () => {
  function descriptionByName(name: string): string {
    const tool = allTools().find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found in registry: ${name}`);
    return tool.description;
  }

  for (const [a, b] of SIBLING_PAIRS) {
    it(`${a} description names ${b}`, () => {
      expect(descriptionByName(a)).toContain(b);
    });
    it(`${b} description names ${a}`, () => {
      expect(descriptionByName(b)).toContain(a);
    });
  }
});
```

- [ ] **Step 2: Run the new tests**

```
npx vitest run tests/registry/tool-titles.test.ts
```

Expected: PASS — every documented pair is symmetric thanks to Tasks 10–11.

- [ ] **Step 3: Commit**

```
git add tests/registry/tool-titles.test.ts
git commit -m "test(registry): assert sibling pairs are mutually cross-referenced

Refs #289"
```

---

## Task 13: Extend `scripts/list-tools.ts` to emit per-module title and annotation tables

**Files:**
- Modify: `scripts/list-tools.ts`
- Modify: `tests/scripts/list-tools.test.ts` (new assertions for the new section)

- [ ] **Step 1: Write failing test cases**

Append to `tests/scripts/list-tools.test.ts` inside the existing `describe('scripts/list-tools', …)`:

```typescript
it('renders a per-module Tools section with name, title, and annotation columns', () => {
  const rows = collectToolRows();
  const md = renderMarkdown(rows);
  expect(md).toContain('## Tools by module');
  expect(md).toContain('| Name | Title | readOnly | destructive |');
  expect(md).toContain('| `vault_create` | Create file |');
  expect(md).toContain('| `vault_read` | Read file | ✓ |');
});

it('every tool name appears in the per-module section with its title', () => {
  const rows = collectToolRows();
  const md = renderMarkdown(rows);
  for (const row of rows) {
    for (const tool of row.tools) {
      expect(md).toContain(`| \`${tool.name}\` | ${tool.title} |`);
    }
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run tests/scripts/list-tools.test.ts
```

Expected: FAIL — `row.tools` is currently `string[]` (just names); the new sections aren't emitted.

- [ ] **Step 3: Update `scripts/list-tools.ts`**

Replace the file with:

```typescript
/**
 * Walk the tool registry and emit a markdown snapshot of every module and
 * its tools. Used as the source of truth for `docs/tools.generated.md` so
 * CI can detect drift between the code and the documentation.
 *
 * Run via `npm run docs:tools`.
 */

import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { MockObsidianAdapter } from '../src/obsidian/mock-adapter';
import { discoverModules } from '../src/tools';

interface ToolEntry {
  name: string;
  title: string;
  readOnly: boolean;
  destructive: boolean;
}

interface ToolRow {
  moduleId: string;
  moduleName: string;
  tools: ToolEntry[];
}

export function collectToolRows(): ToolRow[] {
  const adapter = new MockObsidianAdapter();
  const modules = discoverModules(adapter);
  return modules.map((module) => ({
    moduleId: module.metadata.id,
    moduleName: module.metadata.name,
    tools: module.tools().map((t) => ({
      name: t.name,
      title: t.title,
      readOnly: t.annotations.readOnlyHint === true,
      destructive: t.annotations.destructiveHint === true,
    })),
  }));
}

function check(value: boolean): string {
  return value ? '✓' : '';
}

export function renderMarkdown(rows: ToolRow[]): string {
  const lines: string[] = [];
  lines.push('<!-- AUTO-GENERATED by `npm run docs:tools`. Do not edit manually. -->');
  lines.push('');
  lines.push('# Tool Registry Snapshot');
  lines.push('');
  lines.push(
    'This file is regenerated from the tool registry and committed so CI can detect doc drift.',
  );
  lines.push('');

  // Summary table — preserved for backward compatibility with existing tests.
  lines.push('| Module ID | Module Name | Count | Tools |');
  lines.push('|---|---|---|---|');

  let total = 0;
  for (const row of rows) {
    total += row.tools.length;
    const tools = row.tools.map((t) => t.name).join(', ');
    lines.push(
      `| \`${row.moduleId}\` | ${row.moduleName} | ${String(row.tools.length)} | ${tools} |`,
    );
  }

  lines.push('');
  lines.push(`**Total tools:** ${String(total)} across ${String(rows.length)} modules.`);
  lines.push('');

  // Per-module detail tables — new in #289. Surfaces the three Directory
  // hard-pass criteria (title + readOnlyHint + destructiveHint) per tool.
  lines.push('## Tools by module');
  lines.push('');
  for (const row of rows) {
    lines.push(`### ${row.moduleName} (\`${row.moduleId}\`)`);
    lines.push('');
    lines.push('| Name | Title | readOnly | destructive |');
    lines.push('|---|---|---|---|');
    for (const t of row.tools) {
      lines.push(
        `| \`${t.name}\` | ${t.title} | ${check(t.readOnly)} | ${check(t.destructive)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function main(): void {
  const outPath = argv[2] ?? 'docs/tools.generated.md';
  const rows = collectToolRows();
  const markdown = renderMarkdown(rows);
  writeFileSync(outPath, markdown);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${String(rows.length)} modules, ${String(rows.reduce((n, r) => n + r.tools.length, 0))} tools)`);
}

if (import.meta.url === `file://${argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Update the existing list-tools test to match the new shape**

The pre-existing test at `tests/scripts/list-tools.test.ts:24-32` iterates `row.tools` as strings. Replace its inner loop with:

```typescript
for (const row of rows) {
  for (const tool of row.tools) {
    expect(md).toContain(tool.name);
  }
}
```

And in the first test (lines 5-14), update `expect(row.tools.length)` — already references `.length`, which works for arrays of objects too. No change needed there.

- [ ] **Step 5: Run all list-tools tests**

```
npx vitest run tests/scripts/list-tools.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```
git add scripts/list-tools.ts tests/scripts/list-tools.test.ts
git commit -m "feat(scripts): list-tools emits per-module title and annotation tables

Refs #289"
```

---

## Task 14: Regenerate `docs/tools.generated.md`

**Files:**
- Modify: `docs/tools.generated.md` (auto-generated)

- [ ] **Step 1: Regenerate**

```
npm run docs:tools
```

Expected output: `Wrote docs/tools.generated.md (8 modules, 54 tools)`.

- [ ] **Step 2: Run `docs:check` to confirm zero drift**

```
npm run docs:check
```

Expected: exit 0 (no diff).

- [ ] **Step 3: Commit the regenerated doc**

```
git add docs/tools.generated.md
git commit -m "docs(tools): regenerate snapshot with titles and annotation columns

Refs #289"
```

---

## Task 15: Spot-check `docs/help/en.md` for tool-name references

The user manual generally describes surfaces, not individual tools, so no change is expected. Confirm.

**Files:**
- Inspect (modify only if needed): `docs/help/en.md` and any sibling `docs/help/<locale>.md`.

- [ ] **Step 1: Search the manual for tool-name patterns**

```
grep -nE '(vault|editor|search|workspace|ui|template|plugin|extras)_[a-z_]+' docs/help/*.md
```

If the result is empty, the manual does not name individual tools — no change needed; skip to Step 3 with no commit.

- [ ] **Step 2: If a tool name appears, append its title in parentheses next to the name**

Example: `vault_read` → `vault_read (Read file)`. Edit the manual section in place. Repeat in every locale file that mirrors the section.

- [ ] **Step 3: If changes were made, commit; otherwise note "no manual change required" in PR body**

```
git add docs/help/*.md
git commit -m "docs(help): surface tool titles next to tool-name references

Refs #289"
```

---

## Task 16: Final full-suite verification

**Files:**
- (none — verification only)

- [ ] **Step 1: Run lint**

```
npm run lint
```

Expected: PASS (no errors).

- [ ] **Step 2: Run typecheck**

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

```
npm test
```

Expected: every suite PASS, including the new `tests/registry/tool-titles.test.ts`.

- [ ] **Step 4: Run docs:check one more time as a guard against drift introduced after Task 14**

```
npm run docs:check
```

Expected: exit 0.

- [ ] **Step 5: Inspect the commit log to confirm scope and message style**

```
git log --oneline main..HEAD
```

Expected: a sequence of commits, each touching one logical concern, all referencing `#289` in the body, all conforming to Conventional Commits and the project's no-AI-attribution rule.

---

## Task 17: Push and open the PR

**Files:**
- (none — git/forge interaction only)

- [ ] **Step 1: Push the branch**

```
git push -u origin feat/issue-289-tool-titles-and-sibling-cross-refs
```

- [ ] **Step 2: Open the PR**

```
gh pr create --title "feat(tools): add title annotation to all tools and add sibling cross-refs" --body "$(cat <<'EOF'
Closes #289

## Summary

- Adds a required `title: string` field to `ToolDefinition`; forwarded to both `Tool.title` and `ToolAnnotations.title` at registration so hosts render a human-readable label in confirmation/auto-approve UI (Anthropic Directory hard-pass criterion).
- Adds a structured `seeAlso` section to `describeTool`, populated for the four sibling pairs called out in #289 plus two in-scope expansions (editor `insert`/`replace`/`delete` and `search_tags` ↔ `search_by_tag`).
- Regenerates `docs/tools.generated.md` with per-module title + annotation tables.
- New registry tests assert title presence/length/uniqueness and sibling-pair symmetry; existing tests updated to satisfy the now-required field.

## Test plan

- [x] `npm run lint` — clean
- [x] `npm run typecheck` — clean
- [x] `npm test` — all suites green, including the new `tests/registry/tool-titles.test.ts`
- [x] `npm run docs:check` — no drift between code and `docs/tools.generated.md`
EOF
)"
```

- [ ] **Step 3: Note follow-up issues to file after merge**

After this PR merges, file follow-up issues for the deferred sibling pairs (deferred per the spec's "in-scope vs out-of-scope" split):

- `vault_get_outgoing_links` / `vault_get_embeds` / `vault_get_backlinks`
- `editor_set_cursor` / `editor_set_selection`
- `editor_get_active_file` / `workspace_get_active_leaf`
- `template_create_from` / `template_expand`

Use `gh issue create` with the `enhancement` label for each.

---

## Self-review

- **Spec coverage:** every section of the spec has at least one task (architecture → 1, 2, 9; title catalogue → 4–8; sibling pairs → 10, 11; tests → 3, 12; generated docs → 13, 14; user manual → 15). ✓
- **Placeholders:** no TBDs, no "implement later", no "similar to". ✓
- **Type consistency:** `title` is the field name everywhere (interface, defineTool, registration forwarding, fixtures, tests, scripts). `seeAlso` is consistent across the helper, the call sites, and the test pair list. ✓
- **Commit boundaries:** every commit is one logical concern (one module's titles per commit; sibling cross-refs split between scope and expansion; doc generator separated from doc regen). ✓
