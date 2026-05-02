# Issue #276 — `outputSchema` declarations for Batch B (search + vault `get_*` getters)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare `outputSchema` on the 12 read tools that emit `structuredContent` in Batch B (six in the `search` module, six `vault_get_*` getters that live in the `vault` module post-#255), and parse-validate every shape with strict-mode Zod tests.

**Architecture:** Mirror the framework PR (#279) exactly — module-level `outputSchema` raw-shape consts at the top of each `*/index.ts`, wired into `defineTool({ outputSchema: ... })`. Tests use `z.object(shape).strict().parse(result.structuredContent)` so any drift between the renderer and the structured payload fails loudly.

**Tech Stack:** TypeScript, Zod, Vitest, MCP SDK (`@modelcontextprotocol/sdk`).

**Refs:** [Design](../specs/2026-05-02-output-schema-batches-bcd-design.md), #248 / PR #279 (framework + Batch A), #258 (campaign tracker).

---

## Phase 0 — Branch and baseline

### Task 1: Create branch and capture baseline

**Files:** none modified yet.

- [ ] **Step 1: Verify the working tree only contains the new design + plan files**

Run: `git status`
Expected: untracked files include `docs/superpowers/specs/2026-05-02-output-schema-batches-bcd-design.md` and `docs/superpowers/plans/276-output-schema-search.md` only. No other modifications.

- [ ] **Step 2: Create the feature branch from `main`**

Run:
```bash
git fetch origin
git checkout -b feat/issue-276-output-schema-search origin/main
```

Expected: switches to a fresh branch off the latest `origin/main`.

- [ ] **Step 3: Re-add the design + plan files (they were untracked, so the branch checkout preserves them)**

Run: `git status`
Expected: same untracked design + plan files now appear under the new branch.

- [ ] **Step 4: Commit the design + plan**

Run:
```bash
git add docs/superpowers/specs/2026-05-02-output-schema-batches-bcd-design.md \
        docs/superpowers/plans/276-output-schema-search.md
git commit -m "$(cat <<'EOF'
docs(specs): design and plan for outputSchema batches B/C/D

Brainstormed design covering #276 (Batch B), #277 (Batch C), and #278
(Batch D), plus the per-PR implementation plan for Batch B.

Refs #276
Refs #258
EOF
)"
```

Expected: commit succeeds; pre-commit hooks (if any) pass.

- [ ] **Step 5: Run the baseline test suite to confirm green starting point**

Run: `npm test`
Expected: all tests pass (matches `main`). Capture the test count for later comparison.

- [ ] **Step 6: Run lint and typecheck baseline**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

---

## Phase 1 — Search module (`src/tools/search/index.ts`)

The six search tools that emit `structuredContent` today: `search_fulltext`, `search_tags`, `search_resolved_links`, `search_unresolved_links`, `search_by_tag`, `search_by_frontmatter`. Verified against [`src/tools/search/handlers.ts`](../../../src/tools/search/handlers.ts).

### Task 2: Write the failing parse-validation tests

**Files:**
- Modify: `tests/tools/search/search.test.ts` (append a new top-level `describe` block; do NOT create a new file).

- [ ] **Step 1: Open `tests/tools/search/search.test.ts` and append a new top-level describe block at the end of the file**

Add this block AFTER the existing `describe('search handlers', ...)` block (the file's current last block). Add `import { z } from 'zod';` at the top of the file if it's not already imported (currently it is not — see line 1 of the existing file).

Add the import at the top (line 2 area) so the file's imports look like:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createSearchHandlers, type SearchHandlers } from '../../../src/tools/search/handlers';
import { createSearchModule } from '../../../src/tools/search/index';
```

Append at the end of the file:

```ts
/**
 * Batch B of #248: every search tool that emits `structuredContent` must
 * declare an `outputSchema`, and that schema must accurately describe the
 * payload the handler produces. Strict-mode parsing catches drift between
 * the markdown renderer and the structured payload.
 */
describe('search read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }

  function findTool(
    name: string,
  ): { name: string; outputSchema?: z.ZodRawShape } {
    const adapter = new MockObsidianAdapter();
    const module = createSearchModule(adapter);
    const tool = module.tools().find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not found`);
    return tool;
  }

  it('search_fulltext declares outputSchema and parses with has_more=false', async () => {
    const tool = findTool('search_fulltext');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'Hello World');
    adapter.addFile('b.md', 'Goodbye World');
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchFulltext({
      query: 'World',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(2);
    expect(parsed.count).toBe(2);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_offset).toBeUndefined();
    expect(parsed.items).toHaveLength(2);
  });

  it('search_fulltext parses with has_more=true and next_offset', async () => {
    const tool = findTool('search_fulltext');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    for (let i = 0; i < 5; i++) {
      adapter.addFile(`f-${String(i)}.md`, 'World');
    }
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchFulltext({
      query: 'World',
      limit: 2,
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_offset).toBe(2);
  });

  it('search_tags declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_tags');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { tags: ['#project'] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchTags({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.tags).toEqual({ '#project': ['a.md'] });
  });

  it('search_resolved_links declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_resolved_links');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.addFile('b.md', '');
    adapter.setMetadata('a.md', { links: [{ link: 'b' }] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchResolvedLinks({
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.links).toEqual({ 'a.md': { 'b.md': 1 } });
  });

  it('search_unresolved_links declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_unresolved_links');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { links: [{ link: 'missing' }] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchUnresolvedLinks({
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.links).toEqual({ 'a.md': { missing: 1 } });
  });

  it('search_by_tag declares outputSchema and parses with has_more=false', async () => {
    const tool = findTool('search_by_tag');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { tags: ['#project'] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByTag({
      tag: 'project',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_offset).toBeUndefined();
    expect(parsed.items).toEqual(['a.md']);
  });

  it('search_by_tag parses with has_more=true and next_offset', async () => {
    const tool = findTool('search_by_tag');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    for (let i = 0; i < 5; i++) {
      adapter.addFile(`f-${String(i)}.md`, '');
      adapter.setMetadata(`f-${String(i)}.md`, { tags: ['#project'] });
    }
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByTag({
      tag: 'project',
      limit: 2,
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(5);
    expect(parsed.count).toBe(2);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_offset).toBe(2);
  });

  it('search_by_frontmatter declares outputSchema and parses against handler output', async () => {
    const tool = findTool('search_by_frontmatter');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', { frontmatter: { status: 'done' } });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchByFrontmatter({
      key: 'status',
      value: 'done',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.total).toBe(1);
    expect(parsed.has_more).toBe(false);
    expect(parsed.items).toEqual(['a.md']);
  });
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npx vitest run tests/tools/search/search.test.ts -t "search read tools — outputSchema declarations"`
Expected: every `it(...)` in the new block fails with `Error: expected outputSchema to be declared`. The pre-existing tests in `search.test.ts` should still pass.

- [ ] **Step 3: Run lint and typecheck on the new test file**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean. If lint flags the new code, fix it now (most likely missing import sorting or trailing-newline issues).

### Task 3: Add `outputSchema` consts and wire them to `defineTool` calls

**Files:**
- Modify: `src/tools/search/index.ts`

- [ ] **Step 1: Add the import for `z`**

`src/tools/search/index.ts` currently imports nothing from `zod`. Add this as the first line:

```ts
import { z } from 'zod';
```

- [ ] **Step 2: Add five `outputSchema` raw-shape consts between the imports and `createSearchModule`**

Insert this block immediately before `export function createSearchModule(...)` (currently line 12):

```ts
/**
 * Output schemas for the search tools that emit `structuredContent`. Each
 * shape mirrors what the corresponding handler in `./handlers.ts` puts on
 * `result.structuredContent` — declaring them lets modern MCP clients
 * validate / introspect the typed payload (Batch B of #248).
 */
const searchFulltextOutputSchema = {
  total: z.number().describe('Total number of matched files before pagination.'),
  count: z.number().describe('Number of matches in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  items: z
    .array(
      z.object({
        path: z.string().describe('Vault-relative path of the matching file.'),
        matches: z
          .array(z.string())
          .describe('Lines from the file that contain the query.'),
      }),
    )
    .describe('Matches in this page.'),
  has_more: z
    .boolean()
    .describe('True when more results are available past this page.'),
  next_offset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when has_more is true.'),
};

const searchTagsOutputSchema = {
  tags: z
    .record(z.string(), z.array(z.string()))
    .describe('Map of tag (with leading #) to vault-relative file paths that use it.'),
};

const searchLinksMapOutputSchema = {
  links: z
    .record(z.string(), z.record(z.string(), z.number()))
    .describe('Map of source file path to map of target file path to reference count.'),
};

const paginatedPathPageOutputSchema = {
  total: z
    .number()
    .describe('Total number of matching files before pagination.'),
  count: z.number().describe('Number of files in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  items: z
    .array(z.string())
    .describe('Vault-relative file paths in this page.'),
  has_more: z
    .boolean()
    .describe('True when there are more files past this page.'),
  next_offset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when has_more is true.'),
};
```

- [ ] **Step 3: Wire each schema to its `defineTool` call**

In the same file, modify each `defineTool({...})` block by adding an `outputSchema:` field directly after the existing `schema:` field. The six edits, in file order:

For `search_fulltext` (currently line 24-36):
```ts
schema: searchFulltextSchema,
outputSchema: searchFulltextOutputSchema,
handler: handlers.searchFulltext,
```

For `search_tags` (currently line 37-46):
```ts
schema: readOnlySchema,
outputSchema: searchTagsOutputSchema,
handler: handlers.searchTags,
```

For `search_resolved_links` (currently line 47-56):
```ts
schema: readOnlySchema,
outputSchema: searchLinksMapOutputSchema,
handler: handlers.searchResolvedLinks,
```

For `search_unresolved_links` (currently line 57-67):
```ts
schema: readOnlySchema,
outputSchema: searchLinksMapOutputSchema,
handler: handlers.searchUnresolvedLinks,
```

For `search_by_tag` (currently line 68-78):
```ts
schema: searchByTagSchema,
outputSchema: paginatedPathPageOutputSchema,
handler: handlers.searchByTag,
```

For `search_by_frontmatter` (currently line 79-93):
```ts
schema: searchByFrontmatterSchema,
outputSchema: paginatedPathPageOutputSchema,
handler: handlers.searchByFrontmatter,
```

- [ ] **Step 4: Run the search outputSchema tests and confirm they pass**

Run: `npx vitest run tests/tools/search/search.test.ts -t "search read tools — outputSchema declarations"`
Expected: all 8 new tests pass; the existing search tests still pass.

- [ ] **Step 5: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 4: Commit the search module work

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add src/tools/search/index.ts tests/tools/search/search.test.ts
git commit -m "$(cat <<'EOF'
feat(tools/search): declare outputSchema for read tools

Declare outputSchema on the six search tools that emit structuredContent
(search_fulltext, search_tags, search_resolved_links,
search_unresolved_links, search_by_tag, search_by_frontmatter) so modern
MCP clients can validate and introspect the typed payload. Strict-mode
parse tests pin every shape against the matching handler output and
guard against renderer-vs-payload drift.

Refs #276
Refs #258
EOF
)"
```

Expected: commit succeeds.

---

## Phase 2 — Vault `get_*` getters (`src/tools/vault/index.ts`)

The six single-path getters renamed from `search_get_*` by #255 — they live in `src/tools/vault/index.ts` today but use search handlers. Tools: `vault_get_frontmatter`, `vault_get_headings`, `vault_get_outgoing_links`, `vault_get_embeds`, `vault_get_backlinks`, `vault_get_block_references`.

### Task 5: Extend the existing vault outputSchema describe block with failing tests

**Files:**
- Modify: `tests/tools/vault/module.test.ts` — add six new `it(...)` blocks INSIDE the existing `describe('vault read tools — outputSchema declarations', ...)` block (currently lines 77-202). Add them after the `vault_read_binary` test at line 201, before the closing `});` of the describe block at line 202.

- [ ] **Step 1: Add helper imports**

The existing test file already imports what we need (`z`, `MockObsidianAdapter`, `createVaultModule`). Verify by reading the top of the file. Additionally, verify the test file imports `createSearchHandlers` — it does NOT today. Add this import at the top:

```ts
import { createSearchHandlers } from '../../../src/tools/search/handlers';
```

- [ ] **Step 2: Add six new `it(...)` blocks inside the existing describe block**

Insert these tests inside `describe('vault read tools — outputSchema declarations', () => { ... })`, immediately before the closing `});` of that describe block (which is at line 202 of the current file):

```ts
  it('vault_get_frontmatter declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_frontmatter');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', '');
    adapter.setMetadata('note.md', { frontmatter: { status: 'done', tags: ['x'] } });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchFrontmatter({
      path: 'note.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('note.md');
    expect(parsed.frontmatter).toEqual({ status: 'done', tags: ['x'] });
  });

  it('vault_get_headings declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_headings');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', '');
    adapter.setMetadata('note.md', {
      headings: [
        { heading: 'Top', level: 1 },
        { heading: 'Sub', level: 2 },
      ],
    });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchHeadings({
      path: 'note.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.headings).toEqual([
      { heading: 'Top', level: 1 },
      { heading: 'Sub', level: 2 },
    ]);
  });

  it('vault_get_outgoing_links declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_outgoing_links');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', {
      links: [{ link: 'b', displayText: 'Bee' }, { link: 'c' }],
    });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchOutgoingLinks({
      path: 'a.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('a.md');
    expect(parsed.links).toEqual([
      { link: 'b', displayText: 'Bee' },
      { link: 'c' },
    ]);
  });

  it('vault_get_embeds declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_embeds');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.setMetadata('a.md', {
      embeds: [{ link: 'image.png' }],
    });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchEmbeds({
      path: 'a.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.embeds).toEqual([{ link: 'image.png' }]);
  });

  it('vault_get_backlinks declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_backlinks');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', '');
    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchBacklinks({
      path: 'a.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('a.md');
    expect(parsed.backlinks).toEqual(['b.md']);
  });

  it('vault_get_block_references declares outputSchema and parses against handler output', async () => {
    const tool = findTool('vault_get_block_references');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', 'A line ^anchor-1\nAnother ^anchor-2\n');
    const handlers = createSearchHandlers(adapter);

    const result = await handlers.searchBlockReferences({
      path: 'note.md',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('note.md');
    expect(parsed.blockRefs).toEqual([
      { id: 'anchor-1', line: 'A line ^anchor-1' },
      { id: 'anchor-2', line: 'Another ^anchor-2' },
    ]);
  });
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run: `npx vitest run tests/tools/vault/module.test.ts -t "vault read tools — outputSchema declarations"`
Expected: the 6 new tests fail with `Error: expected outputSchema to be declared`. The 5 existing outputSchema tests in the same describe block (Batch A's `vault_read`, `vault_get_metadata`, `vault_list`, `vault_list_recursive` × 2 cases) still pass. The `vault_read_binary` test that asserts `outputSchema` is undefined still passes — it stays untouched in this PR (Batch D will flip it).

- [ ] **Step 4: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 6: Add the six `outputSchema` consts to `src/tools/vault/index.ts`

**Files:**
- Modify: `src/tools/vault/index.ts`

- [ ] **Step 1: Add the six new consts immediately AFTER the existing `listRecursiveOutputSchema` (currently line 82) and BEFORE `export function createVaultModule(...)` (currently line 84)**

Insert this block:

```ts
/**
 * Output schemas for the `vault_get_*` single-path getters. These tools were
 * renamed from `search_get_*` by #255 and use search handlers, but they live
 * in the vault module today and so their `outputSchema` declarations live
 * alongside the rest of the vault read schemas (Batch B of #248).
 */
const getFrontmatterOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  frontmatter: z
    .record(z.string(), z.unknown())
    .describe('Parsed YAML frontmatter object, or {} when absent.'),
};

const getHeadingsOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  headings: z
    .array(
      z.object({
        heading: z.string().describe('Heading text.'),
        level: z.number().describe('Heading level (1..6).'),
      }),
    )
    .describe('Headings in document order.'),
};

const getOutgoingLinksOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  links: z
    .array(
      z.object({
        link: z.string().describe('Link target.'),
        displayText: z
          .string()
          .optional()
          .describe('Optional alias used in [[link|alias]] notation.'),
      }),
    )
    .describe('Outgoing links from this file.'),
};

const getEmbedsOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  embeds: z
    .array(
      z.object({
        link: z.string().describe('Embed target.'),
        displayText: z.string().optional().describe('Optional alias.'),
      }),
    )
    .describe('Embeds (![[...]]) referenced by this file.'),
};

const getBacklinksOutputSchema = {
  path: z.string().describe('Target path that was queried.'),
  backlinks: z
    .array(z.string())
    .describe('Vault-relative paths of files that link TO the target.'),
};

const getBlockReferencesOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  blockRefs: z
    .array(
      z.object({
        id: z.string().describe('Block-reference id (without the leading ^).'),
        line: z.string().describe('The line of text the block-reference is on.'),
      }),
    )
    .describe('Block references defined in this file.'),
};
```

- [ ] **Step 2: Wire each new schema to its corresponding `defineTool` call**

In the same file, modify the six `vault_get_*` `defineTool({...})` blocks (currently lines 361-432) by adding `outputSchema:` directly after `schema:`. Six edits in file order:

For `vault_get_frontmatter`:
```ts
schema: searchFilePathSchema,
outputSchema: getFrontmatterOutputSchema,
handler: searchHandlers.searchFrontmatter,
```

For `vault_get_headings`:
```ts
schema: searchFilePathSchema,
outputSchema: getHeadingsOutputSchema,
handler: searchHandlers.searchHeadings,
```

For `vault_get_outgoing_links`:
```ts
schema: searchFilePathSchema,
outputSchema: getOutgoingLinksOutputSchema,
handler: searchHandlers.searchOutgoingLinks,
```

For `vault_get_embeds`:
```ts
schema: searchFilePathSchema,
outputSchema: getEmbedsOutputSchema,
handler: searchHandlers.searchEmbeds,
```

For `vault_get_backlinks`:
```ts
schema: searchFilePathSchema,
outputSchema: getBacklinksOutputSchema,
handler: searchHandlers.searchBacklinks,
```

For `vault_get_block_references`:
```ts
schema: searchFilePathSchema,
outputSchema: getBlockReferencesOutputSchema,
handler: searchHandlers.searchBlockReferences,
```

- [ ] **Step 3: Run the vault outputSchema tests and confirm they pass**

Run: `npx vitest run tests/tools/vault/module.test.ts -t "vault read tools — outputSchema declarations"`
Expected: all 11 tests in the describe block pass (the 5 from Batch A + the 6 new ones; the `vault_read_binary` "intentionally omits" test is also still passing).

- [ ] **Step 4: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 7: Commit the vault-getter work

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add src/tools/vault/index.ts tests/tools/vault/module.test.ts
git commit -m "$(cat <<'EOF'
feat(tools/vault): declare outputSchema for vault_get_* getters

Declare outputSchema on the six single-path getters renamed from
search_get_* by #255 (vault_get_frontmatter, vault_get_headings,
vault_get_outgoing_links, vault_get_embeds, vault_get_backlinks,
vault_get_block_references). They live in the vault module but use
search handlers; this PR completes Batch B of #248 by giving each one
a strict-mode-tested outputSchema.

Refs #276
Refs #258
EOF
)"
```

Expected: commit succeeds.

---

## Phase 3 — Verification gate, docs, push, PR

### Task 8: Regenerate `docs/tools.generated.md` and run the full gate

**Files:**
- Possibly modify: `docs/tools.generated.md` (if regeneration produces a diff).

- [ ] **Step 1: Regenerate the tools doc**

Run: `npm run docs:tools`
Expected: the script runs to completion. Per the framework PR's note, the current generator only lists tool names, so there should be NO diff for this batch (no tools were added or renamed). Verify with `git status`.

- [ ] **Step 2: If `git status` shows a diff for `docs/tools.generated.md`, commit it**

If there's a diff (unexpected for this batch), inspect it first:
```bash
git diff docs/tools.generated.md
```

If the diff is purely from the regeneration (no manual edits needed), commit:
```bash
git add docs/tools.generated.md
git commit -m "$(cat <<'EOF'
docs(tools): regenerate tools.generated.md after Batch B

Refs #276
EOF
)"
```

If there's no diff, skip this step.

- [ ] **Step 3: Run the full verification gate**

Run each command separately (per CLAUDE.md rule 15):
```bash
npm test
```

Expected: all tests pass — search and vault test counts each grew by their new outputSchema tests; nothing else regressed.

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

If any of the four commands fails, debug the cause and fix before proceeding. Common pitfalls:
- `npm test` failing on a search/vault test → re-check the schema descriptions match what the handler emits (extra field, missing optional, wrong type).
- `npm run lint` failing → most likely an unused `paginatedPathPageOutputSchema` const if the wiring step missed one of `search_by_tag`/`search_by_frontmatter`.
- `npm run typecheck` failing → `outputSchema` field's type must be `z.ZodRawShape`; if a `.describe(...)` chain produced an unexpected type, simplify (Zod's `.describe()` is type-preserving, so this is unlikely).
- `npm run docs:check` failing → re-run `npm run docs:tools` and commit any diff.

### Task 9: Push and open the PR

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/issue-276-output-schema-search`
Expected: branch is created on `origin` and tracks the local branch.

