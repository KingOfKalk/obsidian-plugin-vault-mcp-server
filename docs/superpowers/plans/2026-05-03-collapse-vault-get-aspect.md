# `vault_get_aspect` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace six structurally-identical `vault_get_*` getters
(`frontmatter`, `headings`, `outgoing_links`, `embeds`, `backlinks`,
`block_references`) with one `vault_get_aspect` tool that takes an `aspect`
enum, cutting the tool-list context cost without losing per-aspect
documentation or strict output typing.

**Architecture:** Single new tool registered in the vault module dispatches
on a required `aspect` enum to the existing `searchHandlers.search*`
methods. Output is a Zod `discriminatedUnion('aspect', […])` over six
variants that mirror today's per-tool shapes 1:1 with an added `aspect`
literal. The six underlying handlers in `src/tools/search/handlers.ts` are
untouched; the dispatcher decorates each result by merging `{ aspect }`
into `structuredContent`. Hard cut: the six old tool names are removed in
the same release.

**Tech Stack:** TypeScript (strict ESLint), Zod 4, MCP TypeScript SDK,
Vitest. Zod's `discriminatedUnion` requires the registry's
`ToolDefinition.outputSchema` slot to accept full Zod schemas, not just
raw shapes — that widening is the first commit; the consolidation is the
second.

**Spec:** [`docs/superpowers/specs/2026-05-03-collapse-vault-get-aspect-design.md`](../specs/2026-05-03-collapse-vault-get-aspect-design.md)

**Branch (already created):** `refactor/issue-294-collapse-vault-get-aspect`
off `main` at commit `a936b28`. Spec already committed at `556c0b1`.

**Commit boundaries:**

1. `feat(registry): widen ToolDefinition.outputSchema to accept full Zod schemas` — Tasks 1–2
2. `refactor(tools/vault)!: collapse 6 vault_get_* tools into vault_get_aspect` — Tasks 3–13

Each task ends with either an integration step (run the suite) or a commit
step. The plan never leaves a task half-done across commits.

---

## File Structure

### Files modified

- `src/registry/types.ts` — widen `ToolDefinition.outputSchema` type slot.
- `src/tools/vault/schemas.ts` — add `getAspectSchema`.
- `src/tools/vault/handlers.ts` — add `getAspect` dispatcher to the
  `VaultHandlers` interface and the `createHandlers` factory; thread in the
  six `searchHandlers.search*` methods via a new constructor argument.
- `src/tools/vault/index.ts` — replace six per-tool output schemas and six
  tool registrations with one `getAspectOutputSchema` discriminated union
  and one `vault_get_aspect` registration; pass `searchHandlers` into
  `createHandlers`.
- `src/server/mcp-server.ts` — update `SERVER_INSTRUCTIONS` text mentioning
  "`vault_get_*` tools".
- `src/server/prompts.ts` — update the `find-related` prompt body to
  mention `vault_get_aspect` instead of `vault_get_backlinks`.
- `tests/tools/vault/module.test.ts` — update tool-count and tool-name
  assertions; replace six per-tool outputSchema tests with one
  parametrized aspect test; update `getStructured()` helper to handle a
  Zod schema (not just a raw shape).
- `tests/server/prompts.test.ts` — update the `find-related` assertion to
  expect `vault_get_aspect` (with `aspect: "backlinks"` mention) instead of
  `vault_get_backlinks`.
- `docs/help/en.md` — update the quoted `SERVER_INSTRUCTIONS` block, the
  `find-related` description, and add a breaking-change note.
- `docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`
  — update the vault title table (22 → 17 rows; replace six `vault_get_*`
  rows with one `vault_get_aspect` row); strike the deferred `outgoing_links
  / embeds / backlinks` cross-ref triple.
- `docs/tools.generated.md` — regenerated via `npm run docs:tools`.

### Files created

- None.

### Files deleted

- None. (Everything is in-place edits.)

---

## Task 1: Widen `ToolDefinition.outputSchema` to accept full Zod schemas

**Files:**

- Modify: `src/registry/types.ts:52`
- Modify: `src/server/mcp-server.ts:131-141` (verify, no source change expected)

**Why first:** the `vault_get_aspect` output is a `z.discriminatedUnion(...)`
which is a `ZodTypeAny`, not a `ZodRawShape`. The MCP SDK already accepts
either via its `OutputArgs extends ZodRawShapeCompat | AnySchema` generic
(see `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150`).
Our registry type is the only thing in the way.

- [ ] **Step 1: Read the current registry type slot**

Run: `cat -n src/registry/types.ts | sed -n '42,55p'`
Expected output includes:

```ts
  outputSchema?: z.ZodRawShape;
```

at line 52.

- [ ] **Step 2: Widen the slot to accept either a raw shape or any Zod schema**

Edit `src/registry/types.ts`. Replace:

```ts
  /**
   * Optional Zod raw shape describing the `structuredContent` payload the
   * handler emits. Forwarded to `McpServer.registerTool` so modern clients
   * can validate / introspect the typed output. Tools that don't emit a
   * `structuredContent` slot (e.g. plain-text confirmations or binary
   * payloads) MUST leave this undefined — the MCP SDK requires that any
   * call returning a tool with `outputSchema` declared also carry
   * `structuredContent` matching that schema.
   */
  outputSchema?: z.ZodRawShape;
```

with:

```ts
  /**
   * Optional schema describing the `structuredContent` payload the handler
   * emits. Two shapes are accepted, both forwarded to
   * `McpServer.registerTool` unchanged:
   *
   *   - **Raw shape** (`z.ZodRawShape`) — the common case, used by every
   *     tool whose output is a flat object. The SDK turns it into an
   *     object schema.
   *   - **Full Zod schema** (`z.ZodTypeAny`) — used when the output shape
   *     varies by input, e.g. `z.discriminatedUnion('aspect', [...])`.
   *     The SDK's `OutputArgs extends ZodRawShapeCompat | AnySchema`
   *     generic accepts these directly.
   *
   * Tools that don't emit a `structuredContent` slot (e.g. plain-text
   * confirmations or binary payloads) MUST leave this undefined — the MCP
   * SDK requires that any call returning a tool with `outputSchema`
   * declared also carry `structuredContent` matching that schema.
   */
  outputSchema?: z.ZodRawShape | z.ZodTypeAny;
```

