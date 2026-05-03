# Issue #278 — `outputSchema` declarations for Batch D (extras + plugin-interop + templates + `vault_read_binary` retrofit)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #278 by (1) retrofitting `vault_read_binary` to emit `structuredContent` and declaring its `outputSchema`, and (2) declaring `outputSchema` on the eight remaining read tools across the `extras`, `plugin-interop`, and `templates` modules. Strict-mode Zod parse tests pin every shape against the matching handler output.

**Architecture:** Two commits. The first retrofits the binary handler from `textResult(base64)` to `makeResponse({ path, data, encoding: 'base64', size_bytes }, (v) => v.data, format)` so it joins the structured-content surface alongside its `outputSchema` declaration; existing plain-text callers are unaffected because the rendered text remains the bare base64 string. The second commit is purely declarative — eight `outputSchema` consts wired to existing handlers in three modules. No framework changes; PR #279 already added the optional field to `ToolDefinition`.

**Tech Stack:** TypeScript, Zod, Vitest, MCP SDK (`@modelcontextprotocol/sdk`).

**Refs:** [Design](../specs/2026-05-02-output-schema-batches-bcd-design.md), #248 / PR #279 (framework + Batch A), #276 / PR #286 (Batch B), #277 / PR #287 (Batch C), #258 (campaign tracker).

---

## Phase 0 — Branch and baseline

### Task 1: Create branch and capture baseline

**Files:** none modified yet.

- [ ] **Step 1: Verify the working tree is clean and on `main` at the latest tip**

Run: `git status && git log --oneline -1`
Expected: `working tree clean`. The latest commit subject should mention the merged Batch C PR (`feat(tools/workspace,editor): declare outputSchema for read tools (#287)` or similar).

- [ ] **Step 2: Create the feature branch from `main`**

Run:
```bash
git fetch origin
git checkout -b feat/issue-278-output-schema-extras-interop-templates-binary origin/main
```

Expected: switches to a fresh branch off the latest `origin/main`.

- [ ] **Step 3: Run the baseline test suite to confirm green starting point**

Run: `npm test`
Expected: 615 / 615 tests passing (the count after Batch C merged). Capture for later comparison.

- [ ] **Step 4: Run lint and typecheck baseline**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

---

## Phase 1 — `vault_read_binary` retrofit

The locked design decision (Option A) is to restructure `vault_read_binary`'s response so it emits both a structured payload and the existing plain-text base64 string. Verified against the current code:

