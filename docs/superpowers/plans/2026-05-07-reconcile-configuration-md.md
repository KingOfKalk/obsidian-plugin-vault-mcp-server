# Reconcile `docs/configuration.md` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring [`docs/configuration.md`](../../configuration.md) back in sync with the audited PRD by rewriting it as a single 8-section reference that mirrors the in-Obsidian settings tab and matches `DEFAULT_SETTINGS` plus `docs/tools.generated.md`. One commit on branch `docs/issue-319-reconcile-configuration-md`.

**Architecture:** Pure documentation change — one Markdown file, full rewrite. The current 50-line doc is small enough that a structural reorganization (new sections, relocated `debugMode`, expanded entries) is cleanest as a single `Write`. Verification is grep-based plus the project's standard CI checks (`npm run lint` / `npm test` / `npm run typecheck` / `npm run docs:check`). One commit total, then push and open a PR.

**Tech Stack:** Markdown, GitHub CLI (`gh`), grep, jq.

**Spec:** [`docs/superpowers/specs/2026-05-07-reconcile-configuration-md-design.md`](../specs/2026-05-07-reconcile-configuration-md-design.md)
**Issue:** [#319](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/319)

---

## Pre-flight

Branch `docs/issue-319-reconcile-configuration-md` already exists locally (off latest `main`) and the spec has already been committed to it.

- [ ] **Step 1: Confirm branch and clean tree**

Run: `git status`
Expected: `On branch docs/issue-319-reconcile-configuration-md` and `nothing to commit, working tree clean`.

- [ ] **Step 2: Confirm baseline tests / lint / typecheck are green**

Run each separately:

```
npm run lint
npm run typecheck
npm test
```

Expected: each exits 0. If any fail, stop — don't try to fix unrelated failures here. Surface to the user.

- [ ] **Step 3: Confirm `docs/tools.generated.md` is current (sanity)**

Run: `npm run docs:check`
Expected: exits 0 (no diff between regenerated and committed `docs/tools.generated.md`).

We are not modifying `tools.generated.md`, but we copy its module/count rows into the new doc — this confirms the source of truth has not drifted under us.

- [ ] **Step 4: Capture the live module / count rows for cross-checking**

Run:

```
grep -E '^\| `[a-z-]+`' docs/tools.generated.md
```

Expected output (exact, eight rows; this is the source of truth for Task 1's module table):

```
| `vault` | Vault and File Operations | 18 | vault_create, vault_read, vault_update, vault_delete, vault_append, vault_get_metadata, vault_rename, vault_move, vault_copy, vault_create_folder, vault_delete_folder, vault_rename_folder, vault_list, vault_list_recursive, vault_read_binary, vault_write_binary, vault_get_aspect, vault_daily_note |
| `editor` | Editor Operations | 10 | editor_get_content, editor_get_active_file, editor_insert, editor_replace, editor_delete, editor_get_cursor, editor_set_cursor, editor_get_selection, editor_set_selection, editor_get_line_count |
| `search` | Search and Metadata | 6 | search_fulltext, search_tags, search_resolved_links, search_unresolved_links, search_by_tag, search_by_frontmatter |
| `workspace` | Workspace and Navigation | 5 | workspace_get_active_leaf, workspace_open_file, workspace_list_leaves, workspace_set_active_leaf, workspace_get_layout |
| `ui` | UI Interactions | 1 | ui_notice |
| `templates` | Templates and Content Generation | 3 | template_list, template_create_from, template_expand |
| `plugin-interop` | Plugin Interop | 6 | plugin_list, plugin_check, plugin_dataview_query, plugin_dataview_describe_js_query, plugin_templater_describe_template, plugin_execute_command |
| `extras` | Extras | 1 | extras_get_date |
```

If any of those eight counts differ, **stop** and surface to the user — the plan's hard-coded module table will be wrong.

---

## Task 1: Rewrite `docs/configuration.md`

**Files:**
- Modify: `docs/configuration.md` (full rewrite — replaces all 50 lines)

The current file is 50 lines and the new structure reorganizes content (new h2 sections inserted, `debugMode` relocated, table updated, 14 new entries added). A single `Write` is cleaner than chained `Edit`s.

- [ ] **Step 1: Replace the file contents**

Use the `Write` tool on `docs/configuration.md` with **exactly** the content below (between the `<<<FILE` / `FILE>>>` markers — do **not** include the markers themselves; the outer 4-backtick fence is for nesting only):

````
<<<FILE
# Configuration Reference

This page documents every persisted setting in `data.json` that has a
matching row in the plugin's settings tab. Headings mirror the in-Obsidian
settings tab so you can cross-reference what you see on screen.

For the per-tool list (each tool's name, `readOnly` / `destructive`
annotations, etc.) see [`tools.generated.md`](tools.generated.md), which
is auto-generated from the tool registry.

## Server Status

Read-only summary section. Shows whether the server is running, the URL
it is bound to, the number of connected clients, and a toggle plus
restart button. Not a persisted setting.

## Server Settings

### Server Address (`serverAddress`)
- **Default**: `127.0.0.1`
- **Description**: IP address the MCP server binds to. The default `127.0.0.1` restricts access to the local machine only. Changing this to `0.0.0.0` will expose the server on all network interfaces — **use with caution** and ensure an access key is configured.
- **Validation**: Must be a valid IPv4 address

### Port (`port`)
- **Default**: `28741`
- **Description**: HTTP port the MCP server listens on
- **Range**: 1–65535
- **Conflict handling**: If the configured port is already in use by another process, the server start fails. The plugin shows an Obsidian Notice, renders the port with a strike-through in the status bar (hover for the exact error), and displays an inline error under this field in settings. Change the port or free the other process, then toggle the server back on.

### Server URL
- **Read-only**. Composed live from `<scheme>://<serverAddress>:<port>/mcp` where `<scheme>` is `https` if `httpsEnabled` is true, else `http`. The settings tab exposes a copy button; not a persisted setting.

### Require Bearer authentication (`authEnabled`)
- **Default**: `true`
- **Description**: When on (the default since v10), the server requires a Bearer access key on every request. When off, the server only binds if `iAcceptInsecureMode` is also true; otherwise startup fails with a clear error.

### Acknowledge insecure mode (`iAcceptInsecureMode`)
- **Default**: `false`
- **Description**: Explicit acknowledgement that running with auth disabled is acceptable. Required to bind when `authEnabled === false`. Existing pre-v10 installs that ran default-insecure are grandfathered to `true` by the v9 → v10 migration so they keep working after upgrade. Toggling auth back on clears this flag.
- **When visible**: `authEnabled === false`

### Access Key (`accessKey`)
- **Default**: (empty)
- **Description**: Bearer token for authenticating MCP clients. The server will not start without an access key configured.
- **Generate**: Click the "Generate" button in settings to create a random 64-character hex key
- **When visible**: `authEnabled === true`

### HTTPS (`httpsEnabled`)
- **Default**: `false`
- **Description**: Enable HTTPS with a locally generated self-signed certificate. The certificate is generated on first server start and cached in plugin data; MCP clients must trust it explicitly (or disable certificate verification). Requires a server restart after toggling.
- **Regenerate**: Click the refresh button on the "TLS Certificate" row in settings to produce a fresh certificate (e.g. after changing the server address). Existing clients will need to re-trust the new certificate.

### TLS Certificate (`tlsCertificate`)
- **Default**: `null`
- **Description**: Cached self-signed certificate and private key (PEM) used when HTTPS is enabled. Generated automatically; regenerated on demand via the settings UI. Included in `data.json` — treat it like the access key.
- **When visible**: `httpsEnabled === true && useCustomTls === false`

### Use custom TLS (`useCustomTls`)
- **Default**: `false`
- **Description**: When on, the server loads a user-provided cert/key pair from disk (`customTlsCertPath` + `customTlsKeyPath`) instead of the auto-generated self-signed cert.
- **When visible**: `httpsEnabled === true`

### Custom TLS

When `useCustomTls` is on, an h3 subsection appears below with two file
pickers for the cert and key. Both paths are validated on load via
`loadAndValidateCustomTls`; errors render inline under the matching row.

#### Custom certificate path (`customTlsCertPath`)
- **Default**: `null`
- **Description**: Absolute filesystem path to the user-provided public certificate (PEM).
- **When visible**: `httpsEnabled === true && useCustomTls === true`

#### Custom key path (`customTlsKeyPath`)
- **Default**: `null`
- **Description**: Absolute filesystem path to the user-provided private key (PEM). Must match `customTlsCertPath`; mismatches surface as inline errors.
- **When visible**: `httpsEnabled === true && useCustomTls === true`

### Auto-start (`autoStart`)
- **Default**: `false`
- **Description**: Start the MCP server automatically when Obsidian launches the plugin. Off by default so a fresh install doesn't open a network port until the user opts in.

### Enable MCP resources (`resourcesEnabled`)
- **Default**: `true`
- **Description**: Expose vault files as MCP resources (`obsidian://vault/{+path}` template + `obsidian://vault/index` static) in addition to tools. Turn off if your client doesn't speak the resources protocol or you want a tools-only surface.

### Enable MCP prompts (`promptsEnabled`)
- **Default**: `true`
- **Description**: Expose canned slash-command prompts via the MCP prompts surface (`/summarize-note`, `/find-related`, `/expand-template`, etc.). Turn off if your client doesn't use prompts.

### DNS Rebind Protection

#### Allowed origins (`allowedOrigins`)
- **Default**: `['http://127.0.0.1', 'http://localhost', 'https://127.0.0.1', 'https://localhost']`
- **Description**: Origins (scheme + host [+ port]) allowed to issue requests. Used to block DNS-rebind attacks. Listed one per line in the textarea. Adding a non-loopback origin surfaces a warning under the row.

#### Allowed hosts (`allowedHosts`)
- **Default**: `['127.0.0.1', 'localhost']`
- **Description**: Hostnames allowed to appear in the `Host` header. The port portion is stripped before comparison. Listed one per line. Adding a non-loopback host surfaces a warning under the row.

#### Allow null origin (`allowNullOrigin`)
- **Default**: `false`
- **Description**: Accept requests with `Origin: null` (sandboxed iframes, `file://`). Off by default; turn on only if you understand the rebind-attack implications.

#### Require Origin header (`requireOrigin`)
- **Default**: `false`
- **Description**: Reject requests that don't carry an `Origin` header. Off by default to keep `curl` and other native clients working; turn on for browser-only deployments.

## MCP Client Configuration

Read-only section that exposes a "Copy" button. Copies a JSON fragment
shaped for `mcpServers`-style client configuration (URL plus a Bearer
header when auth is on). Not a persisted setting.

## Feature Modules

Each module can be individually enabled or disabled. When a module is enabled, all of its tools are exposed; there is no per-module read-only mode. Tools advertise MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can present them appropriately.

The per-tool list (names, annotations) lives in
[`tools.generated.md`](tools.generated.md), which is auto-generated from
the registry; the table below mirrors its module / count rows.

| Module                    | Tools  |
| ------------------------- | ------ |
| Vault and File Operations | 18     |
| Editor Operations         | 10     |
| Search and Metadata       | 6      |
| Workspace and Navigation  | 5      |
| UI Interactions           | 1      |
| Templates                 | 3      |
| Plugin Interop            | 6      |
| Extras                    | 1      |
| **Total**                 | **50** |

### Extras

Modules in the `extras` group expose **per-tool** toggles instead of a
single per-module toggle. Each tool can be turned on or off
individually; the state is stored under
`moduleStates[<moduleId>].toolStates[<toolName>]` in `data.json`. Today
the only Extras module ships `extras_get_date`.

## Execute Command Allowlist (`executeCommandAllowlist`)

- **Default**: `[]`
- **Description**: Allowlist of Obsidian command ids that `plugin_execute_command` is permitted to run. Empty (the default) means command execution is disabled and the tool refuses every call with a clear error. Listed one per line; example:
  ```
  app:reload
  editor:save-file
  ```

## Diagnostics

### Debug Mode (`debugMode`)
- **Default**: `false`
- **Description**: Enable verbose logging of all MCP requests and responses. Access keys are always redacted from logs.

### Log file path
- **Read-only**. Displays the absolute path of the plugin's log file. Not a persisted setting.

### Copy debug info
- **Action**. Opens a modal that copies a redacted bundle of plugin state (settings without secrets, recent log lines, plugin / Obsidian version) to the clipboard for bug reports. Not a persisted setting.

### Clear log
- **Action**. Truncates the log file. Not a persisted setting.

## Settings Persistence

All settings are stored in Obsidian's plugin `data.json` file. Settings include a schema version for automatic migration between plugin versions.
FILE>>>
````

The new file is ~140 lines (versus 50 before). Confirm the `Write` tool reports success.

---

## Task 2: Verification

**Files:** none modified.

This task is a sequence of `grep` / file-checks that prove the rewrite covers every acceptance criterion in #319.

- [ ] **Step 1: All 14 newly-documented field keys are present**

Run:

```bash
for k in authEnabled iAcceptInsecureMode useCustomTls customTlsCertPath customTlsKeyPath autoStart resourcesEnabled promptsEnabled allowedOrigins allowedHosts allowNullOrigin requireOrigin executeCommandAllowlist debugMode; do
  count=$(grep -c "\`$k\`" docs/configuration.md)
  printf '%-28s %s\n' "$k" "$count"
done
```

Expected: every key prints a count of **at least 1** (most print 1; `authEnabled`, `useCustomTls`, `httpsEnabled`-related cross-references can print 2+). No row should print `0`.

- [ ] **Step 2: Pre-existing field keys are preserved**

Run:

```bash
for k in serverAddress port accessKey httpsEnabled tlsCertificate; do
  count=$(grep -c "\`$k\`" docs/configuration.md)
  printf '%-20s %s\n' "$k" "$count"
done
```

Expected: every key prints a count of **at least 1**.

- [ ] **Step 3: `schemaVersion` and `seenInsecureWarning` are still excluded**

Run:

```bash
grep -nE "\`(schemaVersion|seenInsecureWarning)\`" docs/configuration.md
```

Expected: no output (exit 1). Both are internal-only and intentionally not documented.

- [ ] **Step 4: Module table counts match `tools.generated.md`**

Run:

```bash
grep -E "^\| (Vault and File|Editor|Search and|Workspace|UI Interactions|Templates|Plugin Interop|Extras|\*\*Total\*\*) " docs/configuration.md
```

Expected output (exact, in this order):

```
| Vault and File Operations | 18     |
| Editor Operations         | 10     |
| Search and Metadata       | 6      |
| Workspace and Navigation  | 5      |
| UI Interactions           | 1      |
| Templates                 | 3      |
| Plugin Interop            | 6      |
| Extras                    | 1      |
| **Total**                 | **50** |
```

- [ ] **Step 5: Defaults match `DEFAULT_SETTINGS`**

Manual cross-check (no automated tooling). Open both files side-by-side:

- `src/types.ts` lines 107–130 (`DEFAULT_SETTINGS`).
- `docs/configuration.md` (every `### … (\`field\`)` heading and its `**Default**:` row).

For each key documented in the new file, confirm the `**Default**` value matches the literal in `DEFAULT_SETTINGS`. Quick reference:

| Key                       | DEFAULT_SETTINGS value                | Doc shows                                                       |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `serverAddress`           | `'127.0.0.1'`                         | `127.0.0.1`                                                     |
| `port`                    | `28741`                               | `28741`                                                         |
| `authEnabled`             | `true`                                | `true`                                                          |
| `accessKey`               | `''`                                  | (empty)                                                         |
| `httpsEnabled`            | `false`                               | `false`                                                         |
| `tlsCertificate`          | `null`                                | `null`                                                          |
| `useCustomTls`            | `false`                               | `false`                                                         |
| `customTlsCertPath`       | `null`                                | `null`                                                          |
| `customTlsKeyPath`        | `null`                                | `null`                                                          |
| `debugMode`               | `false`                               | `false`                                                         |
| `autoStart`               | `false`                               | `false`                                                         |
| `resourcesEnabled`        | `true`                                | `true`                                                          |
| `promptsEnabled`          | `true`                                | `true`                                                          |
| `executeCommandAllowlist` | `[]`                                  | `[]`                                                            |
| `allowedOrigins`          | `[...DEFAULT_ALLOWED_ORIGINS]` (4)    | `['http://127.0.0.1', 'http://localhost', 'https://127.0.0.1', 'https://localhost']` |
| `allowedHosts`            | `[...DEFAULT_ALLOWED_HOSTS]` (2)      | `['127.0.0.1', 'localhost']`                                    |
| `allowNullOrigin`         | `false`                               | `false`                                                         |
| `requireOrigin`           | `false`                               | `false`                                                         |
| `iAcceptInsecureMode`     | `false`                               | `false`                                                         |

If any default in the doc disagrees with `DEFAULT_SETTINGS`, fix the doc — `DEFAULT_SETTINGS` is the source of truth.

- [ ] **Step 6: Sanity-check the diff**

Run: `git diff --stat docs/configuration.md`
Expected: one file changed; ~140 insertions, ~50 deletions (whole-file rewrite).

Run: `git diff docs/configuration.md | head -40`
Expected: a `diff --git` header followed by the rewrite. No accidental edits to other files.

- [ ] **Step 7: Run the project checks**

Run each separately (per `CLAUDE.md` — they are no-ops for doc-only edits but confirm we did not accidentally touch source):

```
npm run lint
npm run typecheck
npm test
```

Expected: each exits 0.

- [ ] **Step 8: Run docs:check (CI gate)**

Run: `npm run docs:check`
Expected: exits 0 (no diff between regenerated and committed `docs/tools.generated.md`).

We are not modifying `tools.generated.md`, so this stays green; we run it locally to catch any pre-existing drift before CI does.

---

## Task 3: Commit, push, open PR

- [ ] **Step 1: Stage the change**

Run: `git add docs/configuration.md`

- [ ] **Step 2: Commit**

Run (using HEREDOC to preserve newlines):

```bash
git commit -m "$(cat <<'EOF'
docs(configuration): cover missing settings and reconcile module counts

Rewrites docs/configuration.md to mirror the in-Obsidian settings tab
and cover every persisted setting with a UI row. Adds entries for
authEnabled, iAcceptInsecureMode, useCustomTls, customTlsCertPath,
customTlsKeyPath, autoStart, resourcesEnabled, promptsEnabled,
allowedOrigins, allowedHosts, allowNullOrigin, requireOrigin, and
executeCommandAllowlist. Relocates debugMode under Diagnostics, adds
an Extras subsection explaining per-tool toggles, and updates the
module table to match docs/tools.generated.md (18/10/6/5/1/3/6/1,
total 50).

No runtime behaviour changes; documentation only.

Refs #319
EOF
)"

- [ ] **Step 3: Verify commit**

Run: `git log --oneline -1`
Expected: a single commit titled `docs(configuration): cover missing settings and reconcile module counts` on the current branch.

Run: `git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 4: Push the branch**

Run: `git push -u origin docs/issue-319-reconcile-configuration-md`
Expected: branch pushed and tracking origin.

- [ ] **Step 5: Open the PR**

Run:

```bash
gh pr create --title "docs(configuration): cover missing settings and reconcile module counts" --body "$(cat <<'EOF'
Closes #319

## Summary

- Re-aligns `docs/configuration.md` with the audited PRD (#264).
- Mirrors the in-Obsidian settings tab structure: Server Status,
  Server Settings (with DNS Rebind and Custom TLS h3 subsections),
  MCP Client Configuration, Feature Modules (with Extras h3),
  Execute Command Allowlist, Diagnostics, Settings Persistence.
- Adds 13 missing setting entries plus an Extras-toggles subsection;
  relocates `debugMode` under Diagnostics; updates the module table to
  match `docs/tools.generated.md` (18 / 10 / 6 / 5 / 1 / 3 / 6 / 1,
  total 50).
- No source / runtime changes.

## Test plan

- Every key in `DEFAULT_SETTINGS` except `schemaVersion` and
  `seenInsecureWarning` appears as a `\`fieldName\`` reference in the doc.
- Module-table counts match `docs/tools.generated.md` row-for-row.
- Defaults documented match `DEFAULT_SETTINGS` literal values.
- `npm run lint`, `npm test`, `npm run typecheck`, `npm run docs:check`
  green locally.
EOF
)"
```

- [ ] **Step 6: Verify PR opened**

Run: `gh pr view --json number,title,state,headRefName`
Expected: PR exists, title matches, state `OPEN`, head ref `docs/issue-319-reconcile-configuration-md`.

Hand the PR URL back to the user. Wait for them to merge — never merge yourself (per `CLAUDE.md` — the user merges).

---

## Done

When all tasks above show ✅:

- `docs/configuration.md` covers every persisted setting that has a UI row.
- Module-table tool counts match `docs/tools.generated.md` (50 across 8 modules).
- Defaults documented match `DEFAULT_SETTINGS` in `src/types.ts`.
- One commit on `docs/issue-319-reconcile-configuration-md`, pushed, with an open PR linking back to #319.
- All three acceptance criteria from #319 are met.