- [ ] **Step 3: Run typecheck to confirm no source-level breakage downstream**

Run: `npm run typecheck`
Expected: PASS. The wiring at `src/server/mcp-server.ts:137`
(`outputSchema: tool.outputSchema`) forwards the value as-is to
`McpServer.registerTool`, which already accepts the union via its
`AnySchema` overload. No change required at the call site.

- [ ] **Step 4: Run the full test suite to confirm no behaviour regression**

Run: `npm test`
Expected: PASS. No tests should fail — the type widening is purely
additive at the type level; runtime behaviour is unchanged.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: PASS.

---

## Task 2: Commit the registry widening

**Files:**

- Stage: `src/registry/types.ts`

- [ ] **Step 1: Confirm the working tree is clean except for the type change**

Run: `git status --short`
Expected output:

```
 M src/registry/types.ts
```

- [ ] **Step 2: Commit**

Run:

```bash
git add src/registry/types.ts
git commit -m "$(cat <<'EOF'
feat(registry): widen ToolDefinition.outputSchema to accept full Zod schemas

The slot used to be `z.ZodRawShape` (object shapes only). The MCP SDK's
`registerTool` already accepts `ZodRawShapeCompat | AnySchema`, so the
narrowing was ours. Widening to `z.ZodRawShape | z.ZodTypeAny` lets
tools whose output shape varies by input (e.g. `z.discriminatedUnion`)
declare a typed `outputSchema` without wrapping or skipping.

No runtime change. Existing tools continue to use raw shapes.

Refs #294
EOF
)"
```

Expected output: a single commit on `refactor/issue-294-collapse-vault-get-aspect`.

- [ ] **Step 3: Verify the commit landed**

Run: `git log --oneline -1`
Expected: a line starting with the new SHA and the subject
`feat(registry): widen ToolDefinition.outputSchema to accept full Zod schemas`.

---

## Task 3: Add the `getAspectSchema` input schema

**Files:**

- Modify: `src/tools/vault/schemas.ts` (append at the end of the file)
- Test: covered by Task 7's parametrized test

- [ ] **Step 1: Read the existing schemas file to find a good insertion point**

Run: `cat -n src/tools/vault/schemas.ts | tail -20`
Note the final exported schema and the trailing newline pattern.

- [ ] **Step 2: Append `getAspectSchema` at the end of the file**

Add this block after the last existing schema (preserve the file's
existing trailing newline):

```ts
/**
 * Input schema for `vault_get_aspect`. Replaces six former `vault_get_*`
 * single-path getters with one tool that takes a required `aspect` enum.
 * The enum's `.describe()` carries the per-aspect documentation that used
 * to live in each tool's prose description, so Claude reads it on every
 * tool-list refresh.
 */
export const getAspectSchema = {
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('Vault-relative path to the file.'),
  aspect: z
    .enum([
      'frontmatter',
      'headings',
      'outgoing_links',
      'embeds',
      'backlinks',
      'block_references',
    ])
    .describe(
      'Which metadata aspect to return. ' +
        '"frontmatter" → parsed YAML frontmatter object, or {} when absent. ' +
        '"headings" → [{ heading, level }] in document order. ' +
        '"outgoing_links" → [{ link, displayText? }] for [[...]] links. ' +
        '"embeds" → [{ link, displayText? }] for ![[...]] embeds. ' +
        '"backlinks" → string[] of vault paths that link TO this file. ' +
        '"block_references" → [{ id, line }] for ^block-ids defined in this file.',
    ),
  ...responseFormatField,
};
```