- [ ] **Step 2: Open the PR with `gh`**

Run:
```bash
gh pr create --title "feat(tools/search,vault): declare outputSchema for read tools" --body "$(cat <<'EOF'
Closes #276

## Summary

- Declare `outputSchema` on the six search tools that emit `structuredContent` (`search_fulltext`, `search_tags`, `search_resolved_links`, `search_unresolved_links`, `search_by_tag`, `search_by_frontmatter`).
- Declare `outputSchema` on the six `vault_get_*` getters renamed from `search_get_*` by #255 (`vault_get_frontmatter`, `vault_get_headings`, `vault_get_outgoing_links`, `vault_get_embeds`, `vault_get_backlinks`, `vault_get_block_references`).
- Strict-mode (`z.object(shape).strict().parse(...)`) parse tests pin every shape against the matching handler output, mirroring the framework PR (#279).

## Cross-module split

The issue's "add the declaration to `src/tools/search/index.ts`" wording predates the #255 rename. After #255, the `vault_get_*` getters live in `src/tools/vault/index.ts` (using search handlers) — so this PR splits the schema declarations across both files to match the actual tool-registration sites:

- Tools registered in `src/tools/search/index.ts` → schemas in that file, tests in `tests/tools/search/search.test.ts`.
- `vault_get_*` getters registered in `src/tools/vault/index.ts` → schemas in that file, tests added to the existing `vault read tools — outputSchema declarations` describe block in `tests/tools/vault/module.test.ts`.

## Test plan

- [x] `npm test` — pre-existing tests still green; new strict-mode parse tests cover all 12 in-scope tools (with `has_more=true`/`false` cases for the paginated ones).
- [x] `npm run lint` — clean.
- [x] `npm run typecheck` — clean.
- [x] `npm run docs:check` — clean (no diff: the generator only lists tool names, no new tools or renames in this PR).

## Refs

- Builds on #248 / PR #279 (framework + Batch A).
- Tracker: #258.
- Followups: #277 (Batch C — workspace + editor read), #278 (Batch D — extras + plugin-interop + templates + `vault_read_binary` retrofit).
EOF
)"
```

