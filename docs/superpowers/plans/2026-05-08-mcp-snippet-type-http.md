# `type: "http"` in MCP Client Snippet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin's `.mcp.json` snippet (live builder + README example) load correctly in Claude Code by adding `"type": "http"`, and fix the README's missing `/mcp` URL path on the same surface.

**Architecture:** Single source of truth in `src/settings/mcp-config-section.ts::buildMcpConfigJson()`. The README, help docs, and PRD audit note are kept in sync by hand. Regression coverage is added in a new test file that calls `buildMcpConfigJson()` directly and asserts on parsed JSON output.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin SDK.

**Spec:** [docs/superpowers/specs/2026-05-08-mcp-snippet-type-http-design.md](../specs/2026-05-08-mcp-snippet-type-http-design.md)

**Issue:** [#326](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/326)

**Branch:** `fix/issue-326-mcp-snippet-type-http` (already created and checked out — the spec commit is on this branch).

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/settings/mcp-config-section.ts` | modify (1 line) | Insert `type: 'http'` field into the snippet object |
| `tests/mcp-config-section.test.ts` | create | Vitest suite for `buildMcpConfigJson()` covering type/url/headers shapes |
| `README.md` | modify (lines 46–57) | Add `type` field, fix URL to include `/mcp` path |
| `docs/help/en.md` | modify (lines 187–189 area) | Add bullet describing `type: "http"` field |
| `docs/PRD.md` | modify (CR21 line ~152) | Append `2026-05-08` audit-note continuation |

No other files are touched. No new locales. No i18n string changes.

---

## Pre-flight

- [ ] **Step 0a: Confirm working tree state**

Run: `git status`
Expected: On branch `fix/issue-326-mcp-snippet-type-http`, working tree clean (the spec commit already landed; no other untracked or modified files).

- [ ] **Step 0b: Confirm baseline is green**

Run: `npm test`
Expected: All test suites pass. (Capture failure if any — do not proceed past this check until baseline is green.)

Run: `npm run lint`
Expected: clean.

Run: `npm run typecheck`
Expected: clean.

---

## Task 1: Add `type: "http"` to `buildMcpConfigJson()` (TDD)

**Files:**
- Create: `tests/mcp-config-section.test.ts`
- Modify: `src/settings/mcp-config-section.ts:43` (single line)

The function returns a JSON **fragment** (the `"obsidian": { ... }` slice with the outermost `{}` stripped). Each test wraps the fragment back into `{ <fragment> }` and parses with `JSON.parse` to assert against the parsed object.

- [ ] **Step 1.1: Write the failing test file**

Create `tests/mcp-config-section.test.ts` with the full content below.

```ts
import { describe, it, expect } from 'vitest';
import { buildMcpConfigJson } from '../src/settings/mcp-config-section';
import { DEFAULT_SETTINGS } from '../src/types';
import type { McpPluginSettings } from '../src/types';

interface FakePlugin {
  settings: McpPluginSettings;
}

function makePlugin(overrides: Partial<McpPluginSettings> = {}): FakePlugin {
  return {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
  };
}

function parseSnippet(snippet: string): {
  obsidian: { type?: string; url?: string; headers?: Record<string, string> };
} {
  // buildMcpConfigJson returns the inner fragment; wrap it in braces and parse
  return JSON.parse(`{${snippet}}`) as {
    obsidian: { type?: string; url?: string; headers?: Record<string, string> };
  };
}

describe('buildMcpConfigJson', () => {
  it('emits type:"http" with default secure settings (auth on, key set)', () => {
    const plugin = makePlugin({ accessKey: 'secret-key' });
    // Cast: buildMcpConfigJson only reads plugin.settings; FakePlugin is shape-compatible.
    const snippet = buildMcpConfigJson(plugin as unknown as Parameters<typeof buildMcpConfigJson>[0]);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.url).toBe('http://127.0.0.1:28741/mcp');
    expect(parsed.obsidian.headers).toEqual({
      Authorization: 'Bearer secret-key',
    });
  });

  it('keeps type:"http" when HTTPS is enabled (transport type, not URL scheme)', () => {
    const plugin = makePlugin({ accessKey: 'k', httpsEnabled: true });
    const snippet = buildMcpConfigJson(plugin as unknown as Parameters<typeof buildMcpConfigJson>[0]);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.url).toBe('https://127.0.0.1:28741/mcp');
  });

  it('emits type and url but no headers when auth is disabled', () => {
    const plugin = makePlugin({ authEnabled: false, accessKey: 'ignored' });
    const snippet = buildMcpConfigJson(plugin as unknown as Parameters<typeof buildMcpConfigJson>[0]);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.url).toBe('http://127.0.0.1:28741/mcp');
    expect(parsed.obsidian.headers).toBeUndefined();
  });

  it('omits headers when auth is on but access key is empty', () => {
    const plugin = makePlugin({ authEnabled: true, accessKey: '' });
    const snippet = buildMcpConfigJson(plugin as unknown as Parameters<typeof buildMcpConfigJson>[0]);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.type).toBe('http');
    expect(parsed.obsidian.headers).toBeUndefined();
  });

  it('reflects custom address and port in the url', () => {
    const plugin = makePlugin({
      serverAddress: '0.0.0.0',
      port: 9000,
      accessKey: 'k',
    });
    const snippet = buildMcpConfigJson(plugin as unknown as Parameters<typeof buildMcpConfigJson>[0]);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.url).toBe('http://0.0.0.0:9000/mcp');
  });
});
```

- [ ] **Step 1.2: Run the new tests — verify they fail**

Run: `npx vitest run tests/mcp-config-section.test.ts`
Expected: 5 failures, each like `expected undefined to be 'http'` (the current builder doesn't emit a `type` field).

If the test file *passes* unchanged, stop — something is wrong with the test setup, not with the code.

- [ ] **Step 1.3: Apply the one-line fix**

Edit `src/settings/mcp-config-section.ts:43`. Change:

```ts
const config: Record<string, unknown> = { url };
```

to:

```ts
const config: Record<string, unknown> = { type: 'http', url };
```

No other lines change in this file. Field order is `type`, then `url`, then conditional `headers` (latter is appended later in the function).

- [ ] **Step 1.4: Run the new tests — verify they pass**

Run: `npx vitest run tests/mcp-config-section.test.ts`
Expected: 5 passing, 0 failing.

- [ ] **Step 1.5: Run the full test suite**

Run: `npm test`
Expected: all pre-existing suites still pass; new suite passes. Pay particular attention to `tests/settings.test.ts` — its shallow `mcpServers` regex check is unaffected.

- [ ] **Step 1.6: Lint and typecheck**

Run: `npm run lint`
Expected: clean.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 1.7: Commit**

```bash
git add src/settings/mcp-config-section.ts tests/mcp-config-section.test.ts
git commit -m 'fix(settings/mcp-config): include type:"http" in client config snippet