If the existing file does not already import `responseFormatField`, leave
the import as-is (it's already imported on line 4 — confirmed). If the
existing file does not already import `z`, leave the import as-is (line 1).

- [ ] **Step 3: Confirm the file compiles**

Run: `npm run typecheck`
Expected: PASS. `responseFormatField` and `z` are already imported in
[`src/tools/vault/schemas.ts:1-4`](../../../src/tools/vault/schemas.ts).

---

## Task 4: Add the `getAspect` dispatcher (failing test first)

**Files:**

- Modify: `src/tools/vault/handlers.ts` (extend `VaultHandlers`,
  `createHandlers` signature, and `createHandlers` body)
- Test: `tests/tools/vault/module.test.ts` (add a new failing test in a
  new `describe` block)

- [ ] **Step 1: Write the failing test for the dispatcher**

Append this `describe` block to `tests/tools/vault/module.test.ts` at the
end of the file (after the last existing `describe`):

```ts
describe('vault_get_aspect dispatcher', () => {
  it('routes each aspect to the matching searchHandlers method', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'A line ^anchor\n');
    adapter.setMetadata('a.md', {
      frontmatter: { tag: 'x' },
      headings: [{ heading: 'H', level: 1 }],
      links: [{ link: 'b' }],
      embeds: [{ link: 'img.png' }],
    });
    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });

    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const fm = await handlers.getAspect({ path: 'a.md', aspect: 'frontmatter', response_format: 'json' });
    expect(fm.structuredContent).toEqual({
      aspect: 'frontmatter',
      path: 'a.md',
      frontmatter: { tag: 'x' },
    });

    const headings = await handlers.getAspect({ path: 'a.md', aspect: 'headings', response_format: 'json' });
    expect(headings.structuredContent).toEqual({
      aspect: 'headings',
      path: 'a.md',
      headings: [{ heading: 'H', level: 1 }],
    });

    const out = await handlers.getAspect({ path: 'a.md', aspect: 'outgoing_links', response_format: 'json' });
    expect(out.structuredContent).toEqual({
      aspect: 'outgoing_links',
      path: 'a.md',
      links: [{ link: 'b' }],
    });

    const emb = await handlers.getAspect({ path: 'a.md', aspect: 'embeds', response_format: 'json' });
    expect(emb.structuredContent).toEqual({
      aspect: 'embeds',
      path: 'a.md',
      embeds: [{ link: 'img.png' }],
    });

    const back = await handlers.getAspect({ path: 'a.md', aspect: 'backlinks', response_format: 'json' });
    expect(back.structuredContent).toEqual({
      aspect: 'backlinks',
      path: 'a.md',
      backlinks: ['b.md'],
    });

    const blocks = await handlers.getAspect({ path: 'a.md', aspect: 'block_references', response_format: 'json' });
    expect(blocks.structuredContent).toEqual({
      aspect: 'block_references',
      path: 'a.md',
      blockRefs: [{ id: 'anchor', line: 'A line ^anchor' }],
    });
  });

  it('propagates "File not found" for every aspect', async () => {
    const adapter = new MockObsidianAdapter();
    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const aspects = [
      'frontmatter',
      'headings',
      'outgoing_links',
      'embeds',
      'backlinks',
      'block_references',
    ] as const;

    for (const aspect of aspects) {
      const result = await handlers.getAspect({ path: 'missing.md', aspect });
      expect(result.isError).toBe(true);
      const block = result.content[0];
      if (block.type === 'text') {
        expect(block.text.toLowerCase()).toMatch(/not found|does not exist/);
      }
    }
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:
`npx vitest run tests/tools/vault/module.test.ts -t "vault_get_aspect dispatcher" --reporter=verbose`

Expected: FAIL with TypeScript / runtime errors stating `createHandlers`
takes 2 arguments (not 3) and `handlers.getAspect` does not exist.

- [ ] **Step 3: Extend `VaultHandlers` and `createHandlers` to accept search handlers**

Edit `src/tools/vault/handlers.ts`:

(a) Add the import for `SearchHandlers` near the existing imports:

```ts
import type { SearchHandlers } from '../search/handlers';
```

(b) Add a new field to the `VaultHandlers` interface (anywhere inside the
`export interface VaultHandlers { … }` block — append at the end before
the closing brace):

```ts
  getAspect: (params: InferredParams<typeof getAspectSchema>) => Promise<CallToolResult>;
```

(c) Add `getAspectSchema` to the type-only import block at the top of the
file:

```ts
import type {
  createFileSchema,
  readFileSchema,
  // …existing entries…
  writeBinarySchema,
  getAspectSchema,
} from './schemas';
```

(d) Change the `createHandlers` signature:

```ts
export function createHandlers(
  adapter: ObsidianAdapter,
  mutex: WriteMutex,
  searchHandlers: SearchHandlers,
): VaultHandlers {
```

(e) Add the dispatcher inside the `return { … }` block in `createHandlers`,
after the last existing handler property (before the closing `}`):

```ts
    async getAspect(params): Promise<CallToolResult> {
      try {
        const { aspect, path } = params;
        const inner = await dispatchAspect(searchHandlers, aspect, params);
        return decorateAspect(inner, aspect, path, readResponseFormat(params));
      } catch (error) {
        return handleToolError(error);
      }
    },
```

(f) Add these two helper functions at module scope, after the existing
`textResult` helper (around line 53) but before `export interface VaultHandlers`:

```ts
async function dispatchAspect(
  searchHandlers: SearchHandlers,
  aspect:
    | 'frontmatter'
    | 'headings'
    | 'outgoing_links'
    | 'embeds'
    | 'backlinks'
    | 'block_references',
  params: { path: string; response_format?: 'markdown' | 'json' },
): Promise<CallToolResult> {
  switch (aspect) {
    case 'frontmatter':
      return searchHandlers.searchFrontmatter(params);
    case 'headings':
      return searchHandlers.searchHeadings(params);
    case 'outgoing_links':
      return searchHandlers.searchOutgoingLinks(params);
    case 'embeds':
      return searchHandlers.searchEmbeds(params);
    case 'backlinks':
      return searchHandlers.searchBacklinks(params);
    case 'block_references':
      return searchHandlers.searchBlockReferences(params);
  }
}

function decorateAspect(
  inner: CallToolResult,
  aspect: string,
  path: string,
  format: 'markdown' | 'json',
): CallToolResult {
  // Pass error results through unchanged so the underlying handler's
  // message format (`isError: true`, content[0].text="…not found") is
  // preserved exactly. The dispatcher only decorates success payloads.
  if (inner.isError === true) return inner;

  const decoratedStructured = {
    aspect,
    path,
    ...(inner.structuredContent ?? {}),
  };

  // For JSON output the rendered text mirrors the structured payload;
  // re-stringify so `aspect` shows up there too.
  // For markdown output, leave the rendered text as the underlying
  // handler produced it — the discriminator is implicit in the heading
  // each renderer already emits (e.g. "**path** frontmatter:").
  if (format === 'json') {
    return {
      ...inner,
      content: [{ type: 'text' as const, text: JSON.stringify(decoratedStructured, null, 2) }],
      structuredContent: decoratedStructured,
    };
  }
  return { ...inner, structuredContent: decoratedStructured };
}
```

- [ ] **Step 4: Update `createHandlers` callers to pass `searchHandlers`**

There is exactly one production caller of `createHandlers`. Find and update
it:

Run: `grep -rn "createHandlers(" src/ tests/ --include="*.ts" | grep -v "createSearchHandlers" | grep -v "createPromptHandlers"`

Expected matches (paths may differ slightly — verify before editing):

```
src/tools/vault/index.ts:170:  const handlers = createHandlers(adapter, mutex);
tests/tools/vault/module.test.ts:104:    const handlers = createHandlers(adapter, new WriteMutex());
tests/tools/vault/module.test.ts:120:    const handlers = createHandlers(adapter, new WriteMutex());
…
```

For `src/tools/vault/index.ts:170`, change:

```ts
  const handlers = createHandlers(adapter, mutex);
```

to:

```ts
  const searchHandlers = createSearchHandlers(adapter);
  const handlers = createHandlers(adapter, mutex, searchHandlers);
```

(and remove the now-redundant separate `searchHandlers` declaration further
down — see Task 6 for the full rewrite of `index.ts`.)

For each `createHandlers(adapter, new WriteMutex())` call site in
`tests/tools/vault/module.test.ts`, change to
`createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter))`.
At the top of the test file, the existing import of `createSearchHandlers`
is already in place — confirmed at line 6.

- [ ] **Step 5: Run the dispatcher test and confirm it passes**

Run:
`npx vitest run tests/tools/vault/module.test.ts -t "vault_get_aspect dispatcher" --reporter=verbose`

Expected: PASS for both new tests (`routes each aspect…` and `propagates
"File not found"…`).

- [ ] **Step 6: Run the full test suite to confirm no regression in the call-site updates**

Run: `npm test`
Expected: PASS. The two assertions that count vault tools at exactly 22
(`module.test.ts:16-21` and `module.test.ts:37-65`) still pass because the
old six tool registrations have not yet been removed.

---

## Task 5: Add the `getAspectOutputSchema` discriminated union

**Files:**

- Modify: `src/tools/vault/index.ts:85-148` (replace the six per-tool
  output schemas)

- [ ] **Step 1: Locate the six per-tool output schemas**

Run: `grep -n "Output schemas for the \`vault_get_\*\`\|getFrontmatterOutputSchema\|getHeadingsOutputSchema\|getOutgoingLinksOutputSchema\|getEmbedsOutputSchema\|getBacklinksOutputSchema\|getBlockReferencesOutputSchema" src/tools/vault/index.ts`

Expected: matches around lines 79–148.

- [ ] **Step 2: Replace those schemas with a single discriminated union**

In `src/tools/vault/index.ts`, replace the entire block from the comment
that begins:

```ts
/**
 * Output schemas for the `vault_get_*` single-path getters. These tools were
 * renamed from `search_get_*` by #255 and use search handlers, but they live
…
```

through the closing `};` of `getBlockReferencesOutputSchema`, with:

```ts
/**
 * Output schema for `vault_get_aspect` (#294). The tool replaces six
 * structurally-identical `vault_get_*` getters with one tool that takes a
 * required `aspect` enum, so the output schema is a discriminated union
 * over the six aspects. Each variant mirrors the corresponding former
 * per-tool shape 1:1, plus an `aspect` literal as the discriminator.
 */