Expected: PR is created on GitHub and `gh` prints the URL.

- [ ] **Step 3: Print the PR URL**

Run: `gh pr view --json url -q .url`
Expected: the URL is printed for the user to open. Stop here and wait for review/merge before starting Plan 2 (Batch C / #277).

---

## Self-review checklist (run after writing this plan)

This section is for the plan author. Check before handing off:

- **Spec coverage.** Each item in the design's PR-1 scope has a task:
  - Six `search/index.ts` schemas → Task 3 step 2
  - Six `vault/index.ts` schemas → Task 6 step 1
  - Six search-tool tests → Task 2 step 1
  - Six vault-getter tests → Task 5 step 2
  - `docs/tools.generated.md` regen → Task 8 step 1
  - `npm test`, `npm run lint`, `npm run typecheck`, `npm run docs:check` gate → Task 8 step 3
  - PR body cross-module-split note → Task 9 step 2
- **No placeholders.** Every code step contains the actual code; every command step contains the actual command. No "TBD"/"TODO"/"add appropriate error handling".
- **Type consistency.** `outputSchema` field used everywhere matches `ToolDefinition`'s optional `z.ZodRawShape` field (typed by PR #279). Helpers `getStructured` and `findTool` have the same signature in both test files.

## Out of scope (here, deferred to Batch C / D plans)

- Workspace and editor read-tool schemas — Plan 2 (#277).
- Extras + plugin-interop + templates schemas — Plan 3 (#278).
- `vault_read_binary` `structuredContent` retrofit — Plan 3 (#278). The `tests/tools/vault/module.test.ts:194-201` "intentionally omits outputSchema" assertion stays untouched in this PR.
