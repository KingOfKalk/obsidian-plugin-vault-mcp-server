# Design — `McpServer.instructions` field with vault-aware tool-use hints

- **Date:** 2026-05-03
- **Issue:** [#290](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/290)
- **Tracker context:** Follow-up from the `mcp-server-dev:build-mcp-server` skill review (parent: [#258](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/258)).
- **Status:** Approved design; implementation plan to follow.

## 1. Goal

Set the `instructions` field on the `McpServer` constructor so that Claude (and any MCP-capable client) receives a small, stable set of vault-aware tool-use hints in its system prompt for the entire session.

These tokens are paid every turn, so the string must stay tight and limited to hints that the per-tool descriptions and titles cannot convey on their own.

## 2. Locked decisions

- **Content scope:** option **B** from brainstorming — the four hints called out in the issue body, prefixed by a one-sentence frame ("This server exposes an Obsidian vault as MCP tools.").
- **Style:** option **A** — terse imperative bullets, Markdown-flavoured, with backticked tool names.
- **Source location:** option **B** — exported `SERVER_INSTRUCTIONS` constant at the top of [`src/server/mcp-server.ts`](../../../src/server/mcp-server.ts), passed into the existing `new McpServer(...)` call in `createMcpServer`.
- **Test strategy:** option **C** — both a wiring test (constructor receives the constant) and a content-shape test (non-empty, length budget, mentions of load-bearing tool names).
- **Doc placement:** option **A** — new `## For developers / MCP client builders` section near the end of [`docs/help/en.md`](../../help/en.md), just before the FAQ. The literal current text is quoted in a code block, with a one-line pointer noting that the source of truth lives in `src/server/mcp-server.ts`.

## 3. The instructions string

```
This server exposes an Obsidian vault as MCP tools.

- Prefer `search_fulltext` (or other `search_*` tools) before `vault_read` when you don't already know the file path.
- `editor_*` tools operate on the **active** file only — open one with `workspace_open_file` first if needed.
- Paths are vault-relative with forward slashes (e.g. `notes/foo.md`); never absolute filesystem paths.
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate `vault_get_*` tools — don't parse them out of `vault_read` output.
```

Approximate size: ~560 characters including newlines. Within the "few hundred chars max" budget noted in the issue, with comfortable headroom under the 800-char hard cap enforced by the test.

Notes on the four bullets:

1. **Search-before-read.** Generalised from `search_fulltext` to "or other `search_*` tools" so Claude knows the family exists (six search tools today: `search_fulltext`, `search_by_frontmatter`, `search_by_tag`, `search_resolved_links`, `search_unresolved_links`, `search_tags`).
2. **Editor scope.** Pins the active-file constraint and points at the only legal way to change the active file (`workspace_open_file`).
3. **Path convention.** Removes a known foot-gun where models default to absolute paths.
4. **Per-category getters.** Enumerates the six `vault_get_*` categories so Claude knows the full menu rather than reaching for `vault_read` to extract this information.

## 4. Source change — `src/server/mcp-server.ts`

- Add an exported `const SERVER_INSTRUCTIONS: string = '…'` at the top of the file (between the imports and `createMcpServer`).
- In the existing `new McpServer(...)` call inside `createMcpServer`, add `instructions: SERVER_INSTRUCTIONS` to the second-position options object, alongside `capabilities`.

No changes to the registry, dispatcher, transport, or any tool. The MCP TypeScript SDK forwards `instructions` as `serverInfo.instructions` in the `initialize` response; clients (Claude Desktop, Claude Code, Codex, etc.) lift it into the model's system prompt for the session.

## 5. Test plan — `tests/server/mcp-server.test.ts`

The existing `vi.mock('@modelcontextprotocol/sdk/server/mcp.js')` already captures the constructor's two arguments in `capturedConstructorArgs`. The `CapturedOptions` interface needs one new field:

```ts
interface CapturedOptions {
  capabilities?: { tools?: unknown };
  instructions?: string;
}
```

### Test 1 — wiring

Inside the existing `describe('createMcpServer', …)` block:

> `it('forwards SERVER_INSTRUCTIONS to the McpServer constructor as the instructions option', …)`

Asserts `capturedConstructorArgs[0].options.instructions === SERVER_INSTRUCTIONS` (imported from `../../src/server/mcp-server`).

### Test 2 — content shape

A new top-level `describe('SERVER_INSTRUCTIONS', …)` block:

- Non-empty: `expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0)`.
- Length budget: `expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(800)`. Hard cap so we notice if the string drifts toward bloat.
- Mentions every load-bearing tool name. One assertion per token, so a regression points at the missing concept:
  - `search_fulltext`
  - `vault_read`
  - `editor_`
  - `workspace_open_file`
  - `vault_get_`

The content-shape test deliberately does **not** lock the exact wording — only the structural promises. Wording changes can be made freely as long as the budget and tool-name menu hold.

## 6. Documentation

### `docs/help/en.md`

Add a new section between the existing "Status bar" subsection and the `## FAQ` heading (around line 248). Outline of the new content (the implementation will write the literal Markdown — outer fence shown here as `~~~` only because this spec already lives inside a Markdown code block):

~~~markdown
---

## For developers / MCP client builders

The MCP server advertises a short set of tool-use hints in the protocol-level
`instructions` field of the `initialize` response. MCP clients (Claude Desktop,
Claude Code, etc.) typically lift this string into the model's system prompt
for the session, so it persists across every turn.

The current text:

```
<verbatim copy of SERVER_INSTRUCTIONS>
```

Source of truth: [`src/server/mcp-server.ts`](https://github.com/KingOfKalk/obsidian-plugin-mcp/blob/main/src/server/mcp-server.ts).
If you suspect drift between the quoted text above and the live string, the
source file wins.
~~~

Roughly 80 words plus the quoted block. No localisation — `instructions` is a protocol-level English-only string per the issue's "out of scope" note.

### `docs/tools.generated.md`

No regeneration needed. The tool registry is unchanged.

## 7. Out of scope

- Per-tool description or title changes — covered by the already-merged #296 (sibling cross-refs) and the broader Phase 3 work.
- Localising the instructions string — protocol-level system prompt, English-only is correct.
- Auto-generating the doc block from the source constant. Single ~560-char string; the manual quote-and-pointer pattern is enough.
- Any change to the SDK version, transport, or `initialize` response handling.

## 8. Risks and notes

- **Token cost.** ~560 chars per turn, every turn. Acceptable for the leverage; the 800-char test cap stops accidental growth.
- **Doc drift.** The quoted block in `en.md` will lag the source if someone edits `SERVER_INSTRUCTIONS` without touching the doc. Mitigation: PR review + the explicit "source of truth" pointer. CI does **not** enforce this — judged not worth the build complexity for a single string.
- **Client compatibility.** `instructions` has been in the MCP spec since the initial release and is supported by every major client. No fallback needed.

## 9. References

- Issue [#290](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/290)
- Parent tracker [#258](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/258)
- Campaign plan [`docs/superpowers/specs/2026-05-02-mcp-builder-review-followup-design.md`](2026-05-02-mcp-builder-review-followup-design.md)
- `mcp-server-dev:build-mcp-server` skill — `references/server-capabilities.md` (the `instructions` field)