const getAspectOutputSchema = z.discriminatedUnion('aspect', [
  z.object({
    aspect: z.literal('frontmatter'),
    path: z.string().describe('Vault-relative path that was inspected.'),
    frontmatter: z
      .record(z.string(), z.unknown())
      .describe('Parsed YAML frontmatter object, or {} when absent.'),
  }),
  z.object({
    aspect: z.literal('headings'),
    path: z.string().describe('Vault-relative path that was inspected.'),
    headings: z
      .array(
        z.object({
          heading: z.string().describe('Heading text.'),
          level: z.number().describe('Heading level (1..6).'),
        }),
      )
      .describe('Headings in document order.'),
  }),
  z.object({
    aspect: z.literal('outgoing_links'),
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
  }),
  z.object({
    aspect: z.literal('embeds'),
    path: z.string().describe('Vault-relative path that was inspected.'),
    embeds: z
      .array(
        z.object({
          link: z.string().describe('Embed target.'),
          displayText: z.string().optional().describe('Optional alias.'),
        }),
      )
      .describe('Embeds (![[...]]) referenced by this file.'),
  }),
  z.object({
    aspect: z.literal('backlinks'),
    path: z.string().describe('Target path that was queried.'),
    backlinks: z
      .array(z.string())
      .describe('Vault-relative paths of files that link TO the target.'),
  }),
  z.object({
    aspect: z.literal('block_references'),
    path: z.string().describe('Vault-relative path that was inspected.'),
    blockRefs: z
      .array(
        z.object({
          id: z
            .string()
            .describe('Block-reference id (without the leading ^).'),
          line: z
            .string()
            .describe('The line of text the block-reference is on.'),
        }),
      )
      .describe('Block references defined in this file.'),
  }),
]);
```

- [ ] **Step 3: Confirm typecheck still passes**

Run: `npm run typecheck`

Expected: PASS for the file under edit. The bare-shape constants
`getFrontmatterOutputSchema`, `getHeadingsOutputSchema`,
`getOutgoingLinksOutputSchema`, `getEmbedsOutputSchema`,
`getBacklinksOutputSchema`, `getBlockReferencesOutputSchema` no longer
exist; their references on lines 485, 499, 513, 527, 541, 555 will fail
typecheck. **That is expected** — Task 6 removes those references in the
same edit pass. If you ran `typecheck` between Task 5 and Task 6 you will
see those errors. Treat them as a checklist: every error you see is a
registration you must delete in Task 6.

---

## Task 6: Replace six tool registrations with one `vault_get_aspect`

**Files:**

- Modify: `src/tools/vault/index.ts` — registration block + imports

- [ ] **Step 1: Add `getAspectSchema` to the imports from `./schemas`**

In `src/tools/vault/index.ts`, the existing import block from `./schemas`
spans lines 8–25. Add `getAspectSchema` to that import list, alphabetised
or appended to the end (project's existing import is unsorted — appending
is fine):

```ts
import {
  createFileSchema,
  readFileSchema,
  // …existing entries…
  writeBinarySchema,
  getAspectSchema,
} from './schemas';
```

- [ ] **Step 2: Remove the now-unused `searchFilePathSchema` import**

The import at line 6 (`import { filePathSchema as searchFilePathSchema } from '../search/schemas';`)
is only used by the six tools being removed. Delete that import line.

- [ ] **Step 3: Update `createVaultModule` to wire the new dispatcher**

Replace the body of `createVaultModule` at the top (lines 168–171) from:

```ts
export function createVaultModule(adapter: ObsidianAdapter): ToolModule {
  const mutex = new WriteMutex();
  const handlers = createHandlers(adapter, mutex);
  const searchHandlers = createSearchHandlers(adapter);
```

to:

```ts
export function createVaultModule(adapter: ObsidianAdapter): ToolModule {
  const mutex = new WriteMutex();
  const searchHandlers = createSearchHandlers(adapter);
  const handlers = createHandlers(adapter, mutex, searchHandlers);
```

The local `searchHandlers` variable stays declared but is no longer
referenced anywhere inside `tools()` after the next step. Keep it where
shown — it's now consumed by `createHandlers`.

- [ ] **Step 4: Replace the six `defineTool({ name: 'vault_get_*' })` blocks with one**

In `src/tools/vault/index.ts`, locate the six blocks starting at line
475 (`name: 'vault_get_frontmatter'`) and ending at line 558 (the closing
`}),` after `vault_get_block_references`). Delete all six blocks and
replace with this single block:

```ts
        defineTool({
          name: 'vault_get_aspect',
          title: 'Get file aspect',
          description: describeTool({
            summary:
              'Get one metadata aspect of a file: frontmatter, headings, ' +
              'outgoing links, embeds, backlinks, or block references.',
            args: [
              'path (string): Vault-relative path to the file.',
              'aspect (enum): Which aspect to return. See the enum description ' +
                'for the shape returned by each value.',
            ],
            returns:
              'JSON: a discriminated union keyed on `aspect`. ' +
              'frontmatter → { path, aspect: "frontmatter", frontmatter }. ' +
              'headings → { path, aspect: "headings", headings: [{heading, level}] }. ' +
              'outgoing_links → { path, aspect: "outgoing_links", links: [{link, displayText?}] }. ' +
              'embeds → { path, aspect: "embeds", embeds: [{link, displayText?}] }. ' +
              'backlinks → { path, aspect: "backlinks", backlinks: string[] }. ' +
              'block_references → { path, aspect: "block_references", blockRefs: [{id, line}] }.',
            examples: [
              'Use when: "list the headings in README.md" → { path: "README.md", aspect: "headings" }.',
              'Use when: "what links to this note?" → { path: "ideas.md", aspect: "backlinks" }.',
            ],
            errors: ['"File not found" if the path does not exist.'],
          }, getAspectSchema),
          schema: getAspectSchema,
          outputSchema: getAspectOutputSchema,
          handler: handlers.getAspect,
          annotations: annotations.read,
        }),
