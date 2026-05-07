# Reconcile `docs/configuration.md` with the audited PRD

**Issue:** [#319](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/319)
**Date:** 2026-05-07
**Refs:** #264 (PRD audit that surfaced the divergences)

## Problem

[`docs/configuration.md`](../../configuration.md) is incomplete relative to
the shipped settings surface and the module-table tool counts disagree
with [`docs/tools.generated.md`](../../tools.generated.md). Surfaced by
the PRD audit (#264) as **DR2** ⚠️.

The doc currently covers 7 persisted settings (`serverAddress`, `port`,
`accessKey`, `httpsEnabled`, `tlsCertificate`, `debugMode`, plus the
module table) and is missing entries for 14 more that have UI rows in
[`src/settings/`](../../../src/settings/). The module-table counts
(16 / 12 / 10 / 5 / 3 / 3 / 5) disagree with the live registry counts
(18 / 6 / 10 / 5 / 1 / 3 / 6 / 1 across 8 modules including Extras).

## Goal

Make `docs/configuration.md` cover every persisted settings field that
has a UI row, with defaults that match `DEFAULT_SETTINGS`, and reconcile
the module table with `docs/tools.generated.md`. Mirror the in-Obsidian
settings tab order so users can cross-reference what they see.

## Non-goals

- Changing the settings or the UI. Pure docs.
- Re-writing entries that are already correct (`serverAddress`, `port`,
  `accessKey`, `httpsEnabled`, `tlsCertificate`, `debugMode`) — preserve
  current wording.
- Adding screenshots — not committed to git per CLAUDE.md rule 4.
- Auto-validating the module table from the registry. Drift risk
  remains (CI doesn't check it); out of scope per the issue.
- Translating to other locales — `configuration.md` has no locale
  variants today.

## Settings inventory (cross-checked against `DEFAULT_SETTINGS`)

The table lists every key in [`DEFAULT_SETTINGS`](../../../src/types.ts)
and where it surfaces in the UI. **Action** = what this spec does for
that key.

| Key                       | Default                             | UI section                        | Currently documented? | Action       |
| ------------------------- | ----------------------------------- | --------------------------------- | --------------------- | ------------ |
| `schemaVersion`           | `12`                                | none (internal)                   | no                    | skip         |
| `serverAddress`           | `'127.0.0.1'`                       | Server Settings                   | yes                   | keep as-is   |
| `port`                    | `28741`                             | Server Settings                   | yes                   | keep as-is   |
| `authEnabled`             | `true`                              | Server Settings                   | no                    | **add**      |
| `iAcceptInsecureMode`     | `false`                             | Server Settings (when auth off)   | no                    | **add**      |
| `accessKey`               | `''`                                | Server Settings (when auth on)    | yes                   | keep as-is   |
| `httpsEnabled`            | `false`                             | Server Settings                   | yes                   | keep as-is   |
| `tlsCertificate`          | `null`                              | Server Settings (refresh button)  | yes                   | keep as-is   |
| `useCustomTls`            | `false`                             | Server Settings → Custom TLS (h3) | no                    | **add**      |
| `customTlsCertPath`       | `null`                              | Server Settings → Custom TLS (h3) | no                    | **add**      |
| `customTlsKeyPath`        | `null`                              | Server Settings → Custom TLS (h3) | no                    | **add**      |
| `autoStart`               | `false`                             | Server Settings                   | no                    | **add**      |
| `resourcesEnabled`        | `true`                              | Server Settings                   | no                    | **add**      |
| `promptsEnabled`          | `true`                              | Server Settings                   | no                    | **add**      |
| `allowedOrigins`          | `DEFAULT_ALLOWED_ORIGINS` (4 items) | Server Settings → DNS Rebind (h3) | no                    | **add**      |
| `allowedHosts`            | `DEFAULT_ALLOWED_HOSTS` (2 items)   | Server Settings → DNS Rebind (h3) | no                    | **add**      |
| `allowNullOrigin`         | `false`                             | Server Settings → DNS Rebind (h3) | no                    | **add**      |
| `requireOrigin`           | `false`                             | Server Settings → DNS Rebind (h3) | no                    | **add**      |
| `executeCommandAllowlist` | `[]`                                | Execute Command Allowlist (h2)    | no                    | **add**      |
| `debugMode`               | `false`                             | Diagnostics                       | yes                   | **relocate** |
| `seenInsecureWarning`     | `false`                             | none (internal one-shot flag)     | no                    | skip         |
| `moduleStates`            | `{}`                                | Feature Modules + Extras          | partial (table only)  | **expand**   |

`schemaVersion` and `seenInsecureWarning` are correctly excluded by
acceptance #1 (no UI row). `debugMode` is documented but currently
under "Server Settings"; the live UI puts it under Diagnostics, so it
moves to match.

## New document outline

Mirrors the settings tab render order from [`src/settings/tab.ts`](../../../src/settings/tab.ts):

```
# Configuration Reference

## Server Status                         (h2 — read-only summary section)
## Server Settings                       (h2)
  ### Server Address (`serverAddress`)
  ### Port (`port`)
  ### Server URL                         (read-only; copy button)
  ### Require Bearer authentication (`authEnabled`)
  ### Acknowledge insecure mode (`iAcceptInsecureMode`)
  ### Access Key (`accessKey`)
  ### HTTPS (`httpsEnabled`)
  ### TLS Certificate (`tlsCertificate`)        (when httpsEnabled && !useCustomTls)
  ### Use custom TLS (`useCustomTls`)           (when httpsEnabled — sibling, not nested)
  ### Custom TLS                                (h3 — UI subsection, when useCustomTls)
    #### Custom certificate path (`customTlsCertPath`)
    #### Custom key path (`customTlsKeyPath`)
  ### Auto-start (`autoStart`)
  ### Enable MCP resources (`resourcesEnabled`)
  ### Enable MCP prompts (`promptsEnabled`)
  ### DNS Rebind Protection              (h3 — UI subsection)
    #### Allowed origins (`allowedOrigins`)
    #### Allowed hosts (`allowedHosts`)
    #### Allow null origin (`allowNullOrigin`)
    #### Require Origin header (`requireOrigin`)
## MCP Client Configuration              (h2 — copy button explainer)
## Feature Modules                       (h2 — module table; updated)
  ### Extras                             (h3 — per-tool toggles)
## Execute Command Allowlist (`executeCommandAllowlist`)   (h2)
## Diagnostics                           (h2)
  ### Debug Mode (`debugMode`)
  ### Log file path                      (read-only)
  ### Copy debug info                    (action; not a persisted setting)
  ### Clear log                          (action; not a persisted setting)
## Settings Persistence                  (h2 — keep current paragraph)
```

## Entry template

Each persisted setting follows the existing convention already used for
`serverAddress`, `port`, etc.:

```markdown
### Display Name (`fieldName`)
- **Default**: `<value from DEFAULT_SETTINGS>`
- **Description**: <one or two sentences: what it does + the trade-off>
- **<other rows as needed>**: `Range`, `Validation`, `When visible`, etc.
```

`When visible` is added when the row is conditionally rendered:

| Setting               | Conditional render rule                           |
| --------------------- | ------------------------------------------------- |
| `accessKey`           | `authEnabled === true`                            |
| `iAcceptInsecureMode` | `authEnabled === false`                           |
| `tlsCertificate`      | `httpsEnabled === true && useCustomTls === false` |
| `useCustomTls`        | `httpsEnabled === true`                           |
| `customTlsCertPath`   | `httpsEnabled === true && useCustomTls === true`  |
| `customTlsKeyPath`    | `httpsEnabled === true && useCustomTls === true`  |

The `tlsCertificate` entry already exists in the doc and we keep its
wording per non-goals, but the rewrite adds a `**When visible**` row
to it so its conditional rendering is documented (small clarification,
not a re-write).

Read-only / action rows (Server URL, Server Status, Log file path,
Copy debug info, Clear log) get a short paragraph or `Setting` row
without the `Default` field, marked **Action** or **Read-only**.

## New entry copy (defaults + descriptions)

The descriptions below summarize behaviour from
[`src/types.ts`](../../../src/types.ts) JSDoc and the matching UI labels.
Lifted prose where the JSDoc already nails it.

### `authEnabled`
- **Default**: `true`
- **Description**: When on (the default since v10), the server requires
  a Bearer access key on every request. When off, the server only binds
  if `iAcceptInsecureMode` is also true; otherwise startup fails with a
  clear error.

### `iAcceptInsecureMode`
- **Default**: `false`
- **Description**: Explicit acknowledgement that running with auth
  disabled is acceptable. Required to bind when `authEnabled === false`.
  Existing pre-v10 installs that ran default-insecure are grandfathered
  to `true` by the v9 → v10 migration so they keep working after upgrade.
  Toggling auth back on clears this flag.
- **When visible**: `authEnabled === false`.

### `useCustomTls`
- **Default**: `false`
- **Description**: When on, the server loads a user-provided cert/key
  pair from disk (`customTlsCertPath` + `customTlsKeyPath`) instead of
  the auto-generated self-signed cert.
- **When visible**: `httpsEnabled === true`.

### `customTlsCertPath`
- **Default**: `null`
- **Description**: Absolute filesystem path to the user-provided public
  certificate (PEM). Validated on load via
  [`loadAndValidateCustomTls`](../../../src/server/custom-tls.ts);
  errors render inline under the row.
- **When visible**: `httpsEnabled === true && useCustomTls === true`.

### `customTlsKeyPath`
- **Default**: `null`
- **Description**: Absolute filesystem path to the user-provided private
  key (PEM). Must match `customTlsCertPath`; mismatches surface as
  inline errors.
- **When visible**: `httpsEnabled === true && useCustomTls === true`.

### `autoStart`
- **Default**: `false`
- **Description**: Start the MCP server automatically when Obsidian
  launches the plugin. Off by default so a fresh install doesn't open a
  network port until the user opts in.

### `resourcesEnabled`
- **Default**: `true`
- **Description**: Expose vault files as MCP resources
  (`obsidian://vault/{+path}` template + `obsidian://vault/index`
  static) in addition to tools. Turn off if your client doesn't speak
  the resources protocol or you want a tools-only surface.

### `promptsEnabled`
- **Default**: `true`
- **Description**: Expose canned slash-command prompts via the MCP
  prompts surface (`/summarize-note`, `/find-related`,
  `/expand-template`, etc.). Turn off if your client doesn't use
  prompts.

### `allowedOrigins`
- **Default**: `['http://127.0.0.1', 'http://localhost', 'https://127.0.0.1', 'https://localhost']`
- **Description**: Origins (scheme + host [+ port]) allowed to issue
  requests. Used to block DNS-rebind attacks. Listed one per line in the
  textarea. Adding a non-loopback origin surfaces a warning under the
  row.

### `allowedHosts`
- **Default**: `['127.0.0.1', 'localhost']`
- **Description**: Hostnames allowed to appear in the `Host` header.
  The port portion is stripped before comparison. Listed one per line.
  Adding a non-loopback host surfaces a warning under the row.

### `allowNullOrigin`
- **Default**: `false`
- **Description**: Accept requests with `Origin: null` (sandboxed
  iframes, `file://`). Off by default; turn on only if you understand
  the rebind-attack implications.

### `requireOrigin`
- **Default**: `false`
- **Description**: Reject requests that don't carry an `Origin` header.
  Off by default to keep `curl` and other native clients working;
  turn on for browser-only deployments.

### `executeCommandAllowlist`
- **Default**: `[]`
- **Description**: Allowlist of Obsidian command ids that
  `plugin_execute_command` is permitted to run. Empty (the default)
  means command execution is disabled and the tool refuses every call
  with a clear error. Listed one per line; example:
  ```
  app:reload
  editor:save-file
  ```

### `moduleStates` (Feature Modules + Extras)

Already represented by the module table. The new **Extras** subsection
adds:

> Modules in the `extras` group expose **per-tool** toggles instead of a
> single per-module toggle. Each tool can be turned on or off
> individually; the state is stored under
> `moduleStates[<moduleId>].toolStates[<toolName>]` in `data.json`.
> Today the only Extras module ships `extras_get_date`.

## Module table — updated counts

```markdown
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
```

Order matches `docs/tools.generated.md` (registry order). A short
sentence above the table points readers at `docs/tools.generated.md`
for the per-tool list (already the convention used in `docs/help/en.md`).

## Verification

After the rewrite:

- Every key in `DEFAULT_SETTINGS` except `schemaVersion` and
  `seenInsecureWarning` appears in `docs/configuration.md` as a fenced
  `### … (\`key\`)` heading. Cross-check with:
  ```bash
  grep -oE '\(`[a-zA-Z]+`\)' docs/configuration.md | sort -u
  ```
- Defaults documented match `DEFAULT_SETTINGS` literal values
  (manual diff during review).
- Module-table rows match `docs/tools.generated.md` row-for-row (same
  module names, same counts, same order). Total = 50.
- `npm run lint`, `npm test`, `npm run typecheck` are green (sanity;
  no source changes expected).
- CI's `docs:check` step is green.

## Acceptance criteria (from #319)

- [x] `docs/configuration.md` covers every persisted settings field
      that has a UI row (cross-check against `src/settings/*-section.ts`).
      → Settings inventory + new outline.
- [x] Module / tool counts in `docs/configuration.md` match
      `docs/tools.generated.md`. → Module table section.
- [x] Defaults documented for each setting match `DEFAULT_SETTINGS`
      in `src/types.ts`. → Entry template + new entry copy.

## Branch & commits

- Branch: `docs/issue-319-reconcile-configuration-md`
- Single commit `docs(configuration): cover missing settings and reconcile module counts`
  — the rewrite is one logical concern (PRD reconciliation, mirroring
  the issue). Body references `Refs #319`.

## Risks

- None to runtime behaviour — pure documentation.
- The module-table counts remain hand-maintained; CI doesn't validate
  them against `tools.generated.md`. Same risk as the `en.md` Feature
  Modules table — out of scope for this issue.
- The "When visible" rows describe conditional UI rendering; if those
  conditions change in `src/settings/*-section.ts` the doc will drift
  silently. Acceptable: the conditions are stable parts of the auth /
  HTTPS lifecycle.