Claude Code ignores .mcp.json entries that omit the transport type field,
so the snippet built by buildMcpConfigJson() did not load. Add the field
unconditionally (HTTPS is HTTP-over-TLS, not a different transport type)
and add direct unit coverage for the function so the regression is caught
if the field is dropped again.

Refs #326'
```

---

## Task 2: Fix README MCP example

**Files:**
- Modify: `README.md` lines 46–57

Two corrections in the same JSON block: add `"type": "http"` as the first key and append `/mcp` to the `url`. The end result must match the live builder's output for default secure settings.

- [ ] **Step 2.1: Make the edit**

In `README.md`, replace the existing block at lines 46–57:

```json
{
  "mcpServers": {
    "obsidian": {
      "url": "http://127.0.0.1:28741",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_KEY"
      }
    }
  }
}
```

with:

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "http://127.0.0.1:28741/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_KEY"
      }
    }
  }
}
```

(Two-space indentation, no trailing whitespace, matching the surrounding fenced block.)

- [ ] **Step 2.2: Verify**

Run: `git diff README.md`
Expected: only the two lines change (a new `"type"` line is inserted; the `"url"` line gains `/mcp`). No other diff hunks.

Run: `npm test`
Expected: still green (no test reads the README, but run anyway as a sanity check).

- [ ] **Step 2.3: Commit**

```bash
git add README.md
git commit -m 'docs(readme): add type:"http" and fix URL path in MCP example

The README example for Claude Desktop / generic MCP clients was missing
type:"http" (so Claude Code dropped it) and pointed at the bare host:port
instead of /mcp, where the live builder emits the snippet.

Refs #326'
```

---

## Task 3: Update help docs

**Files:**
- Modify: `docs/help/en.md` around lines 184–189

Add one bullet to the existing list describing the snippet shape. The bullet goes **above** the existing `url` bullet so the order matches the JSON emitted by the builder.

- [ ] **Step 3.1: Make the edit**

In `docs/help/en.md`, find the section that currently reads:

```
A single row with a **Copy** button. The JSON snippet is built live from your
current settings:

- Always includes the `url` field with the right scheme and port.
- Includes a `headers` block with `Authorization: Bearer <key>` **only** when
  auth is on **and** the key is non-empty.
```

Insert one bullet **above** the existing `url` bullet so the list reads:

```
A single row with a **Copy** button. The JSON snippet is built live from your
current settings:

- Always includes `"type": "http"` so MCP clients (notably Claude Code)
  recognize the Streamable HTTP transport.
- Always includes the `url` field with the right scheme and port.
- Includes a `headers` block with `Authorization: Bearer <key>` **only** when
  auth is on **and** the key is non-empty.
```