```

- [ ] **Step 5: Verify the file compiles end-to-end**

Run: `npm run typecheck`

Expected: PASS. All six previously-erroring references to
`getFrontmatterOutputSchema` etc. and `searchFilePathSchema` are gone.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: PASS.

---

## Task 7: Update module-level tests for the new tool surface

**Files:**

- Modify: `tests/tools/vault/module.test.ts`

- [ ] **Step 1: Update the tool-count assertion**

In `tests/tools/vault/module.test.ts` lines 16–21, change `22` to `17`:

```ts
  it('should register 17 tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const tools = module.tools();
    expect(tools).toHaveLength(17);
  });
```

- [ ] **Step 2: Update the read-only / write tool counts**

The six removed tools were all read-only. The new tool is read-only.
So read-only count: `11 - 6 + 1 = 6`. Write count is unchanged at `11`.

In `tests/tools/vault/module.test.ts` lines 23–35, change:

```ts
  it('should have 11 read-only tools', () => {
    …
    expect(readOnlyTools).toHaveLength(11);
  });

  it('should have 11 write tools', () => {
    …
    expect(writeTools).toHaveLength(11);
  });
```

to:

```ts
  it('should have 6 read-only tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const readOnlyTools = module.tools().filter((t) => t.annotations.readOnlyHint);
    expect(readOnlyTools).toHaveLength(6);
  });

  it('should have 11 write tools', () => {
    const adapter = new MockObsidianAdapter();
    const module = createVaultModule(adapter);
    const writeTools = module.tools().filter((t) => !t.annotations.readOnlyHint);
    expect(writeTools).toHaveLength(11);
  });
```

- [ ] **Step 3: Update the tool-name list**

In `tests/tools/vault/module.test.ts` lines 41–64, replace the list with
the 17-entry version (note alphabetical order, `vault_get_aspect` slots
between `vault_delete_folder` and `vault_get_metadata`):

```ts
    expect(names).toEqual([
      'vault_append',
      'vault_copy',
      'vault_create',
      'vault_create_folder',
      'vault_delete',
      'vault_delete_folder',
      'vault_get_aspect',
      'vault_get_metadata',
      'vault_list',
      'vault_list_recursive',
      'vault_move',
      'vault_read',
      'vault_read_binary',
      'vault_rename',
      'vault_rename_folder',
      'vault_update',
      'vault_write_binary',
    ]);
```

- [ ] **Step 4: Update the `getStructured()` helper to handle Zod schemas**

In `tests/tools/vault/module.test.ts` lines 79–86, replace:

```ts
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }
```

with:

```ts
  function getStructured(tool: {
    outputSchema?: z.ZodRawShape | z.ZodTypeAny;
  }): z.ZodTypeAny {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    // Raw shape (Record<string, ZodTypeAny>) → wrap in z.object().strict().
    // Full Zod schema (e.g. z.discriminatedUnion) → return as-is.
    if (tool.outputSchema instanceof z.ZodType) {
      return tool.outputSchema;
    }
    return z.object(tool.outputSchema).strict();
  }
```

- [ ] **Step 5: Replace the six per-aspect outputSchema tests with one parametrized test**

In `tests/tools/vault/module.test.ts`, locate the six `it(...)` blocks
that begin at line 232 (`vault_get_frontmatter declares outputSchema...`)
and end at the close of the `vault_get_block_references` block around
line 354. Delete all six tests. Replace with:

```ts
  it('vault_get_aspect declares a discriminated outputSchema and parses each variant', async () => {
    const tool = findTool('vault_get_aspect');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'A line ^anchor\n');
    adapter.setMetadata('a.md', {
      frontmatter: { status: 'done', tags: ['x'] },
      headings: [
        { heading: 'Top', level: 1 },
        { heading: 'Sub', level: 2 },
      ],
      links: [{ link: 'b', displayText: 'Bee' }, { link: 'c' }],
      embeds: [{ link: 'image.png' }],
    });
    adapter.addFile('b.md', '');
    adapter.setMetadata('b.md', { links: [{ link: 'a' }] });

    const searchHandlers = createSearchHandlers(adapter);
    const handlers = createHandlers(adapter, new WriteMutex(), searchHandlers);

    const cases = [
      {
        aspect: 'frontmatter' as const,
        expected: { aspect: 'frontmatter', path: 'a.md', frontmatter: { status: 'done', tags: ['x'] } },
      },
      {
        aspect: 'headings' as const,
        expected: {
          aspect: 'headings',
          path: 'a.md',
          headings: [
            { heading: 'Top', level: 1 },
            { heading: 'Sub', level: 2 },
          ],
        },
      },
      {
        aspect: 'outgoing_links' as const,
        expected: {
          aspect: 'outgoing_links',
          path: 'a.md',
          links: [{ link: 'b', displayText: 'Bee' }, { link: 'c' }],
        },
      },
      {
        aspect: 'embeds' as const,
        expected: { aspect: 'embeds', path: 'a.md', embeds: [{ link: 'image.png' }] },
      },
      {
        aspect: 'backlinks' as const,
        expected: { aspect: 'backlinks', path: 'a.md', backlinks: ['b.md'] },
      },
      {
        aspect: 'block_references' as const,
        expected: {
          aspect: 'block_references',
          path: 'a.md',
          blockRefs: [{ id: 'anchor', line: 'A line ^anchor' }],
        },
      },
    ];

    for (const { aspect, expected } of cases) {
      const result = await handlers.getAspect({
        path: 'a.md',
        aspect,
        response_format: 'json',
      });
      const parsed = schema.parse(result.structuredContent);
      expect(parsed).toEqual(expected);
    }
  });
