# Design: include `type: "http"` in MCP client config snippet (issue #326)

**Issue:** [#326](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/326)
**Date:** 2026-05-08
**Branch:** `fix/issue-326-mcp-snippet-type-http`

## Problem

The `.mcp.json` snippet emitted by the plugin's "MCP Client Configuration"
section (and mirrored in the README) is missing the `"type": "http"` field.
Claude Code's `/mcp` reader silently ignores the entry when `type` is absent
— users get "No MCP servers configured" even though the local server is up
and authenticating correctly.

While auditing the snippet sources, a second copy-paste bug surfaced in the
README example: the `url` is `http://127.0.0.1:28741` (no `/mcp` path),
while the live builder correctly emits `http://127.0.0.1:28741/mcp`. Both
are fixed in this change because they are the same surface (the client
config copy-paste path) and a user hitting either symptom hits the same
support outcome.

## Goals

- The clipboard snippet from the settings UI works in Claude Code on first
  paste, with no manual edits.
- The README example matches the live builder's output exactly (modulo the
  placeholder access key).
- The user manual describes the snippet shape accurately.
- Regression coverage exists for the `type` field and the `url` shape so
  future refactors don't silently drop them.

## Non-goals

- No new UI affordances (no preview pane, no per-client snippet
  variants, no "copy full `mcpServers` wrapper" button).
- No localized help files. Only `docs/help/en.md` exists; no new locales
  are introduced here.
- No change to the Claude Code CLI snippet (`claude mcp add ...`) in the
  README — that already specifies `--transport http`.
- No new transport types (`sse`, `stdio`, etc.). `type` is hard-coded to
  `"http"`.

## Design

### A. Source-of-truth: `buildMcpConfigJson()`

File: `src/settings/mcp-config-section.ts`

Change the config-object initializer:

```ts
// before
const config: Record<string, unknown> = { url };

// after
const config: Record<string, unknown> = { type: 'http', url };
```

Rationale:

- `type: 'http'` is set **unconditionally**, including when HTTPS is
  enabled. Per the MCP spec, "Streamable HTTP" is the transport type
  regardless of TLS — `https://` is HTTP-over-TLS, not a different
  transport.
- Field order is `type`, `url`, `headers` so the rendered JSON reads
  top-down: kind of thing, where it lives, how to authenticate.
- The brace-stripping logic at the bottom of the function is unchanged;
  the function still returns a fragment (the `"obsidian": { ... }` block
  with the outer object braces stripped), suitable for pasting into an
  existing `mcpServers` map.

### B. README example

File: `README.md`, lines 46–57.

Two corrections in one edit:

1. Add `"type": "http"` as the first key.
2. Append `/mcp` to the `url` so the example matches the live builder.

Resulting block:

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

### C. Help docs

File: `docs/help/en.md`, section "3. MCP Client Configuration"
(lines 182–195).

Extend the bullet list describing the snippet shape to add one bullet
above the existing `url` bullet:

- Always includes `"type": "http"` so MCP clients (notably Claude Code)
  recognize the Streamable HTTP transport.

The existing `url` and conditional `headers` bullets are kept verbatim.
No other section in `en.md` references the snippet shape.

### D. PRD audit note

File: `docs/PRD.md`, CR21 (around line 152).

Append an audit note in the existing CR21 audit-note style describing
the `type: "http"` field as always-present. Don't renumber, don't
strikethrough — just an `— *audit (2026-05-08): ...*` continuation
sentence on the existing line.

### E. i18n

Files: `src/lang/locale/en.ts`, `src/lang/locale/de.ts`.

No change. The current `setting_client_config_desc` strings describe
the snippet generically ("Copy the JSON snippet for your MCP client and
paste it into the `mcpServers` section …") and do not enumerate fields,
so adding a new field doesn't invalidate them.

### F. Tests

New file: `tests/mcp-config-section.test.ts`.

Test the public function `buildMcpConfigJson()` directly. The function
returns a string fragment (the inner contents of an outer JSON object),
so each test parses it back into JSON by wrapping in `{}` and using
`JSON.parse`, then asserts on the resulting object.

Test cases:

1. **Default secure settings (auth on, key set, http)** —
   `{ type: 'http', url: 'http://127.0.0.1:28741/mcp', headers: { Authorization: 'Bearer <key>' } }`.
2. **HTTPS on** — `type` is still `"http"`, `url` uses `https://`.
3. **Auth off** — no `headers` key; `type` and `url` still present.
4. **Auth on but empty access key** — no `headers` key (current
   `authEnabled && accessKey` conditional preserved).
5. **Custom address and port** — `url` reflects them: e.g.
   `http://0.0.0.0:9000/mcp`.

The existing shallow regex check at `tests/settings.test.ts:480`
(`expect(setting.settingDesc).toMatch(/mcpServers/)`) is left as-is —
it tests the i18n description, not the snippet.

### G. Out of scope (re-stated)

- No new UI surface, no localized help docs, no CLI snippet change, no
  new transport types, no change to the i18n description strings.

## Commit plan

Per `CLAUDE.md` rule 24 (one logical change per commit), four commits on
branch `fix/issue-326-mcp-snippet-type-http`:

1. `fix(settings/mcp-config): include type:"http" in client config snippet`
   - `src/settings/mcp-config-section.ts`
   - `tests/mcp-config-section.test.ts` (new)
2. `docs(readme): add type:"http" and fix URL path in MCP example`
   - `README.md`
3. `docs(help): note type:"http" field in client config section`
   - `docs/help/en.md`
4. `docs(prd): note type:"http" in CR21 audit`
   - `docs/PRD.md`

Each commit body references `Refs #326`.

## Verification plan

- `npm test` — new tests pass; existing tests still pass.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run docs:check` — passes (no tool-registry change, but the
  CI gate runs anyway).
- Manual: load the plugin in Obsidian, click the copy button in
  Settings → MCP Client Configuration, paste into a fresh
  `.claude/mcp.json` under `mcpServers`, run `claude` and `/mcp` —
  the `obsidian` server appears and tools are listable.