- Handler at [`src/tools/vault/handlers.ts:367-381`](../../../src/tools/vault/handlers.ts#L367-L381) currently does `return textResult(base64)` — no `structuredContent`.
- Schema at [`src/tools/vault/schemas.ts:128-130`](../../../src/tools/vault/schemas.ts#L128-L130) currently does NOT include `responseFormatField`. Must be added so the JSON path is reachable.
- The pre-existing test at [`tests/tools/vault/module.test.ts:194-201`](../../../tests/tools/vault/module.test.ts#L194-L201) explicitly asserts `outputSchema` is undefined. Must be flipped to a positive parse test.

### Task 2: Flip the `vault_read_binary` test to a failing positive parse test

**Files:**
- Modify: `tests/tools/vault/module.test.ts:194-201` — replace the "intentionally omits outputSchema" assertion with two new `it(...)` blocks.

- [ ] **Step 1: Replace the existing assertion**

Find this block (currently lines 194-201 of the file):

```ts
  it('vault_read_binary intentionally omits outputSchema (no structuredContent emitted)', () => {
    const tool = findTool('vault_read_binary');
    // Deferred to Batch D. Asserting the absence pins the deviation
    // documented in docs/superpowers/plans/248-output-schema.md so a
    // future change cannot silently add one without re-checking that the
    // handler also emits a matching structuredContent slot.
    expect(tool.outputSchema).toBeUndefined();
  });
```

Replace it with these two blocks:

```ts
  it('vault_read_binary declares outputSchema and structuredContent parses against it', async () => {
    const tool = findTool('vault_read_binary');
    const schema = getStructured(tool);

    const adapter = new MockObsidianAdapter();
    adapter.addFile('img.png', '');
    await adapter.writeBinary('img.png', new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const handlers = createHandlers(adapter, new WriteMutex());

    const result = await handlers.readBinary({
      path: 'img.png',
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed).toEqual({
      path: 'img.png',
      data: '/9j/',
      encoding: 'base64',
      size_bytes: 3,
    });
  });

  it('vault_read_binary plain-text rendering still returns the bare base64 string', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('img.png', '');
    await adapter.writeBinary('img.png', new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const handlers = createHandlers(adapter, new WriteMutex());

    // Default response_format ('markdown'); no callsite churn for existing
    // callers — the rendered text remains the bare base64 string.
    const result = await handlers.readBinary({ path: 'img.png' });
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type === 'text') {
      expect(result.content[0].text).toBe('/9j/');
    }
  });
```

- [ ] **Step 2: Run the two new tests and confirm they fail**

Run: `npx vitest run tests/tools/vault/module.test.ts -t "vault_read_binary"`
Expected: both new tests fail. The first fails with `Error: expected outputSchema to be declared`. The second fails because the existing handler emits the bare base64 string (so it actually PASSES the second assertion as written) — but the first test's failure should be the focus. Re-running after Tasks 3-4 should make both pass.

Note: the second test (plain-text path) will actually pass against the un-retrofitted handler too, because the un-retrofitted handler also returns `textResult(base64)`. That's fine — its purpose is to pin the no-callsite-churn promise *after* the retrofit, so the assertion stays green throughout the change.

- [ ] **Step 3: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean. (No new imports needed — `createHandlers`, `WriteMutex`, `MockObsidianAdapter` are already imported by the file.)

### Task 3: Retrofit the handler, update the schema, and wire `outputSchema`

**Files:**
- Modify: `src/tools/vault/handlers.ts:367-381` — change `readBinary` to use `makeResponse(...)`.
- Modify: `src/tools/vault/schemas.ts:128-130` — add `responseFormatField` to `readBinarySchema`.
- Modify: `src/tools/vault/index.ts` — add a new `outputSchema` const and wire it; update the tool description's "Returns" line.

- [ ] **Step 1: Add `responseFormatField` to `readBinarySchema`**

Edit `src/tools/vault/schemas.ts` to change:

```ts
export const readBinarySchema = {
  path,
};
```

into:

```ts
export const readBinarySchema = {
  path,
  ...responseFormatField,
};
```

- [ ] **Step 2: Retrofit the `readBinary` handler**

Edit `src/tools/vault/handlers.ts` to change the handler body (currently lines 367-381):

```ts
    async readBinary(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const data = await adapter.readBinary(path);
        if (data.byteLength > BINARY_BYTE_LIMIT) {
          return errorResult(
            `Binary file too large (${String(data.byteLength)} bytes, limit ${String(BINARY_BYTE_LIMIT)}). Fetch the file out-of-band or use a chunked read when available.`,
          );
        }
        const base64 = Buffer.from(data).toString('base64');
        return textResult(base64);
      } catch (error) {
        return handleToolError(error);
      }
    },
```

into:

```ts
    async readBinary(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const data = await adapter.readBinary(path);
        if (data.byteLength > BINARY_BYTE_LIMIT) {
          return errorResult(
            `Binary file too large (${String(data.byteLength)} bytes, limit ${String(BINARY_BYTE_LIMIT)}). Fetch the file out-of-band or use a chunked read when available.`,
          );
        }
        const base64 = Buffer.from(data).toString('base64');
        return makeResponse(
          {
            path,
            data: base64,
            encoding: 'base64' as const,
            size_bytes: data.byteLength,
          },
          (v) => v.data,
          readResponseFormat(params),
        );
      } catch (error) {
        return handleToolError(error);
      }
    },
```

The plain-text rendering `(v) => v.data` returns the bare base64 string, preserving the existing `result.content[0].text` contract for callers that don't pass `response_format: 'json'`.

- [ ] **Step 3: Verify imports are in place in `handlers.ts`**

The retrofitted handler uses `makeResponse` and `readResponseFormat` from `../shared/response`. Other vault handlers in this same file already use both helpers, so the imports are present. Verify by grepping:

Run: `grep "makeResponse\|readResponseFormat" src/tools/vault/handlers.ts | head -5`
Expected: at least one import line and several handler-body usages. If `makeResponse` or `readResponseFormat` is missing from the import list at the top of the file, add it to the existing `from '../shared/response'` import.

- [ ] **Step 4: Add the `vault_read_binary` outputSchema const in `src/tools/vault/index.ts`**

Insert this block after the existing `getBlockReferencesOutputSchema` const (Batch B added that one; the new const lands at the end of the output-schema section, immediately before `export function createVaultModule(...)`):

```ts
/**
 * Output schema for `vault_read_binary` (Batch D of #248). The handler now
 * emits `structuredContent: { path, data, encoding: 'base64', size_bytes }`
 * alongside the plain-text base64 string so modern clients can introspect
 * the typed payload while existing `result.content[0].text` callers see no
 * change.
 */
const readBinaryOutputSchema = {
  path: z.string().describe('Vault-relative path that was read.'),
  data: z.string().describe('Base64-encoded file contents (no data: prefix).'),
  encoding: z
    .literal('base64')
    .describe('Encoding of the `data` field — always `"base64"` for this tool.'),
  size_bytes: z
    .number()
    .describe('Decoded file size in bytes (length of the underlying binary).'),
};
```

- [ ] **Step 5: Wire `outputSchema:` on the `vault_read_binary` `defineTool` block**

Find the existing `defineTool({...})` block for `vault_read_binary` in `src/tools/vault/index.ts` (currently around lines 329-344). Update the description's "Returns" line and add the `outputSchema:` field after `schema:`. Replace:

```ts
        defineTool({
          name: 'vault_read_binary',
          description: describeTool({
            summary: 'Read binary file contents as base64.',
            args: ['path (string): Vault-relative path to the file.'],
            returns: 'Plain text: the base64 string. Refuses files over 1 MiB.',
            examples: ['Use when: embedding an image referenced from a note.'],
            errors: [
              '"File not found" if path does not exist.',
              '"Binary file too large" if the file exceeds 1 MiB.',
            ],
          }),
          schema: readBinarySchema,
          handler: handlers.readBinary,
          annotations: annotations.read,
        }),
```

with:

```ts
        defineTool({
          name: 'vault_read_binary',
          description: describeTool({
            summary: 'Read binary file contents as base64.',
            args: ['path (string): Vault-relative path to the file.'],
            returns:
              'Plain text: the base64 string (default). With response_format=json: { path, data, encoding, size_bytes }. Refuses files over 1 MiB.',
            examples: ['Use when: embedding an image referenced from a note.'],
            errors: [
              '"File not found" if path does not exist.',
              '"Binary file too large" if the file exceeds 1 MiB.',
            ],
          }, readBinarySchema),
          schema: readBinarySchema,
          outputSchema: readBinaryOutputSchema,
          handler: handlers.readBinary,
          annotations: annotations.read,
        }),
```

Two edits in this block:
1. The "Returns" line gains the `response_format=json` shape and lists the four fields.
2. `describeTool(...)` now takes a second argument (`readBinarySchema`) so the description renders the inherited `response_format` arg automatically (matches how `vault_read` and `vault_get_metadata` are declared at lines 134 and 196 of the same file).
3. `outputSchema: readBinaryOutputSchema` is added after `schema:`.

- [ ] **Step 6: Run the vault outputSchema tests and confirm they pass**

Run: `npx vitest run tests/tools/vault/module.test.ts -t "vault read tools — outputSchema declarations"`
Expected: all tests in the describe block pass — the 11 from Batch A+B plus the two new `vault_read_binary` cases (positive parse + plain-text path).

- [ ] **Step 7: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 4: Commit the binary retrofit

- [ ] **Step 1: Stage and commit**

Run:
```bash
git add src/tools/vault/handlers.ts src/tools/vault/schemas.ts \
        src/tools/vault/index.ts tests/tools/vault/module.test.ts
git commit -m "$(cat <<'EOF'
feat(tools/vault): structuredContent for vault_read_binary

Retrofit vault_read_binary to emit structuredContent
{ path, data, encoding: 'base64', size_bytes } via makeResponse, and
declare a matching outputSchema. Plain-text rendering remains the bare
base64 string so existing result.content[0].text callers see no change;
modern MCP clients with response_format=json get the typed payload.

readBinarySchema now spreads responseFormatField so the JSON path is
reachable, and the tool description's "Returns" line documents both
shapes.

Refs #278
Refs #258
EOF
)"
```

Expected: commit succeeds.

---

## Phase 2 — Declarative additions in `extras`, `plugin-interop`, `templates`

Three modules, eight tools, all declarative — no handler changes. Verified against the handlers:

- `extras_get_date` — emits `{ iso }` (string) — [`src/tools/extras/index.ts:46-56`](../../../src/tools/extras/index.ts#L46-L56).
- `plugin_list` — emits `{ plugins: Array<{ id, name, enabled }> }` — [`src/tools/plugin-interop/index.ts:91-108`](../../../src/tools/plugin-interop/index.ts#L91-L108).
- `plugin_check` — emits `{ pluginId, installed, enabled }` — same file, lines 109-121.
- `plugin_dataview_query` — emits `{ query, markdown }` — same file, lines 122-146.
- `plugin_dataview_describe_js_query` — emits `{ query, note }` — same file, lines 147-162.
- `plugin_templater_describe_template` — emits `{ templatePath, note }` — same file, lines 163-178.
- `template_list` — emits `{ files: string[] }` — [`src/tools/templates/index.ts:83-106`](../../../src/tools/templates/index.ts#L83-L106).
- `template_expand` — emits `{ expanded: string }` — same file, lines 120-131.

### Task 5: Write the failing parse-validation tests for `extras`

**Files:**
- Modify: `tests/tools/extras/extras.test.ts` (append a new top-level `describe` block).

- [ ] **Step 1: Add the `z` import at the top of the file (if not already present)**

Inspect the current imports and add `import { z } from 'zod';` if missing:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createExtrasModule } from '../../../src/tools/extras/index';
```

(The existing file may also import `CallToolResult` and a `getText` helper; leave those untouched.)

- [ ] **Step 2: Append the new top-level describe block at the end of the file**

```ts
/**
 * Batch D of #248: every extras read tool that emits `structuredContent`
 * must declare an `outputSchema`. Strict-mode parsing catches drift between
 * the markdown renderer and the structured payload.
 */
describe('extras read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }

  it('extras_get_date declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createExtrasModule(adapter).tools().find((t) => t.name === 'extras_get_date')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(typeof parsed.iso).toBe('string');
    // Spot-check the ISO-8601 format with timezone offset (e.g. "2026-04-19T08:30:00.000+02:00")
    expect(parsed.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });
});
```

- [ ] **Step 3: Run the new test and confirm it fails**

Run: `npx vitest run tests/tools/extras/extras.test.ts -t "extras read tools — outputSchema declarations"`
Expected: the test fails with `Error: expected outputSchema to be declared`.

- [ ] **Step 4: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 6: Add `outputSchema` const and wire it (`extras`)

**Files:**
- Modify: `src/tools/extras/index.ts`

- [ ] **Step 1: Verify `z` is already imported**

`src/tools/extras/index.ts` does not currently import `zod`. Add this line at the top:

```ts
import { z } from 'zod';
```

- [ ] **Step 2: Add the `outputSchema` const immediately AFTER `getDateSchema` (currently line 17) and BEFORE `interface ExtrasHandlers` (currently line 19)**

Insert this block:

```ts
/**
 * Output schema for the `extras_get_date` tool that emits `structuredContent`
 * (Batch D of #248).
 */
const getDateOutputSchema = {
  iso: z
    .string()
    .describe(
      'Local datetime as an ISO-8601 string with timezone offset, e.g. "2026-04-19T08:30:00.000+02:00".',
    ),
};
```

- [ ] **Step 3: Wire the schema to the `defineTool` call**

Find the `extras_get_date` `defineTool({...})` block (currently lines 72-82) and add `outputSchema:` after `schema:`:

```ts
        defineTool({
          name: 'extras_get_date',
          description: describeTool({
            summary: 'Get the current local datetime as an ISO-8601 string with timezone offset.',
            returns: 'Plain text: e.g. "2026-04-19T08:30:00.000+02:00".',
            examples: ['Use when: stamping a daily note with the current local time.'],
          }, getDateSchema),
          schema: getDateSchema,
          outputSchema: getDateOutputSchema,
          handler: h.getDate,
          annotations: annotations.read,
        }),
```

- [ ] **Step 4: Run the extras outputSchema test and confirm it passes**

Run: `npx vitest run tests/tools/extras/extras.test.ts -t "extras read tools — outputSchema declarations"`
Expected: the new test passes; existing extras tests still pass.

- [ ] **Step 5: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 7: Write the failing parse-validation tests for `plugin-interop`

**Files:**
- Modify: `tests/tools/plugin-interop/plugin-interop.test.ts` (append a new top-level `describe` block).

- [ ] **Step 1: Add the `z` import at the top of the file (if not already present)**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createPluginInteropModule } from '../../../src/tools/plugin-interop/index';
```

(Leave any pre-existing imports — `CallToolResult`, helpers, etc. — untouched.)

- [ ] **Step 2: Append the new top-level describe block at the end of the file**

```ts
/**
 * Batch D of #248: every plugin-interop read tool that emits
 * `structuredContent` must declare an `outputSchema`. Strict-mode parsing
 * catches drift between the markdown renderer and the structured payload.
 */
describe('plugin-interop read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }

  it('plugin_list declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.addInstalledPlugin('templater', 'Templater', false);
    const tool = createPluginInteropModule(adapter).tools().find((t) => t.name === 'plugin_list')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.plugins).toEqual([
      { id: 'dataview', name: 'Dataview', enabled: true },
      { id: 'templater', name: 'Templater', enabled: false },
    ]);
  });

  it('plugin_check declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    const tool = createPluginInteropModule(adapter).tools().find((t) => t.name === 'plugin_check')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ pluginId: 'dataview', response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed).toEqual({ pluginId: 'dataview', installed: true, enabled: true });
  });

  it('plugin_dataview_query declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.setDataviewApi({
      queryMarkdown: () =>
        Promise.resolve({ successful: true, value: '| col |\n| --- |\n| x |' }),
    });
    const tool = createPluginInteropModule(adapter).tools().find((t) => t.name === 'plugin_dataview_query')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ query: 'TABLE col FROM ""', response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.query).toBe('TABLE col FROM ""');
    expect(parsed.markdown).toBe('| col |\n| --- |\n| x |');
  });

  it('plugin_dataview_describe_js_query declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createPluginInteropModule(adapter).tools().find((t) => t.name === 'plugin_dataview_describe_js_query')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ query: 'dv.pages()', response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.query).toBe('dv.pages()');
    expect(typeof parsed.note).toBe('string');
  });

  it('plugin_templater_describe_template declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createPluginInteropModule(adapter).tools().find((t) => t.name === 'plugin_templater_describe_template')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ templatePath: 'templates/daily.md', response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.templatePath).toBe('templates/daily.md');
    expect(typeof parsed.note).toBe('string');
  });
});
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run: `npx vitest run tests/tools/plugin-interop/plugin-interop.test.ts -t "plugin-interop read tools — outputSchema declarations"`
Expected: every `it(...)` in the new block fails with `Error: expected outputSchema to be declared`.

- [ ] **Step 4: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 8: Add `outputSchema` consts and wire them (`plugin-interop`)

**Files:**
- Modify: `src/tools/plugin-interop/index.ts`

- [ ] **Step 1: Verify `z` is already imported (it is — line 1)**

No new import needed.

- [ ] **Step 2: Add five `outputSchema` consts immediately AFTER `executeCommandSchema` (currently lines 65-71) and BEFORE `interface PluginInteropHandlers` (currently line 73)**

Insert this block:

```ts
/**
 * Output schemas for the plugin-interop read tools that emit
 * `structuredContent` (Batch D of #248). Each shape mirrors what the
 * corresponding handler in this file puts on `result.structuredContent`.
 */
const pluginListOutputSchema = {
  plugins: z
    .array(
      z.object({
        id: z.string().describe('Plugin id (e.g. "dataview").'),
        name: z.string().describe('Human-readable plugin name.'),
        enabled: z.boolean().describe('Whether the plugin is currently enabled.'),
      }),
    )
    .describe('All installed community plugins.'),
};

const pluginCheckOutputSchema = {
  pluginId: z.string().describe('Plugin id that was queried.'),
  installed: z.boolean().describe('Whether the plugin is installed in this vault.'),
  enabled: z.boolean().describe('Whether the plugin is enabled (false when not installed).'),
};

const pluginDataviewQueryOutputSchema = {
  query: z.string().describe('Dataview DQL query that was executed.'),
  markdown: z.string().describe('Markdown rendering produced by Dataview.'),
};

const pluginDescribeOutputSchema = {
  query: z.string().describe('Dataview-JS source that was passed in.'),
  note: z.string().describe('Note explaining that this server does not execute the source.'),
};

const pluginTemplaterDescribeOutputSchema = {
  templatePath: z.string().describe('Vault-relative Templater template path that was queried.'),
  note: z.string().describe('Note explaining that this server does not execute the template.'),
};
```

- [ ] **Step 3: Wire each schema to its `defineTool` call**

Modify the five plugin-interop read-only `defineTool({...})` blocks by adding an `outputSchema:` field directly after the existing `schema:` field. Five edits in file order:

For `plugin_list`:
```ts
schema: listSchema,
outputSchema: pluginListOutputSchema,
handler: h.listPlugins,
```

For `plugin_check`:
```ts
schema: checkSchema,
outputSchema: pluginCheckOutputSchema,
handler: h.checkPlugin,
```

For `plugin_dataview_query`:
```ts
schema: dataviewSchema,
outputSchema: pluginDataviewQueryOutputSchema,
handler: h.dataviewQuery,
```

For `plugin_dataview_describe_js_query`:
```ts
schema: dataviewJsSchema,
outputSchema: pluginDescribeOutputSchema,
handler: h.dataviewDescribeJsQuery,
```

For `plugin_templater_describe_template`:
```ts
schema: templaterSchema,
outputSchema: pluginTemplaterDescribeOutputSchema,
handler: h.templaterDescribeTemplate,
```

- [ ] **Step 4: Run the plugin-interop outputSchema tests and confirm they pass**

Run: `npx vitest run tests/tools/plugin-interop/plugin-interop.test.ts -t "plugin-interop read tools — outputSchema declarations"`
Expected: all 5 new tests pass; existing plugin-interop tests still pass.

- [ ] **Step 5: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 9: Write the failing parse-validation tests for `templates`

**Files:**
- Modify: `tests/tools/templates/templates.test.ts` (append a new top-level `describe` block).

- [ ] **Step 1: Add the `z` import at the top of the file (if not already present)**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createTemplatesModule } from '../../../src/tools/templates/index';
```

- [ ] **Step 2: Append the new top-level describe block at the end of the file**

```ts
/**
 * Batch D of #248: every templates read tool that emits `structuredContent`
 * must declare an `outputSchema`. Strict-mode parsing catches drift between
 * the markdown renderer and the structured payload.
 */
describe('templates read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    return z.object(tool.outputSchema).strict();
  }

  it('template_list declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/daily.md', '# {{title}}');
    adapter.addFile('templates/meeting.md', '# Meeting on {{date}}');
    const tool = createTemplatesModule(adapter).tools().find((t) => t.name === 'template_list')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.files).toEqual(expect.arrayContaining(['daily.md', 'meeting.md']));
  });

  it('template_list parses cleanly when templates folder is missing', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createTemplatesModule(adapter).tools().find((t) => t.name === 'template_list')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.files).toEqual([]);
  });

  it('template_expand declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createTemplatesModule(adapter).tools().find((t) => t.name === 'template_expand')!;
    const schema = getStructured(tool);

    const result = await tool.handler({
      template: 'Hello, {{name}}!',
      variables: { name: 'World' },
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.expanded).toBe('Hello, World!');
  });
});
```

- [ ] **Step 3: Run the new tests and confirm they fail**

Run: `npx vitest run tests/tools/templates/templates.test.ts -t "templates read tools — outputSchema declarations"`
Expected: every `it(...)` in the new block fails with `Error: expected outputSchema to be declared`.

- [ ] **Step 4: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 10: Add `outputSchema` consts and wire them (`templates`)

**Files:**
- Modify: `src/tools/templates/index.ts`

- [ ] **Step 1: Verify `z` is already imported (it is — line 1)**

No new import needed.

- [ ] **Step 2: Add two `outputSchema` consts immediately AFTER `expandVariablesSchema` (currently lines 60-69) and BEFORE `interface TemplatesHandlers` (currently line 72)**

Insert this block:

```ts
/**
 * Output schemas for the templates read tools that emit `structuredContent`
 * (Batch D of #248).
 */
const templateListOutputSchema = {
  files: z
    .array(z.string())
    .describe('Vault-relative paths of files in the "templates" folder. Empty when the folder is missing.'),
};

const templateExpandOutputSchema = {
  expanded: z
    .string()
    .describe('Template text with all {{variable}} placeholders substituted.'),
};
```

- [ ] **Step 3: Wire each schema to its `defineTool` call**

Modify the two read-only template `defineTool({...})` blocks by adding an `outputSchema:` field directly after the existing `schema:` field. Two edits in file order:

For `template_list`:
```ts
schema: listTemplatesSchema,
outputSchema: templateListOutputSchema,
handler: h.listTemplates,
```

For `template_expand`:
```ts
schema: expandVariablesSchema,
outputSchema: templateExpandOutputSchema,
handler: h.expandVariables,
```

- [ ] **Step 4: Run the templates outputSchema tests and confirm they pass**

Run: `npx vitest run tests/tools/templates/templates.test.ts -t "templates read tools — outputSchema declarations"`
Expected: all 3 new tests pass; existing templates tests still pass.

- [ ] **Step 5: Run lint and typecheck**

Run:
```bash
npm run lint
npm run typecheck
```

Expected: both clean.

### Task 11: Commit the declarative additions

- [ ] **Step 1: Stage and commit (single commit covers all three modules)**

Run:
```bash
git add src/tools/extras/index.ts src/tools/plugin-interop/index.ts \
        src/tools/templates/index.ts \
        tests/tools/extras/extras.test.ts \
        tests/tools/plugin-interop/plugin-interop.test.ts \
        tests/tools/templates/templates.test.ts
git commit -m "$(cat <<'EOF'
feat(tools/extras,plugin-interop,templates): declare outputSchema for read tools

Declare outputSchema on the eight remaining read tools that emit
structuredContent: extras_get_date; plugin_list, plugin_check,
plugin_dataview_query, plugin_dataview_describe_js_query,
plugin_templater_describe_template; template_list, template_expand.

The three plugin describe-only stubs and template_expand are not named
in the issue but emit structuredContent today, so they are picked up
under the issue's "plus any other read-only entries" clause.

Refs #278
Refs #258
EOF
)"
```

Expected: commit succeeds.

---

## Phase 3 — Verification gate, docs, push, PR

### Task 12: Regenerate `docs/tools.generated.md` and run the full gate

**Files:**
- Possibly modify: `docs/tools.generated.md` (if regeneration produces a diff).

- [ ] **Step 1: Regenerate the tools doc**

Run: `npm run docs:tools`
Expected: the script runs to completion. The current generator only lists tool names, so there should be NO diff for this batch (no tools were added or renamed). Verify with `git status`.

- [ ] **Step 2: If `git status` shows a diff for `docs/tools.generated.md`, commit it**

If there's a diff (unexpected), inspect first:
```bash
git diff docs/tools.generated.md
```

If the diff is purely from regeneration, commit:
```bash
git add docs/tools.generated.md
git commit -m "$(cat <<'EOF'
docs(tools): regenerate tools.generated.md after Batch D

Refs #278
EOF
)"
```

If there's no diff, skip this step.

- [ ] **Step 3: Run the full verification gate**

Run each command separately (per CLAUDE.md rule 15):
```bash
npm test
```

Expected: 625 / 625 passing. Math: 615 baseline + 11 added − 1 removed = 625. The 11 added break down as: 2 new vault_read_binary tests (positive parse + plain-text path) + 1 extras + 5 plugin-interop + 3 templates. The 1 removed is the old "intentionally omits outputSchema" assertion. All green.

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
- `npm test` failing on a vault test — re-check the binary handler retrofit (the structuredContent shape must match the schema exactly).
- `npm test` failing on a plugin-interop test — verify `MockObsidianAdapter.setDataviewApi(...)` accepts the test's stub. If the stub signature is wrong, fix the test.
- `npm run lint` failing — most likely an unused outputSchema const if a wiring step missed one of the eight tools.
- `npm run typecheck` failing — `outputSchema` field type must be `z.ZodRawShape`. Inline `as const` after `'base64'` is required for the literal narrowing.
- `npm run docs:check` failing — re-run `npm run docs:tools` and commit any diff.

### Task 13: Push and open the PR

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/issue-278-output-schema-extras-interop-templates-binary`
Expected: branch is created on `origin` and tracks the local branch.

- [ ] **Step 2: Open the PR with `gh`**

Run:
```bash
gh pr create --title "feat(tools/extras,plugin-interop,templates,vault): outputSchema for remaining read tools and binary retrofit" --body "$(cat <<'EOF'
Closes #278

## Summary

- Retrofit \`vault_read_binary\` to emit \`structuredContent: { path, data, encoding: 'base64', size_bytes }\` (locked Option A from the design). Plain-text rendering remains the bare base64 string so existing callers see no change; modern MCP clients with \`response_format=json\` get the typed payload alongside an \`outputSchema\` declaration.
- Declare \`outputSchema\` on the eight remaining read tools that emit \`structuredContent\` across three modules:
  - **extras**: \`extras_get_date\`.
  - **plugin-interop**: \`plugin_list\`, \`plugin_check\`, \`plugin_dataview_query\`, \`plugin_dataview_describe_js_query\`, \`plugin_templater_describe_template\`.
  - **templates**: \`template_list\`, \`template_expand\`.

This closes the campaign — every read tool that emits \`structuredContent\` across the project now declares a matching \`outputSchema\`.

## \`vault_read_binary\` retrofit decision

The issue offered two options for \`vault_read_binary\`:

1. Restructure the payload to emit \`structuredContent\` and declare an \`outputSchema\`.
2. Leave it as plain text and document the absence.

This PR ships **Option 1** (the locked design choice). Rationale: the four-field payload mirrors what \`vault_get_metadata\` declares, gives clients the size + encoding for free, and existing \`result.content[0].text\` callers see no change because the rendered text remains the bare base64 string.

## Scope addition note

\`plugin_dataview_describe_js_query\`, \`plugin_templater_describe_template\`, and \`template_expand\` are not named explicitly in the issue but emit \`structuredContent\` today. They're picked up under the issue's "plus any other read-only entries" clause so the campaign closes the rubric gap fully.

## Test plan

- [x] \`npm test\` — 625 / 625 passing (was 615 after Batch C; +11 new tests, −1 removed "intentionally omits" assertion = +10 net). The 11 added cover all 9 in-scope tools, with a positive parse + plain-text-fallback pair for \`vault_read_binary\` and a missing-folder fallback for \`template_list\`.
- [x] \`npm run lint\` — clean.
- [x] \`npm run typecheck\` — clean.
- [x] \`npm run docs:check\` — clean (no diff: the generator only lists tool names, no new tools or renames in this PR).

## Refs

- Builds on #248 / PR #279 (framework + Batch A), #276 / PR #286 (Batch B), and #277 / PR #287 (Batch C).
- Tracker: #258.
- This is the final PR in the four-batch campaign for #248.
EOF
)"
```

Expected: PR is created on GitHub and `gh` prints the URL.

- [ ] **Step 3: Print the PR URL**

Run: `gh pr view --json url -q .url`
Expected: the URL is printed for the user to open. Stop here and wait for review/merge — this is the last PR in the campaign.

---

## Self-review checklist (run after writing this plan)

This section is for the plan author. Check before handing off:

- **Spec coverage.** Each item in the design's PR-3 scope has a task:
  - `vault_read_binary` retrofit (handler + schema + index + test flip) → Tasks 2, 3
  - 1 extras schema → Task 6 step 2
  - 5 plugin-interop schemas → Task 8 step 2
  - 2 templates schemas → Task 10 step 2
  - 1 extras test → Task 5 step 2
  - 5 plugin-interop tests → Task 7 step 2
  - 3 templates tests (template_list happy path + missing-folder fallback + template_expand) → Task 9 step 2
  - vault `vault_read_binary` test flip + plain-text-pin → Task 2 step 1
  - `docs/tools.generated.md` regen → Task 12 step 1
  - Two-commit structure (binary retrofit, then declarative additions) → Tasks 4 and 11
  - Full gate → Task 12 step 3
  - PR body documenting the retrofit decision and scope addition → Task 13 step 2
- **No placeholders.** Every code step contains the actual code; every command step contains the actual command. No "TBD"/"TODO"/"add appropriate error handling".
- **Type consistency.** `outputSchema` field name and Zod raw-shape pattern match the precedent set by PR #279, PR #286, and PR #287. The retrofit uses `encoding: 'base64' as const` so TypeScript narrows to `z.literal('base64')`-compatible.
- **Docs note.** No `docs/help/en.md` update is required: the help doc only carries module-level summaries (no per-tool entries), and the existing line "binary I/O" still accurately describes `vault_read_binary`.

## Out of scope (campaign now closes)

- Framework changes (`src/registry/types.ts`, `src/server/mcp-server.ts`) — already shipped in #279.
- Write/destructive tools — they emit confirmation lines; `outputSchema` is low-value (covered by #216's exclusion list and locked into the original #248 scope).
- Anything outside the read-tool surface that emits `structuredContent`.