```

- [ ] **Step 6: Run the full vault module test file**

Run: `npx vitest run tests/tools/vault/module.test.ts --reporter=verbose`

Expected: PASS. All renamed/replaced tests pass; the dispatcher tests
from Task 4 still pass; the count assertions reflect the new tool count
(17).

---

## Task 8: Update `SERVER_INSTRUCTIONS` in the MCP server

**Files:**

- Modify: `src/server/mcp-server.ts:27`

- [ ] **Step 1: Read the current SERVER_INSTRUCTIONS bullet**

Run: `grep -n -A 1 "Frontmatter, headings, links" src/server/mcp-server.ts`

Expected output:

```
27:- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate `vault_get_*` tools — don't parse them out of `vault_read` output.`;
```

- [ ] **Step 2: Replace the bullet to reference `vault_get_aspect`**

Edit `src/server/mcp-server.ts`. Replace:

```
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate `vault_get_*` tools — don't parse them out of `vault_read` output.
```

with:

```
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed via the `vault_get_aspect` tool (call it with the matching `aspect` enum value) — don't parse them out of `vault_read` output.
```

- [ ] **Step 3: Run server-instruction-related tests if any exist**

Run: `grep -rln "SERVER_INSTRUCTIONS\|vault_get_\*" tests/ --include="*.ts"`

If any tests assert against the old text, update them to match the new
text. Re-run the affected file with vitest.

If no tests match, continue.

---

## Task 9: Update the `find-related` prompt and its test

**Files:**

- Modify: `src/server/prompts.ts:71`
- Modify: `tests/server/prompts.test.ts:79,92`

- [ ] **Step 1: Read the current prompt body**

Run: `grep -n -B 2 -A 2 "vault_get_backlinks" src/server/prompts.ts`

Expected: a multi-line template literal at line 71 that mentions
`vault_get_backlinks`.

- [ ] **Step 2: Update the prompt to mention `vault_get_aspect` with `aspect: "backlinks"`**

Edit `src/server/prompts.ts`. Replace the substring:

```
\`vault_get_backlinks\` on its path
```

with:

```
\`vault_get_aspect\` with \`aspect: "backlinks"\` on its path
```

(Preserve the surrounding template literal unchanged.)

- [ ] **Step 3: Update the failing test assertion**

Edit `tests/server/prompts.test.ts`. Replace the test name on line 79
and the assertion on line 92:

```ts
  it('returns a single user-role text message naming search_fulltext and vault_get_backlinks', async () => {
```

→

```ts
  it('returns a single user-role text message naming search_fulltext and vault_get_aspect', async () => {
```

and:

```ts
    expect(text).toContain('vault_get_backlinks');
```

→

```ts
    expect(text).toContain('vault_get_aspect');
    expect(text).toContain('backlinks');
```

(Two assertions: the new tool name AND the aspect value, since the
information density is now split across the tool name and arg.)

- [ ] **Step 4: Run the prompts test**

Run: `npx vitest run tests/server/prompts.test.ts --reporter=verbose`

Expected: PASS. All assertions in `prompts.test.ts` pass with the new
prompt text.

---

## Task 10: Run full quality checks

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS, no errors.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS. All vault, search, server, prompts, integration, and
registry tests green. Snapshot of expected failure modes if a test fails
here:

- "vault module … should register 17 tools" failing → re-check Task 6
  removed all six old `defineTool` blocks and added the new one.
- "find-related" prompt test failing → re-check Task 9 updated both the
  source file and the test together.
- Any `vault_get_*` reference left in compiled output → run
  `grep -rn 'vault_get_frontmatter\|vault_get_headings\|vault_get_outgoing_links\|vault_get_embeds\|vault_get_backlinks\|vault_get_block_references' src/ tests/ --include="*.ts"`
  and finish removing the orphan.

If anything fails, fix it inline before proceeding.

---

## Task 11: Regenerate `docs/tools.generated.md`

**Files:**

- Modify: `docs/tools.generated.md` (overwritten by the script)

- [ ] **Step 1: Regenerate**

Run: `npm run docs:tools`

Expected: success. The script overwrites `docs/tools.generated.md` with
the current registry snapshot.

- [ ] **Step 2: Verify the diff**

Run: `git diff docs/tools.generated.md`

Expected diff:

- Vault module count: `22 → 17`.
- Vault tool list loses `vault_get_frontmatter`, `vault_get_headings`,
  `vault_get_outgoing_links`, `vault_get_embeds`, `vault_get_backlinks`,
  `vault_get_block_references`; gains `vault_get_aspect`.
- Total: `54 tools across 8 modules → 49 tools across 8 modules`.

If the diff shows anything else, debug before continuing.

- [ ] **Step 3: Run the docs check that runs in CI**

Run: `npm run docs:check`
Expected: PASS (the regenerated file matches itself).

---

## Task 12: Update `docs/help/en.md`

**Files:**

- Modify: `docs/help/en.md` (three sites)

- [ ] **Step 1: Update the quoted SERVER_INSTRUCTIONS bullet**

In `docs/help/en.md`, find the quoted bullet that mirrors line 27 of
`src/server/mcp-server.ts`:

```
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate `vault_get_*` tools — don't parse them out of `vault_read` output.
```

Replace with the same text used in Task 8:

```
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed via the `vault_get_aspect` tool (call it with the matching `aspect` enum value) — don't parse them out of `vault_read` output.
```

