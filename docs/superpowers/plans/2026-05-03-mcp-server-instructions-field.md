# McpServer instructions field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set the `instructions` field on the `McpServer` constructor with vault-aware tool-use hints, so MCP clients can lift them into Claude's session-long system prompt.

**Architecture:** Introduce an exported `SERVER_INSTRUCTIONS` constant at the top of [`src/server/mcp-server.ts`](../../../src/server/mcp-server.ts) and forward it as the `instructions` option in the existing `new McpServer(...)` call inside `createMcpServer`. Lock the wiring with one test and the content shape (non-empty, length budget, mentions of load-bearing tool names) with another. Document the field in a new "For developers / MCP client builders" section of [`docs/help/en.md`](../../help/en.md).

**Tech Stack:** TypeScript, vitest, `@modelcontextprotocol/sdk` v1.x, existing project gates (`npm run lint`, `npm run typecheck`, `npm test`).

**Spec:** [`docs/superpowers/specs/2026-05-03-mcp-server-instructions-field-design.md`](../specs/2026-05-03-mcp-server-instructions-field-design.md)

**Issue:** [#290](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/290)

**Branch:** `feat/issue-290-mcp-server-instructions` (already created and checked out; spec already committed there).

---

## Pre-flight

- [ ] **Step 0.1: Confirm branch and clean tree**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean except possibly the plan file you are about to add; current branch `feat/issue-290-mcp-server-instructions`.

- [ ] **Step 0.2: Confirm baseline test suite is green before changes**

```bash
npm test
```

Expected: full vitest suite passes. If anything is already red, stop and surface it — do not start work on top of a broken baseline (project workflow §4: "Run `npm test` **before** making changes to confirm the baseline is green").

---

### Task 1: Add `SERVER_INSTRUCTIONS`, wire it into `createMcpServer`, and lock both wiring and content shape with tests

**Files:**
- Modify: `src/server/mcp-server.ts` — add exported `SERVER_INSTRUCTIONS` constant and pass it as the `instructions` option to `new McpServer(...)` (current call at lines 14–27).
- Modify: `tests/server/mcp-server.test.ts` — extend the existing `vi.mock(...)` capture to record `options.instructions`; add a new wiring `it` block inside the existing `describe('createMcpServer', …)`; add a new top-level `describe('SERVER_INSTRUCTIONS', …)` block with content-shape assertions.

This task ships everything load-bearing for the feature in one logical commit (project rule 24 — one commit per logical concern; the wiring and the artifact that the wiring forwards are the same concern).

- [ ] **Step 1.1: Extend the test mock to capture `instructions`**

In [`tests/server/mcp-server.test.ts`](tests/server/mcp-server.test.ts), update the `CapturedOptions` interface (around line 15) to include the `instructions` field:

```ts
interface CapturedOptions {
  capabilities?: { tools?: unknown };
  instructions?: string;
}
```

The `vi.mock` body itself does not need changes — it already pushes the entire `options` object into `capturedConstructorArgs` via `capturedConstructorArgs.push({ serverInfo, options })`. The interface widening is the only thing required for type-safe access in new tests.

- [ ] **Step 1.2: Add the failing wiring test**

Inside the existing `describe('createMcpServer', …)` block in [`tests/server/mcp-server.test.ts`](tests/server/mcp-server.test.ts), add a new `it` block (place it after the existing "declares tool capabilities on the server" test):

```ts
  it('forwards SERVER_INSTRUCTIONS to the McpServer constructor as the instructions option', async () => {
    const mod = await import('../../src/server/mcp-server');
    const { createMcpServer, SERVER_INSTRUCTIONS } = mod;
    const registry = new ModuleRegistry(makeLogger());

    createMcpServer(registry, makeLogger());

    expect(capturedConstructorArgs).toHaveLength(1);
    expect(capturedConstructorArgs[0].options.instructions).toBe(
      SERVER_INSTRUCTIONS,
    );
  });
```

- [ ] **Step 1.3: Run the wiring test, verify it fails (TS error or runtime miss)**

```bash
npx vitest run tests/server/mcp-server.test.ts -t "forwards SERVER_INSTRUCTIONS"
```

Expected: failure. The most likely error is a TypeScript / runtime miss because `SERVER_INSTRUCTIONS` is not exported from `src/server/mcp-server.ts` yet — vitest reports "SERVER_INSTRUCTIONS" as `undefined` (or the import as missing). That is the red half of the cycle.

- [ ] **Step 1.4: Add `SERVER_INSTRUCTIONS` and wire it into the constructor**

Edit [`src/server/mcp-server.ts`](src/server/mcp-server.ts) — insert the constant between the `import manifest …` line (currently line 8) and the `export function createMcpServer(...)` declaration (currently line 10):

```ts
/**
 * Tool-use hints injected into Claude's session-long system prompt via the
 * MCP protocol-level `instructions` field. These tokens are paid every turn,
 * so the string is intentionally short and limited to hints that the per-tool
 * descriptions cannot convey on their own. See
 * docs/superpowers/specs/2026-05-03-mcp-server-instructions-field-design.md.
 */
export const SERVER_INSTRUCTIONS = `This server exposes an Obsidian vault as MCP tools.

- Prefer \`search_fulltext\` (or other \`search_*\` tools) before \`vault_read\` when you don't already know the file path.
- \`editor_*\` tools operate on the **active** file only — open one with \`workspace_open_file\` first if needed.
- Paths are vault-relative with forward slashes (e.g. \`notes/foo.md\`); never absolute filesystem paths.
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate \`vault_get_*\` tools — don't parse them out of \`vault_read\` output.`;
```

Then update the `new McpServer(...)` call (currently at lines 14–27) to pass the constant. Replace the existing options object so the call reads:

```ts
  const server = new McpServer(
    {
      // {service}-mcp-server naming convention for the MCP protocol
      // handshake. This is internal to the protocol and intentionally
      // distinct from the npm package name and Obsidian plugin id.
      name: 'obsidian-mcp-server',
      version: manifest.version,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );
```

(The only line added inside the second-position object is `instructions: SERVER_INSTRUCTIONS,`.)

- [ ] **Step 1.5: Run the wiring test, verify it passes**

```bash
npx vitest run tests/server/mcp-server.test.ts -t "forwards SERVER_INSTRUCTIONS"
```

Expected: PASS.

- [ ] **Step 1.6: Add the content-shape tests**

Append a new top-level `describe` block at the end of [`tests/server/mcp-server.test.ts`](tests/server/mcp-server.test.ts) (after the existing `describe('createToolDispatcher', …)` block):

```ts
describe('SERVER_INSTRUCTIONS', () => {
  it('is a non-empty string', async () => {
    const { SERVER_INSTRUCTIONS } = await import(
      '../../src/server/mcp-server'
    );
    expect(typeof SERVER_INSTRUCTIONS).toBe('string');
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it('stays within the 800-character budget (paid every turn)', async () => {
    const { SERVER_INSTRUCTIONS } = await import(
      '../../src/server/mcp-server'
    );
    // Hard cap so we notice if the string drifts toward bloat. Current
    // length is ~560 chars, well below the cap.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(800);
  });

  it.each([
    ['search_fulltext'],
    ['vault_read'],
    ['editor_'],
    ['workspace_open_file'],
    ['vault_get_'],
  ])(
    'mentions the load-bearing tool name "%s"',
    async (token: string) => {
      const { SERVER_INSTRUCTIONS } = await import(
        '../../src/server/mcp-server'
      );
      expect(SERVER_INSTRUCTIONS).toContain(token);
    },
  );
});
```

- [ ] **Step 1.7: Run the full file's tests, verify everything passes**

```bash
npx vitest run tests/server/mcp-server.test.ts
```

Expected: all tests in this file pass — the existing 3 `createMcpServer` tests, the new wiring test, the existing 4 `createToolDispatcher` tests, the new 2 single content-shape tests, and the 5 parameterised `it.each` tool-name tests.

- [ ] **Step 1.8: Run the full test suite to ensure nothing else regressed**

```bash
npm test
```

Expected: full suite green. If a snapshot or unrelated test references `mcp-server.ts`'s shape, surface it and stop — do not paper over a regression.

- [ ] **Step 1.9: Commit**

```bash
git add src/server/mcp-server.ts tests/server/mcp-server.test.ts
git commit -m "feat(server/mcp): set instructions field with vault-aware tool-use hints

Adds SERVER_INSTRUCTIONS — a four-bullet hint block prefixed by a
single frame sentence — and forwards it through the McpServer
constructor's options bag. MCP clients lift this into the model's
session system prompt so tool-selection hints (search-before-read,
editor-needs-active-file, vault-relative paths, vault_get_* per
category) persist across every turn without per-tool repetition.

Wiring test pins forwarding; content-shape tests pin a non-empty
string under an 800-char budget and presence of every load-bearing
tool name in the menu.

Refs #290"
```

---

### Task 2: Document the field in `docs/help/en.md`

**Files:**
- Modify: `docs/help/en.md` — insert a new `## For developers / MCP client builders` section between the `### Status bar` subsection and the `## FAQ` heading (the FAQ heading is currently at line 250 of the file).

- [ ] **Step 2.1: Verify the insertion point**

```bash
grep -n "^## FAQ\|^### Status bar" docs/help/en.md
```

Expected output (line numbers may vary slightly if other doc edits land first):

```
240:### Status bar
250:## FAQ
```

The new section goes between these two — i.e. just after the Status bar bullet list ends and just before the `## FAQ` heading. The existing `---` horizontal rule that currently sits above `## FAQ` (line ~248) can be reused as the separator below the new section.

- [ ] **Step 2.2: Insert the new section**

In [`docs/help/en.md`](docs/help/en.md), locate the existing block:

```markdown
- After a failed start (most commonly because the configured port is already
  in use), the status bar shows `MCP :<port>` with a strike-through in the
  error color. Hover to see the exact error. The indicator stays until the
  next successful start, an explicit stop, or a port change.

---

## FAQ
```

Replace it with:

```markdown
- After a failed start (most commonly because the configured port is already
  in use), the status bar shows `MCP :<port>` with a strike-through in the
  error color. Hover to see the exact error. The indicator stays until the
  next successful start, an explicit stop, or a port change.

---

## For developers / MCP client builders

The MCP server advertises a short set of tool-use hints in the protocol-level
`instructions` field of the `initialize` response. MCP clients (Claude
Desktop, Claude Code, etc.) typically lift this string into the model's
system prompt for the session, so the hints persist across every turn
without being repeated in each tool description.

The current text:

```
This server exposes an Obsidian vault as MCP tools.

- Prefer `search_fulltext` (or other `search_*` tools) before `vault_read` when you don't already know the file path.
- `editor_*` tools operate on the **active** file only — open one with `workspace_open_file` first if needed.
- Paths are vault-relative with forward slashes (e.g. `notes/foo.md`); never absolute filesystem paths.
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate `vault_get_*` tools — don't parse them out of `vault_read` output.
```

Source of truth: [`src/server/mcp-server.ts`](https://github.com/KingOfKalk/obsidian-plugin-mcp/blob/main/src/server/mcp-server.ts)
(`SERVER_INSTRUCTIONS`). If you suspect drift between the quoted text above
and the live string, the source file wins.

---

## FAQ
```

(Note: the inner code fence around the `SERVER_INSTRUCTIONS` quote uses standard ` ``` ` triple-backticks. There is no outer fence — the section is plain Markdown, so nesting is not an issue.)

- [ ] **Step 2.3: Eyeball the rendered Markdown**

```bash
sed -n '240,290p' docs/help/en.md
```

Expected: the Status bar bullet, the `---`, the new `## For developers / MCP client builders` section, the second `---`, and `## FAQ`. The quoted instructions block should be inside a single fenced ` ``` ` block. If the fences look mis-paired, fix in place before committing.

- [ ] **Step 2.4: Commit**

```bash
git add docs/help/en.md
git commit -m "docs(help): document the MCP instructions field for client builders

Adds a 'For developers / MCP client builders' section between the
status-bar UI surface and the FAQ. Quotes the current
SERVER_INSTRUCTIONS verbatim and points at src/server/mcp-server.ts
as the source of truth so a stale quote here is recoverable.

Refs #290"
```

---

### Task 3: Final gate, push, open PR

- [ ] **Step 3.1: Run lint**

```bash
npm run lint
```

Expected: clean. If any rule fires on the new constant or tests, fix before continuing (project rule: "Always run `npm run lint` before committing and fix all errors").

- [ ] **Step 3.2: Run typecheck**

```bash
npm run typecheck
```

Expected: clean. The widened `CapturedOptions` interface and the new `SERVER_INSTRUCTIONS` export are the only type-surface changes; both are straightforward.

- [ ] **Step 3.3: Run the full test suite**

```bash
npm test
```

Expected: full suite green.

- [ ] **Step 3.4: Verify the commit log**

```bash
git log --oneline -n 3
```

Expected (top-to-bottom): the docs commit, the feat commit, the spec commit. Three commits on this branch on top of `main`.

- [ ] **Step 3.5: Push the branch**

```bash
git push -u origin feat/issue-290-mcp-server-instructions
```

Expected: branch published; CI starts.

- [ ] **Step 3.6: Open the PR**

```bash
gh pr create --title "feat(server/mcp): set instructions field with vault-aware tool-use hints" --body "$(cat <<'EOF'
Closes #290

## Summary

- Adds `SERVER_INSTRUCTIONS` and wires it through the `McpServer` constructor's `instructions` option, so MCP clients lift the four tool-use hints into Claude's session-long system prompt.
- Pins the wiring with a unit test and the artifact shape with content tests (non-empty, ≤ 800 chars, mentions every load-bearing tool name).
- Adds a "For developers / MCP client builders" section to `docs/help/en.md` quoting the current text and pointing at the source.

Design: [`docs/superpowers/specs/2026-05-03-mcp-server-instructions-field-design.md`](docs/superpowers/specs/2026-05-03-mcp-server-instructions-field-design.md)

## Test plan

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — full suite green, including new wiring + content-shape tests
EOF
)"
```

Expected: PR created and URL printed. Wait for the user to merge — do **not** merge yourself (project workflow §7).

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to a task. Section 3 (the string) → Task 1 step 1.4. Section 4 (source change) → Task 1 step 1.4. Section 5 (tests) → Task 1 steps 1.1, 1.2, 1.6. Section 6 (docs) → Task 2. Section 7 (out of scope) — nothing to implement, by definition. Section 8 (risks) — the 800-char test cap addresses the token-cost risk; the doc-drift risk is acknowledged in the new doc section's "source of truth" pointer.
- **Placeholder scan:** no TBDs, no "implement appropriate X", no "similar to Task N". Every code step shows full code; every command step shows the exact command and expected output.
- **Type consistency:** `SERVER_INSTRUCTIONS` is exported from `src/server/mcp-server.ts` and imported in `tests/server/mcp-server.test.ts` under the same name throughout. `CapturedOptions.instructions?: string` matches the `instructions: SERVER_INSTRUCTIONS` (which is `string`) passed at the call site.