No other line in `en.md` changes. Do **not** touch other locale files (none exist).

- [ ] **Step 3.2: Verify**

Run: `git diff docs/help/en.md`
Expected: a single hunk adding two lines (the new bullet and its continuation line).

Run: `npm run docs:check` if defined, otherwise `npm test`.
Expected: clean.

- [ ] **Step 3.3: Commit**

```bash
git add docs/help/en.md
git commit -m 'docs(help): note type:"http" field in client config section

Reflect the buildMcpConfigJson() change so the manual lists every field
the live snippet emits.

Refs #326'
```

---

## Task 4: PRD CR21 audit note

**Files:**
- Modify: `docs/PRD.md` line ~152 (CR21)

Append a new audit-note continuation to the existing CR21 line. Don't strikethrough, don't renumber, and don't reflow the existing text.

- [ ] **Step 4.1: Make the edit**

In `docs/PRD.md`, find the CR21 line. It currently ends:

```
… so fresh installs always satisfy both branches, so the `headers` block is effectively always present unless the user explicitly disables auth*
```

Append, on the **same line**, after the existing trailing `*`:

```
 — *audit (2026-05-08): the snippet now also always includes a `"type": "http"` field at the top of the entry so Claude Code (which ignores entries without a transport type) loads the server on first paste — see issue #326 and `src/settings/mcp-config-section.ts:43`*
```

The leading space and em-dash mirror the existing `— *audit (2026-05-07): …*` pattern on the same line.

- [ ] **Step 4.2: Verify**

Run: `git diff docs/PRD.md`
Expected: a single line modified (CR21 grows by one audit-note clause). No other changes.

- [ ] **Step 4.3: Commit**

```bash
git add docs/PRD.md
git commit -m 'docs(prd): note type:"http" in CR21 audit

Records the 2026-05-08 follow-up: the live snippet now always emits
type:"http" so Claude Code loads the server on first paste.

Refs #326'
```

---

## Final verification

- [ ] **Step F.1: Inspect the commit log**

Run: `git log --oneline main..HEAD`
Expected: 5 commits in this order (top is most recent):

```
docs(prd): note type:"http" in CR21 audit
docs(help): note type:"http" field in client config section
docs(readme): add type:"http" and fix URL path in MCP example
fix(settings/mcp-config): include type:"http" in client config snippet
docs(superpowers/specs): brainstorm type:"http" fix for client snippet
```

(The spec commit was made before this plan. If the count is off, investigate before pushing.)

- [ ] **Step F.2: Full check before push**

Run each in order:

```bash
npm test
npm run lint
npm run typecheck
```

All three: clean.

- [ ] **Step F.3: Push the branch**

```bash
git push -u origin fix/issue-326-mcp-snippet-type-http
```

Expected: branch publishes to origin, no errors. CI begins.

- [ ] **Step F.4: Open the PR**

Create PR with a Conventional Commits title mirroring the primary commit subject and a body that closes #326:

```bash
gh pr create --title 'fix(settings/mcp-config): include type:"http" in client config snippet' --body "$(cat <<'EOF'
Closes #326

## Summary
- Add `"type": "http"` to the snippet built by `buildMcpConfigJson()` so Claude Code loads the server (it silently drops entries with no transport type).
- Fix the README example to also include `"type": "http"` and to use the correct `/mcp` URL path so the static example matches the live builder.
- Sync the user manual (`docs/help/en.md`) and PRD CR21 audit note.
- Add direct unit coverage for `buildMcpConfigJson()` (5 cases: default, HTTPS, auth-off, empty key, custom address/port).

## Test plan
- [x] `npm test` (new suite + existing suites green)
- [x] `npm run lint`
- [x] `npm run typecheck`
- [ ] Manual: install the local build in Obsidian, copy the snippet from Settings → MCP Client Configuration into a fresh `.claude/mcp.json`, run `claude` then `/mcp` — `obsidian` server appears and tools list.
EOF
)"
```

- [ ] **Step F.5: Watch CI**

Run: `gh pr checks --watch`
Expected: all required checks green. If anything fails, fix on the same branch and push again.

- [ ] **Step F.6: Hand off to user**

Do **not** merge. The user merges when ready. Stop here.

---

## Self-Review Notes

- **Spec coverage:** A→F, every spec section maps to a task. A → Task 1; B → Task 2; C → Task 3; D → Task 4; E (i18n no-op) → covered explicitly in spec, no task needed; F (tests) → Task 1.
- **Placeholders:** None. Every test asserts on a concrete value; every commit message is fully written; every diff is shown explicitly.
- **Type consistency:** `buildMcpConfigJson` returns a `string` everywhere; the parsed snippet shape (`{ obsidian: { type?, url?, headers? } }`) is consistent across all five test cases.