- [ ] **Step 2: Update the `find-related` description**

Find the line that begins:

```
- **`find-related`** — argument: `path` (vault-relative). Asks Claude to read the seed note, then cross-reference it with `search_fulltext` and `vault_get_backlinks` and report the most relevant connections.
```

Replace with:

```
- **`find-related`** — argument: `path` (vault-relative). Asks Claude to read the seed note, then cross-reference it with `search_fulltext` and `vault_get_aspect` (with `aspect: "backlinks"`) and report the most relevant connections.
```

- [ ] **Step 3: Add a "Breaking changes in this release" subsection**

Find an appropriate location near the top of the document (e.g. after the
"What this plugin does" section, or — if a previous breaking-changes
section already exists — append to it). The text to add:

```markdown
## Breaking changes in this release

The six single-aspect getters have been collapsed into one tool. If your
LLM client or scripts hard-code the old names, update calls as follows:

| Old call | New call |
|---|---|
| `vault_get_frontmatter({ path })` | `vault_get_aspect({ path, aspect: "frontmatter" })` |
| `vault_get_headings({ path })` | `vault_get_aspect({ path, aspect: "headings" })` |
| `vault_get_outgoing_links({ path })` | `vault_get_aspect({ path, aspect: "outgoing_links" })` |
| `vault_get_embeds({ path })` | `vault_get_aspect({ path, aspect: "embeds" })` |
| `vault_get_backlinks({ path })` | `vault_get_aspect({ path, aspect: "backlinks" })` |
| `vault_get_block_references({ path })` | `vault_get_aspect({ path, aspect: "block_references" })` |
```

- [ ] **Step 4: If there are sibling locale help files (e.g. `docs/help/de.md`),
       apply the same three updates there**

Run: `ls docs/help/`

If `de.md` (or any other locale file) exists, repeat steps 1–3 there with
translated headings/text. If only `en.md` exists, skip.

(At time of writing, only `en.md` is in scope; verify before assuming.)

---

## Task 13: Update the title catalogue spec

**Files:**

- Modify: `docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`

This is a previous design doc that snapshotted the title catalogue. Since
it lists every tool by name, it must reflect the new surface to keep the
docs consistent with the code.

- [ ] **Step 1: Update the vault title table**

The original spec lists tools in **code registration order** (the order
they appear in `src/tools/vault/index.ts`), not alphabetical order. The
six removed tools were registered at the end (last six entries). Their
replacement `vault_get_aspect` sits at that same end position in the
updated `index.ts`, so the new table also keeps it last.

Find the `### vault (22)` heading and the table beneath it. Change the
heading to `### vault (17)`. Delete the six rows for `vault_get_frontmatter`,
`vault_get_headings`, `vault_get_outgoing_links`, `vault_get_embeds`,
`vault_get_backlinks`, `vault_get_block_references` and append one row:

```markdown
| `vault_get_aspect` | Get file aspect |
```

The full updated vault block should read:

```markdown
### vault (17)

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
| `vault_get_aspect` | Get file aspect |
```

- [ ] **Step 2: Strike the deferred cross-ref triple**

In the same file, find the "Deferred (follow-up issues filed after this
PR lands)" subsection. Remove the line:

```
- `vault_get_outgoing_links` / `vault_get_embeds` / `vault_get_backlinks`
```

The other deferred entries (editor_set_*, template_*, …) stay.

- [ ] **Step 3: Update the "Title catalogue (54 tools)" section header**

Change `## Title catalogue (54 tools)` to `## Title catalogue (49 tools)`.

---

## Task 14: Final quality check and commit the refactor

**Files:** none (verification + commit).

- [ ] **Step 1: Sanity-grep for orphan references to old tool names**

Run:

```bash
grep -rn "vault_get_frontmatter\|vault_get_headings\|vault_get_outgoing_links\|vault_get_embeds\|vault_get_backlinks\|vault_get_block_references" \
  src/ tests/ docs/ --include="*.ts" --include="*.md" \
  | grep -v "docs/superpowers/specs/2026-05-03-collapse-vault-get-aspect-design.md" \
  | grep -v "docs/superpowers/plans/2026-05-03-collapse-vault-get-aspect.md" \
  | grep -v "docs/superpowers/plans/2026-05-03-mcp-prompts-slash-commands.md" \
  | grep -v "docs/superpowers/plans/258-phase5-breaking-bundle.md" \
  | grep -v "docs/superpowers/plans/276-output-schema-search.md" \
  | grep -v "docs/superpowers/specs/2026-05-02-output-schema-batches-bcd-design.md" \
  | grep -v "docs/superpowers/specs/2026-05-03-mcp-prompts-slash-commands-design.md" \
  | grep -v "docs/help/en.md"
```

Expected: empty output. The greps that survive are:

- The new spec/plan files (intentional — they document this change).
- Pre-existing plan/spec files that pre-date this change (they record
  history; do not edit).
- `docs/help/en.md` — contains the breaking-change migration table (and
  its old-name → new-name mappings), which is intentional.

Any other match means an orphan reference. Track it down and update it.

- [ ] **Step 2: Final lint + typecheck + test pass**

Run, in this order:

```bash
npm run lint
npm run typecheck
npm test
npm run docs:check
```

Expected: all four PASS. If any fail, fix inline and re-run.

- [ ] **Step 3: Inspect the working tree**

Run: `git status --short`

Expected files modified (M) or staged:

- `src/tools/vault/schemas.ts`
- `src/tools/vault/handlers.ts`
- `src/tools/vault/index.ts`
- `src/server/mcp-server.ts`
- `src/server/prompts.ts`
- `tests/tools/vault/module.test.ts`
- `tests/server/prompts.test.ts`
- `docs/tools.generated.md`
- `docs/help/en.md`
- `docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`

Any other file shown is a leftover from a previous step that should be
investigated before committing.

- [ ] **Step 4: Stage and commit the refactor**

Run:

```bash
git add \
  src/tools/vault/schemas.ts \
  src/tools/vault/handlers.ts \
  src/tools/vault/index.ts \
  src/server/mcp-server.ts \
  src/server/prompts.ts \
  tests/tools/vault/module.test.ts \
  tests/server/prompts.test.ts \
  docs/tools.generated.md \
  docs/help/en.md \
  docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md

git commit -m "$(cat <<'EOF'
refactor(tools/vault)!: collapse 6 vault_get_* tools into vault_get_aspect

Replaces six structurally-identical single-path getters with one tool
that takes a required `aspect` enum. The six former tools all shared the
`{ path }` input shape and routed through the same `searchHandlers.search*`
handler family; the new tool dispatches to the same handlers and merges
an `aspect` literal into `structuredContent` for the discriminated union
output.

Per-aspect documentation that used to live in six separate tool
descriptions now lives on the enum's `.describe()`, so Claude reads it
on every tool-list refresh.

The `find-related` prompt and the server-instructions string are updated
to reference `vault_get_aspect` instead of the removed tools.

Total tool count: 54 → 49 across 8 modules.

BREAKING CHANGE: removed vault_get_frontmatter, vault_get_headings,
  vault_get_outgoing_links, vault_get_embeds, vault_get_backlinks,
  vault_get_block_references. Replaced by vault_get_aspect with an
  `aspect` enum arg accepting "frontmatter", "headings", "outgoing_links",
  "embeds", "backlinks", or "block_references". Migrate by passing the
  matching aspect value to the new tool.

Refs #294
EOF
)"
```

- [ ] **Step 5: Verify the commit landed and the working tree is clean**

Run, separately:

```bash
git log --oneline -3
git status
```

Expected: three commits visible (spec doc, registry widening, refactor),
working tree clean.

---

## Task 15: Push the branch and open the PR

**Files:** none (forge interactions).

- [ ] **Step 1: Push the branch**

Run: `git push -u origin refactor/issue-294-collapse-vault-get-aspect`

Expected: branch pushed, upstream tracking set.

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create \
  --title "refactor(tools/vault)!: collapse 6 vault_get_* tools into vault_get_aspect" \
  --body "$(cat <<'EOF'
Closes #294

## Summary

- Replaces six structurally-identical `vault_get_*` getters with one
  `vault_get_aspect` tool that takes a required `aspect` enum.
- Output is a Zod discriminated union over six variants; each variant
  mirrors a former per-tool shape 1:1, plus an `aspect` literal.
- The MCP server's `SERVER_INSTRUCTIONS` and the `find-related` prompt
  are updated to reference the new tool.
- Tool count drops from 54 to 49 across 8 modules.

## Migration

| Old call | New call |
|---|---|
| `vault_get_frontmatter({ path })` | `vault_get_aspect({ path, aspect: "frontmatter" })` |
| `vault_get_headings({ path })` | `vault_get_aspect({ path, aspect: "headings" })` |
| `vault_get_outgoing_links({ path })` | `vault_get_aspect({ path, aspect: "outgoing_links" })` |
| `vault_get_embeds({ path })` | `vault_get_aspect({ path, aspect: "embeds" })` |
| `vault_get_backlinks({ path })` | `vault_get_aspect({ path, aspect: "backlinks" })` |
| `vault_get_block_references({ path })` | `vault_get_aspect({ path, aspect: "block_references" })` |

## Test plan

- [x] `npm run lint` passes
- [x] `npm run typecheck` passes
- [x] `npm test` passes — including the new parametrized
  `vault_get_aspect declares a discriminated outputSchema and parses
  each variant` test in `tests/tools/vault/module.test.ts`, the new
  dispatcher tests, and the updated `find-related` prompt assertion in
  `tests/server/prompts.test.ts`.
- [x] `npm run docs:check` passes — `docs/tools.generated.md` regenerated
  to reflect the 22 → 17 vault tool count and 54 → 49 total.
EOF
)"
```

Expected: PR URL in stdout. Print it back to the user.

- [ ] **Step 3: Stop. Wait for the user to merge.**

Per project rule: never merge a PR yourself. Surface the PR URL and
hand off.

---

## Self-Review Notes

This plan was self-reviewed against the spec at
[`docs/superpowers/specs/2026-05-03-collapse-vault-get-aspect-design.md`](../specs/2026-05-03-collapse-vault-get-aspect-design.md):

**Spec coverage:**

- ✅ Collapse all 6 tools (Option A) — Tasks 5, 6, 7.
- ✅ Required single-value `aspect` enum (decision 2a) — Task 3
  schema; Task 6 registration; Task 7 tests cover all six values.
- ✅ Hard cut, no aliases (decision 3a) — Task 6 deletes all six old
  registrations; Task 14's grep guarantees no orphan references.
- ✅ Discriminated-union output schema — Task 5 implements; Task 7
  parses runtime payloads against it.
- ✅ Registry compatibility (recommended option 1: widen the slot) —
  Task 1; the SDK's `OutputArgs extends ZodRawShapeCompat | AnySchema`
  acceptance was confirmed in `node_modules/@modelcontextprotocol/sdk/
  dist/esm/server/mcp.d.ts` before writing this plan, so option 1 is
  known-good and the spec's "fall back to option 2" path does not need
  to fire.
- ✅ Handler relocation out of scope — none of the tasks touch
  `src/tools/search/handlers.ts`.
- ✅ Test plan — Tasks 4, 7, 9 cover dispatcher, parametrized aspect
  output, and prompt updates.
- ✅ `docs/tools.generated.md` regeneration — Task 11.
- ✅ `docs/help/en.md` updates including migration table — Task 12.
- ✅ Title catalogue spec update — Task 13.
- ✅ Breaking-change paperwork (commit, PR, branch name) — Tasks 14
  and 15.

**Placeholder scan:** no TBD/TODO/"add appropriate" patterns; every step
shows the actual code to write or the actual command to run.

**Type consistency check:**

- `getAspectSchema` is referenced consistently in Tasks 3, 4, 6, 7.
- `getAspectOutputSchema` is referenced consistently in Tasks 5, 6.
- `dispatchAspect` / `decorateAspect` helper names match between their
  definition (Task 4 step 3f) and their call site (Task 4 step 3e).
- `createHandlers` signature change (Task 4 step 3d) is propagated to
  every call site (Task 4 step 4).
- The 6-aspect enum order is identical everywhere it appears
  (`frontmatter, headings, outgoing_links, embeds, backlinks,
  block_references`).
