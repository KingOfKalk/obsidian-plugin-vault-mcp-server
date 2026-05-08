# Product Requirements Document — Obsidian MCP Plugin

## Overview

This Obsidian plugin runs an MCP (Model Context Protocol) server inside Obsidian Desktop. It exposes vault operations, search, editor, workspace, UI, templates, and plugin interop as MCP tools over Streamable HTTP. AI agents (Claude, Codex, etc.) connect to this server with an access key and interact with Obsidian programmatically. The plugin is desktop-only, written in TypeScript, and licensed under GPL v3.

## ID Governance

- Never delete an ID — if a requirement is removed, ~~strikethrough~~ it instead
- Never reuse an ID — once assigned, it is permanently taken even if struck through
- New IDs only — when consolidating or replacing requirements, assign a new ID
- New/replacement requirements must explain why and reference the struck-through ID(s) they supersede

## Feature Categories

Each category is a toggleable module. Modules self-register. The settings UI auto-discovers them. A "Refresh" button re-discovers modules without restarting Obsidian. Toggling a module is all-or-nothing — when on, every tool the module ships is exposed.

### Vault and File Operations

- **R1** — Create a new file with specified path and content
- **R2** — Read the full content of a file by path
- **R3** — Update (overwrite) the content of an existing file
- **R4** — Delete a file by path
- **R5** — Append content to the end of an existing file
- **R6** — Rename a file (same folder, new name)
- **R7** — Move a file to a different folder
- **R8** — Copy a file to a new path
- **R9** — Create a folder
- **R10** — Delete a folder (with option for recursive)
- **R11** — Rename or move a folder
- **R12** — List files and folders at a given path (non-recursive)
- **R13** — List files and folders recursively from a given path
- **R14** — Read binary file content (base64 encoded)
- **R15** — Write binary file content (from base64)
- **R16** — Get file metadata (size, creation date, modification date) — *audit (2026-05-07): `vault_get_metadata` response also includes `path` alongside size/created/modified.*
- **R58** — `vault_daily_note` opens (or creates) the daily note. The tool reads the daily-notes core plugin's configured folder, format, and template; resolves the target path for an optional `date` argument (`YYYY-MM-DD`, defaulting to today in local time); creates the note from the template on first call for that date and reuses it on later calls. Returns structured `{ path, created, content }` so callers know whether they triggered the create branch. Errors with `Plugin API unavailable for daily-notes` when the core plugin is disabled and `date must be a valid calendar date` for malformed input. Implemented in `src/tools/vault/index.ts` and `src/tools/vault/handlers.ts` (per #313).

### Search and Metadata

- **R17** — Full-text search across vault contents with query string
- ~~**R18** — Query frontmatter properties for a given file~~
- **R19** — Query all tags in the vault with file associations
- ~~**R20** — Query headings for a given file~~
- ~~**R21** — Query all outgoing links for a given file~~
- ~~**R22** — Query all embeds for a given file~~
- ~~**R23** — Get all backlinks for a given file~~
- **R24** — Get resolved links across the vault
- **R25** — Get unresolved links across the vault
- ~~**R26** — Query block references for a given file~~
- **R27** — Search files by tag
- **R28** — Search files by frontmatter property value
- **R56** — Query a single per-file metadata aspect (frontmatter, headings, outgoing links, embeds, backlinks, or block references) via the unified `vault_get_aspect` tool, which takes a `path` plus an `aspect` enum and returns a discriminated-union payload keyed on that aspect. Supersedes ~~R18~~ (frontmatter), ~~R20~~ (headings), ~~R21~~ (outgoing links), ~~R22~~ (embeds), ~~R23~~ (backlinks), and ~~R26~~ (block references), which were collapsed from six separate `vault_get_*` tools into one in PR #307.

### Editor Operations

- **R29** — Get the content of the currently active editor
- **R30** — Get the currently active file path
- **R31** — Insert text at a specified position (line, column)
- **R32** — Replace text in a specified range (start line/col to end line/col)
- **R33** — Delete text in a specified range
- **R34** — Get the current cursor position
- **R35** — Set the cursor position
- **R36** — Get the current text selection (start, end, selected text)
- **R37** — Set the selection range
- **R38** — Get the total line count of the active editor

### Workspace and Navigation

- **R39** — Get the active leaf (pane) info
- **R40** — Open a file in a specified pane (new tab, split, or existing)
- **R41** — List all open files and panes with their leaf IDs
- **R42** — Set focus on a specific leaf by ID
- **R43** — Get the current workspace layout summary

### UI Interactions

- **R44** — Show a notice/notification with a message and optional duration
- ~~**R45** — Show a confirmation modal (yes/no) and return the user response~~
- ~~**R46** — Show an input prompt modal and return the user-entered text~~

### Templates and Content Generation

- **R47** — List available templates from the configured templates folder
- **R48** — Create a new file from a template with variable substitution
- **R49** — Process and expand template variables in a given string (date, title, etc.)

### Plugin Interop

- **R50** — List installed community plugins with enabled/disabled status
- **R51** — Check if a specific plugin is installed and enabled
- **R52** — Execute a Dataview query and return results (if Dataview is installed)
- ~~**R53** — Execute a Templater template (if Templater is installed)~~
- **R57** — Describe (do not execute) a Templater template via `plugin_templater_describe_template`. The tool echoes the supplied template path with a note explaining that the server intentionally does not execute Templater itself (Templater can run arbitrary user JS, so execution must stay client-side). Replaces ~~R53~~ because the shipped tool is describe-only, not an execution surface.
- **R54** — Provide a generic plugin command execution interface
- **R59** — Describe (do not execute) a Dataview-JS query via `plugin_dataview_describe_js_query`. The tool echoes the supplied JS source plus a fixed note explaining that the server intentionally does not evaluate Dataview-JS (running the source would arbitrary-eval user input against the host `app` handle), so execution must stay client-side. Sits next to **R52** (`plugin_dataview_query`, which executes DQL) and is the JS-source counterpart to **R57** (`plugin_templater_describe_template`). Implemented in `src/tools/plugin-interop/index.ts` (per #250 option B).

### Extras

Utility tools that do not mirror an Obsidian API. Modules in this group render under a separate "Extras" heading in the settings UI (not under "Feature Modules"). Unlike core feature modules, Extras modules are not toggled as a single unit: the settings UI renders one toggle **per tool** within the Extras group, and the registry stores per-tool enable state on the module. All Extras tools are disabled by default — users opt in one tool at a time.

- **R55** — `extras_get_date` tool returns the current local datetime as a plain ISO-8601 string with timezone offset (e.g. `2026-04-16T14:32:05.123+02:00`). The offset is already encoded in the string, so no additional fields are returned. Disabled by default. Belongs to the "Extras" module group.

### Internationalization (I18N)

The plugin UI is translated via a tiny in-house i18n helper modelled on the [obsidian-kanban pattern](https://github.com/mgmeyers/obsidian-kanban/blob/main/src/lang/helpers.ts) — zero runtime dependencies, all translations compiled into the plugin bundle. See `src/lang/helpers.ts` for the `t()` function and `src/lang/locale/` for per-locale maps.

- **I1** — Plugin UI strings support multiple locales. English and German ship out of the box (`src/lang/locale/en.ts`, `src/lang/locale/de.ts`). `en` is the source of truth; other locales are `Partial<Record<keyof typeof en, string>>` maps.
- **I2** — The active locale is auto-detected via `window.localStorage.getItem('language')` (the key Obsidian itself writes). No in-plugin settings override in this iteration — the plugin simply follows Obsidian's own language setting.
- **I3** — Missing keys in non-English locales fall back to the English value at runtime. If the detected locale is not registered in the locale map, `t()` logs a single `console.error` and returns the English value. `t()` is typed as `t(key: keyof typeof en, params?: Record<string, string | number>): string`, so a missing/misspelled key is a TypeScript compile error.
- **I4** — MCP tool names, tool descriptions, input schemas, and MCP error payloads remain English-only. These surfaces are LLM-facing (agents, not humans), and keeping them English maximizes tool-selection quality and MCP interop stability. Structured log output is also English by convention.

## Configuration

### Server Settings

- **CR1** — Configurable HTTP port with default value 28741
- **CR2** — Access key field for authentication (user-provided, with a "Generate" button for convenience). The Generate button produces a new access key by calling Node's `crypto.randomBytes(32)` and rendering the 32 random bytes as a 64-character lowercase hex string, then overwrites the stored access key and re-renders the settings tab. The Access Key row only renders when **CR24** ("Require Bearer authentication") is on; with auth disabled the row is hidden because the key has no effect. — *audit (2026-05-07): the plugin's `onload` also auto-generates a key on first load when `authEnabled === true && accessKey === ''` (`src/main.ts:142-147`); that path uses `randomBytes(32).toString('base64url')` rather than the Generate button's hex encoding, so first-install keys differ in shape from regenerated ones*
- **CR3** — Toggle between HTTP and HTTPS (self-signed certificate), HTTP by default
- **CR4** — Debug mode toggle that enables verbose logging
- **CR17** — Configurable server IP address (default `127.0.0.1`). Must validate IPv4 format. Settings UI shows a security warning when bound to a non-localhost address. Requires server restart to take effect.
- **CR19** — Auto-start on launch toggle. Defaults to off. When on, the plugin's `onload` starts the MCP server automatically during plugin load. The auto-start gate respects **CR24**: if Bearer auth is enabled but no access key is configured, the server is left stopped and the plugin logs an `info` entry explaining why; if Bearer auth is disabled, no access key is required for auto-start. Users must explicitly opt in per install. — *audit (2026-05-07): with the v10 secure-by-default flip the gate also refuses to auto-start when `authEnabled === false && iAcceptInsecureMode !== true`; see `canBindServer` in `src/main.ts:174-179` and **CR28***
- **CR20** — Server URL row displays the current `http://<address>:<port>/mcp` URL in its description and exposes a clipboard-copy extra button ("Copy server URL") that writes that URL to the clipboard and shows a confirmation Notice.
- ~~**CR24** — "Require Bearer authentication" toggle in Server Settings. Defaults to **off** so a fresh install can be used without first generating an access key. When off, `authenticateRequest` short-circuits and the server accepts every request regardless of the `Authorization` header; the Access Key row (CR2) is hidden, and the MCP client configuration snippet (CR21) omits the `headers`/`Authorization` entry. When on, the existing CR2 access key field is rendered and **NFR5** Bearer enforcement applies. Persisted as `authEnabled` in the v6 settings schema (see Appendix A).~~
- **CR28** — "Require Bearer authentication" toggle in Server Settings. Replaces ~~CR24~~. Defaults to **on** (secure-by-default, flipped from the original off in the v9 → v10 settings migration; see Appendix A). On a fresh install with `authEnabled === true && accessKey === ''`, the plugin's `onload` auto-generates a 32-byte access key (rendered as base64url, see CR2 audit) and persists it before the settings UI ever renders — the user does not have to click Generate. When off, `authenticateRequest` short-circuits and the server accepts every request regardless of the `Authorization` header; the Access Key row (CR2) is hidden, the MCP client configuration snippet (CR21) omits the `headers`/`Authorization` entry, and the explicit "I accept insecure mode" acknowledgement (**CR29**) is required for the server to bind at all. When on, the existing CR2 access key field is rendered and **NFR5** Bearer enforcement applies. Toggling auth back on clears any previously persisted `iAcceptInsecureMode` flag so the user has to opt into insecure mode again if they later turn auth back off (`src/settings/server-section.ts:200-202`). Persisted as `authEnabled`; the default flip happens in the v10 migration, which also grandfathers existing default-insecure installs into `iAcceptInsecureMode === true` so they keep working after upgrade (see Appendix A).
- **CR29** — "I accept insecure mode" acknowledgement toggle in Server Settings. Only renders when **CR28** is off. Defaults to **off**. Persisted as `iAcceptInsecureMode`. Acts as the explicit opt-in gate for running the server without Bearer authentication: `canBindServer` (`src/main.ts:174-179`) refuses to bind unless either CR28 is on with a non-empty access key, or CR28 is off and CR29 is on; `startServer` (`src/main.ts:185-191`) surfaces a `Notice` and aborts when this gate fails. Toggling CR28 back on auto-clears CR29 (see CR28). Existing installs that were running default-insecure pre-v10 are grandfathered to `iAcceptInsecureMode === true` by the v9 → v10 migration so they keep working after upgrade; the plugin then surfaces a one-time `Notice` (tracked via the internal `seenInsecureWarning` flag) on next load to inform them of the new posture.
- **CR25** — "Bring your own certificate" toggle in Server Settings, only rendered when HTTPS (CR3) is enabled. Defaults to **off**. When off, the plugin keeps the auto-generated self-signed behaviour from CR3 and the cached `tlsCertificate` (CR3 + v5 schema). When on, a new "Own SSL certification" group appears with the rows defined in CR26 and CR27, and the "Regenerate cert" control for the self-signed path is hidden. Persisted as `useCustomTls` in the v7 settings schema (see Appendix A).
- **CR26** — "Public certificate (PEM)" row inside the CR25 group. The row description shows the currently selected absolute path, or an "No file selected" placeholder when unset. A "Browse…" button opens the host OS native file-open dialog via Electron's `showOpenDialog`, filtered to `.pem/.crt/.cer` plus an "All files" option. Selecting a file persists the absolute path as `customTlsCertPath`. Inline validation errors are rendered via the existing `createValidationError()` helper and cover the failure codes defined in NFR34.
- **CR27** — "Private key (PEM)" row inside the CR25 group. Behaviour mirrors CR26 but for the private key (`.pem/.key` filter), persisted as `customTlsKeyPath`. After a successful pick on either row the plugin re-runs the NFR34 validation against the pair; errors are rendered on the offending row (or on both rows when the error is `key_cert_mismatch`).
- **CR30** — "Enable MCP resources" toggle in Server Settings. Persisted as `resourcesEnabled` (v11 schema). Defaults to **on**. When on, `createMcpServer` advertises the `resources` capability on the initialize handshake and registers the `obsidian://vault/index` static resource plus the `obsidian://vault/{+path}` template (see **TR28**); when off, the resources capability is omitted entirely so MCP clients see a tools-only server. Rendered as a top-level Server Settings row, not via the dynamic module-toggle system (CR12), because resources are a transport-level surface rather than a feature module. Implemented in `src/settings/server-section.ts`.
- **CR31** — "Enable MCP prompts" toggle in Server Settings. Persisted as `promptsEnabled` (v12 schema). Defaults to **on**. When on, `createMcpServer` advertises the `prompts` capability on the initialize handshake and registers the canned slash-command prompts (see **TR29**); when off, the prompts capability is omitted. Same rationale as CR30: a transport-level surface rendered as a separate Server Settings row, not part of CR12's dynamic module-toggle system. Implemented in `src/settings/server-section.ts`.
- **CR32** — "Execute Command Allowlist" section, rendered by `src/settings/allowlist-section.ts` after the Server Settings section. A textarea lists Obsidian command ids one per line; on `change` the lines are trimmed, blanks dropped, and the result persisted as `executeCommandAllowlist` (v8 schema). The list is consumed by `plugin_execute_command` (R54): an empty list disables the tool entirely (every call is refused with a clear error), and a non-empty list whitelists exactly those command ids — anything else is rejected with `Command "<id>" is not on the executeCommand allowlist`.
- **CR33** — "DNS Rebind Protection" subsection inside Server Settings, rendered by `renderDnsRebindSection` in `src/settings/server-section.ts` after the auth/HTTPS/auto-start rows. Four user-facing rows: an "Allowed origins" textarea persisted as `allowedOrigins`; an "Allowed hosts" textarea persisted as `allowedHosts`; an "Allow Origin: null" toggle persisted as `allowNullOrigin`; and a "Require Origin header" toggle persisted as `requireOrigin`. Both textareas surface an inline warning (`warning_non_loopback_origin` / `warning_non_loopback_host`) whenever an entry resolves to anything other than the loopback variants, so users explicitly acknowledge widening the allowlist. Defaults match the v9 schema migration (loopback-only, see Appendix A). The settings feed `validateOriginHost` (see **NFR38**).

### Feature Access Control

- ~~CR5~~ — ~~Toggle to enable/disable Vault and File Operations~~
- ~~CR6~~ — ~~Toggle to enable/disable Search and Metadata~~
- ~~CR7~~ — ~~Toggle to enable/disable Editor Operations~~
- ~~CR8~~ — ~~Toggle to enable/disable Workspace and Navigation~~
- ~~CR9~~ — ~~Toggle to enable/disable UI Interactions~~
- ~~CR10~~ — ~~Toggle to enable/disable Templates and Content Generation~~
- ~~CR11~~ — ~~Toggle to enable/disable Plugin Interop~~
- **CR12** — Dynamic feature toggle system: modules self-register with metadata (name, description, tool list), settings UI auto-discovers and renders one enable/disable toggle per module, "Refresh" button to re-discover without restart. Replaces ~~CR5~~–~~CR11~~, consolidated into dynamic system. (Per-module read-only mode was removed in v4 settings — see schema migration.)

### Server Controls

- ~~CR16~~ — ~~Settings UI provides dedicated Start, Stop, and Restart buttons for MCP server lifecycle management. The Stop button is only enabled when the server is running. The Start button is only enabled when the server is stopped. The Restart button is only enabled when the server is running.~~
- **CR18** — Settings UI "Status" row exposes server lifecycle as a single running/stopped toggle: flipping the toggle on starts the server, flipping it off stops it. While the server is running, a refresh-icon extra button appears on the same row to restart the server; this restart control is not rendered while the server is stopped. Replaces ~~CR16~~ — the shipped UI never implemented three separate Start/Stop/Restart buttons; it uses the simpler toggle plus conditional restart control instead.

### MCP Client Configuration

- **CR21** — Settings UI contains an "MCP Client Configuration" section with a clipboard-copy extra button that copies a ready-to-paste JSON snippet for the `mcpServers` entry of Claude Desktop / Claude Code config files. The snippet is derived live from the current `serverAddress`, `port`, `authEnabled`, and `accessKey`: it always includes the MCP endpoint URL (`http://<address>:<port>/mcp`) and, only when Bearer auth is enabled (CR24) **and** the access key is non-empty, a `headers` object with `Authorization: Bearer <key>`. The copy action shows a confirmation Notice. — *audit (2026-05-07): the `authEnabled && accessKey` conditional is unchanged in code, but with the v10 secure-by-default flip plus first-load auto-generation (see CR2 audit) fresh installs always satisfy both branches, so the `headers` block is effectively always present unless the user explicitly disables auth* — *audit (2026-05-08): the snippet now also always includes a `"type": "http"` field at the top of the entry so Claude Code (which ignores entries without a transport type) loads the server on first paste — see issue #326 and `src/settings/mcp-config-section.ts:43`*

### Diagnostics

- **CR22** — Settings UI exposes a "Diagnostics" section rendered after the Feature Modules / Extras sections. It contains three rows: a Log File row whose description shows the relative path to the persistent debug log (see CR23); a "Copy debug info" row with an extra button that opens a modal preview of the debug bundle (read-only textarea with Copy and Close buttons); and a "Clear log" row with an extra button that empties the log file and shows a confirmation Notice.
- **CR23** — The plugin persists structured log output to `<vault>/.obsidian/plugins/<plugin-id>/debug.log` via Obsidian's vault adapter (`app.vault.adapter`), not Node `fs`. Level gating mirrors console output: `info` and above always written, `debug` only when Debug Mode (CR4) is on. Writes are serialized through a single in-flight Promise chain so concurrent log calls do not interleave. Single-file rotation: when the file exceeds 1 MiB, the next write trims it to the most recent 512 KiB and prepends a `--- rotated ---` marker on its own line. No multi-file backups (`.1`, `.2`, …) are kept. Errors writing to the log are swallowed so logging never throws.

### Settings Persistence

- **CR13** — All settings persisted in Obsidian's plugin data.json
- **CR14** — Settings migration strategy between plugin versions (versioned schema — see Appendix A: Settings Schema Migrations)
- **CR15** — Sensible defaults for all settings on first install

## Non-Functional Requirements

### Performance

- **NFR1** — File listing operations handle vaults with 10,000+ files without UI freezing
- **NFR2** — Search operations on large vaults return results within 5 seconds
- **NFR3** — Server startup completes within 2 seconds
- **NFR4** — Plugin adds no noticeable latency to Obsidian startup

### Security

- **NFR5** — Bearer-token authentication is opt-in and controlled by **CR24** (`authEnabled`, default off). When enabled, every MCP request must carry a valid `Authorization: Bearer <key>` header; enforcement happens in `authenticateRequest` before any request-routing logic, including the MCP `initialize` handshake and any subsequent `mcp-session-id`-keyed calls. With auth enabled and no access key configured, every request is rejected with an authentication error. When `authEnabled` is off, `authenticateRequest` short-circuits and accepts every request — operators must rely on network controls (localhost-only binding, firewall) instead. CORS preflight (`OPTIONS`) requests are handled earlier and never reach the auth check in either mode. — *audit (2026-05-07): cross-reference rot — CR24 is struck-through and superseded by **CR28** (auth default-on since v10); bearer compare uses `crypto.timingSafeEqual` and per-IP failed-auth attempts are rate-limited via `FailureRateLimiter` (returns HTTP 429 + `Retry-After`).*
- **NFR6** — CORS headers configurable and restrictive by default — *audit (2026-05-07): CORS still applies (defaults in `src/server/cors.ts`); a separate DNS-rebind hardening surface in `src/server/origin-host.ts` validates `Origin` and `Host` against loopback allowlists ahead of CORS — distinct from CORS and not currently captured by this NFR.*
- ~~NFR7~~ — ~~Disabled feature categories reject requests with 403, not just hide tools~~
- **NFR30** — Disabled feature modules (and, for Extras, individually disabled tools) are filtered out of the MCP tool list advertised to clients. A client that invokes a tool from a disabled module receives the standard MCP unknown-tool error from the SDK; the plugin does not emit an HTTP 403 for feature-gating. Replaces ~~NFR7~~ because the implemented contract is "hide disabled tools at `tools/list` time", not "reject with HTTP 403".
- **NFR8** — File operations scoped to the vault directory (no path traversal)
- **NFR9** — Self-signed HTTPS certificate generated locally, never transmitted
- **NFR10** — Access key never appears in logs even in debug mode. The `Logger` enforces this by substituting the configured access key with the literal placeholder `[REDACTED]` in every formatted message string and every string reached recursively inside structured log data before the entry is emitted. `updateOptions` keeps the redaction key in sync with the current settings.
- **NFR32** — The HTTP transport caps individual request bodies at 4 MiB. Requests whose body exceeds `MAX_BODY_BYTES` are rejected with a JSON-RPC `-32700` ("Parse error: Request body too large") response and the underlying socket is destroyed mid-upload to avoid buffering unbounded input. Implemented in `src/server/http-server.ts` (`readJsonBody`).
- **NFR34** — When CR25 is on, the plugin reads the two user-provided PEM files with `node:fs/promises` and validates them with `node:crypto` (`createPrivateKey`, `createPublicKey`, `X509Certificate`) on every server start and after each path change in the settings UI. Validation confirms all of: both files are readable; both parse as PEM; the private key's derived SPKI (PEM export) equals the certificate's SPKI; the certificate is not past its `validTo`. On any failure the server refuses to start and surfaces the specific error code (`cert_not_readable`, `key_not_readable`, `invalid_cert`, `invalid_key`, `key_cert_mismatch`, `cert_expired`) to the user via `Notice` and inline validation row. The cached auto-generated cert (NFR9) is not modified or regenerated during this path.
- **NFR33** — The "Copy debug info" bundle (CR22) is plain text and never includes secret material. The access key is rendered as the literal placeholder `<set>` or `<empty>` (never the configured value), and the cached TLS certificate is rendered as `<present>` or `<absent>` (never the PEM contents). The recent-log tail included in the bundle is read straight from `debug.log` (CR23), which is already redacted at write time by the `Logger` per NFR10, so no additional scrubbing is performed on the tail.
- **NFR38** — DNS-rebind protection: every inbound HTTP request is screened by `validateOriginHost` (`src/server/origin-host.ts`) before CORS preflight, auth, or routing. The check rejects any request whose `Host` header (port stripped) is not on `allowedHosts`, and any request whose `Origin` header is present but not on `allowedOrigins` (case-insensitive, trailing-slash trimmed). `Origin: null` is rejected unless `allowNullOrigin === true`; missing `Origin` is allowed unless `requireOrigin === true`. Rejected requests get HTTP 403 with the failure reason in the JSON body and a structured `warn` log entry capturing IP, method, path, origin, host, and reason. CORS headers are still applied to the rejection so browsers surface a clearer failure message. Defaults are loopback-only per the v9 settings migration (see Appendix A); user-facing controls live in **CR33**. Distinct from **NFR6** (CORS) because the surface guards against attacker-controlled hostnames that resolve to `127.0.0.1` even when CORS would otherwise allow the request (per #246).
- **NFR39** — Per-IP rate limiting on bearer-auth failures: `FailureRateLimiter` (`src/server/rate-limiter.ts`) tracks failed `Authorization: Bearer` attempts per normalized remote address and, after `maxFailures` (default 5) inside a `windowMs` rolling window (default 60 s), blocks that IP for `blockMs` (default 30 s). Blocked requests get HTTP 429 with a `Retry-After` header (seconds) and never reach the auth comparator, so brute-force keys against the configured access key cost at least 30 s per 5 attempts. A successful authentication clears the IP's record. The internal table is bounded by `maxEntries` (default 1000) with insertion-order eviction so a flood of unique source IPs cannot exhaust memory. Wired in `src/server/http-server.ts` ahead of `authenticateRequest`; only runs when **CR28** is on. Pairs with **NFR5**'s `crypto.timingSafeEqual` bearer comparison.

### Reliability

- **NFR11** — HTTP server starts when plugin loads and stops when plugin unloads
- **NFR12** — Graceful shutdown: finish in-flight requests, then close connections
- **NFR13** — Port conflict recovery with clear error message to the user (see **NFR36** for the status bar surface, **CR18** for the toggle behaviour, and the inline error under the Port field in settings)
- **NFR14** — Handle Obsidian API unavailability gracefully (e.g., vault not ready at startup)

### Concurrency

- **NFR15** — Support multiple simultaneous MCP client connections
- **NFR16** — Concurrent file write operations to the same file are serialized or rejected with a conflict error
- **NFR17** — Editor operations queued on the main thread (Obsidian UI thread constraint)

### Testability

- **NFR18** — All Obsidian API interactions go through an abstraction layer that can be mocked
- **NFR19** — Plugin passes MCP Inspector validation for all exposed tools. (Aspirational: Inspector is run manually during development; no CI job runs Inspector today.)
- **NFR20** — Unit tests for business logic (tool handlers, validation, auth) are executed with coverage collection in CI via `npm run test:coverage`. A specific numeric coverage floor is aspirational; the CI workflow collects and reports coverage but does not fail below a fixed percentage today.

### Maintainability

- **NFR21** — Modular architecture: each feature category is a self-contained module
- **NFR22** — Adding a new MCP tool requires no changes to the server core
- **NFR23** — Fully dynamic toggle system: modules self-register with metadata, settings UI auto-discovers and renders toggles, no hardcoded toggle list

### Observability

- **NFR24** — Structured logging with levels: debug, info, warn, error
- **NFR25** — Debug mode logs all incoming MCP requests and outgoing responses
- **NFR26** — Server status (running, port, connected clients) visible in the settings tab
- ~~NFR31~~ — ~~Plugin registers an Obsidian status bar item that displays `MCP :<port>` while the MCP server is running and renders as empty text while the server is stopped. The status bar text is refreshed on every start/stop transition so users can see at a glance whether the server is live and on which port without opening settings.~~
- **NFR36** — Plugin registers an Obsidian status bar item that renders one of three states: `MCP :<port>` while the MCP server is running; empty text while the server is stopped and no start has failed; `MCP :<port>` wrapped in a span with class `mcp-statusbar-error` (strike-through + error colour) plus a `title`/`aria-label` tooltip describing the error when the last start attempt failed (e.g. because the port was already in use). The failed state is sticky — it persists until the next successful start, an explicit stop, or a port change — and the tooltip uses the `status_bar_port_in_use` i18n key. Replaces ~~NFR31~~ because the shipped behaviour now distinguishes "stopped" from "failed to start", which users previously could not see without opening settings. Pairs with the inline port-in-use error under the Port field in **Server Settings** (uses the existing `mcp-settings-error` class, shown only when the recorded failure port matches the currently configured port).

### Documentation Sync

- ~~NFR34~~ — ~~The end-user manual at `docs/help/en.md` (and any sibling locale files under `docs/help/`) MUST stay in sync with every user-facing surface shipped by the plugin: settings/toggles, command palette entries, ribbon icons, status bar items, modals, MCP modules and tools, installation flow, and known errors that warrant FAQ coverage. Any PR that adds, removes, renames, or changes the behaviour of one of these surfaces MUST update the manual in the same PR; reviewers reject PRs that change user-facing behaviour without a corresponding manual update. Adding a new translation locale to the plugin UI (see I1) implies adding the matching `docs/help/<locale>.md` file, with English remaining the source of truth for content (mirroring I3).~~ — *audit (2026-05-07): duplicate ID — NFR34 is already used in the Security subsection for TLS validation; this Documentation-Sync entry was a numbering mistake, not a behaviour change. Replaced by **NFR37**.*
- **NFR37** — The end-user manual at `docs/help/en.md` (and any sibling locale files under `docs/help/`) MUST stay in sync with every user-facing surface shipped by the plugin: settings/toggles, command palette entries, ribbon icons, status bar items, modals, MCP modules and tools, installation flow, and known errors that warrant FAQ coverage. Any PR that adds, removes, renames, or changes the behaviour of one of these surfaces MUST update the manual in the same PR; reviewers reject PRs that change user-facing behaviour without a corresponding manual update. Adding a new translation locale to the plugin UI (see I1) implies adding the matching `docs/help/<locale>.md` file, with English remaining the source of truth for content (mirroring I3). Supersedes the duplicate-numbered ~~NFR34~~ documentation-sync entry; the original ID is preserved per ID Governance even though the duplication was a numbering mistake.
- **NFR35** — Supported locales for the localized screenshot pipeline are declared in `.supported-locales.yml` at the repo root. It is the single source of truth for both (a) `docker/scripts/docs_screenshots.py`, which generates `docs/screenshots/<locale>/settings.png` in the listed order, and (b) the `docs-screenshots` GitHub Actions workflow, which on `release: published` captures each locale, rewrites the `<!-- BEGIN: screenshot-settings --> … <!-- END: screenshot-settings -->` block in the matching `docs/help/<locale>.md` (if present) to reflect the release's version in alt text and caption, and commits the results to `main`. Adding a locale to the list without a sibling `docs/help/<locale>.md` is allowed — the PNG is still produced, and the manual reference activates once the locale's manual ships (see NFR34 / I1). The initial list is `en, de`. Committing image files outside `docs/screenshots/<locale>/` remains forbidden per the project's image policy (CLAUDE.md rule 4).

### Compatibility

- **NFR27** — Minimum Obsidian version: document chosen version at development start (recommend latest stable)
- **NFR28** — Follow Obsidian community plugin guidelines for eventual submission
- **NFR29** — MCP SDK version 1.x pinned (document exact version in package.json)

## Technical Requirements

### Project Structure

- **TR1** — TypeScript strict mode, no `any` types unless explicitly justified
- **TR2** — esbuild as the bundler producing a single main.js output
- **TR3** — manifest.json following Obsidian plugin specification (id, name, version, minAppVersion, description, author, isDesktopOnly) — *audit (2026-05-07): current `id` is `vault-mcp-server` (renamed from `obsidian-mcp-server` in #308); `name` is `Vault MCP Server`*
- **TR4** — versions.json mapping plugin versions to minimum Obsidian versions
- **TR5** — ESLint with a strict TypeScript config
- **TR6** — Prettier for code formatting with config committed to repo
- **TR7** — Source organized by feature category (e.g., src/tools/vault/, src/tools/search/)

### MCP Server

- **TR8** — Streamable HTTP transport using @modelcontextprotocol/sdk
- **TR9** — Tool registration system: each feature category registers its tools via a common interface
- **TR10** — Input validation on all tool parameters using Zod schemas
- **TR11** — Standardized error responses following MCP error format
- **TR12** — MCP capability negotiation on connection handshake
- **TR28** — MCP resources surface for vault files (per #303). When `resourcesEnabled` (CR30) is on, `createMcpServer` advertises the `resources` capability on the initialize handshake and registers two resources via `src/server/resources.ts`: a static `obsidian://vault/index` resource that returns a JSON listing of every file and folder in the vault (with ready-to-use `obsidian://vault/{+path}` URIs, mime types, and sizes; truncated past 25 000 characters with a `truncated: true` flag) and a templated `obsidian://vault/{+path}` resource that reads any vault file by path — text mime types (`text/*`, `application/json`, `application/yaml`, `image/svg+xml`) return `TextResourceContents`, and other types up to 1 MiB return base64 `BlobResourceContents`. URIs go through `validateVaultPath` so traversal protection matches the tool surface, and unknown extensions fall back to `application/octet-stream`.
- **TR29** — MCP prompts (slash-commands) surface (per #306, #313, #314). When `promptsEnabled` (CR31) is on, `createMcpServer` advertises the `prompts` capability and `src/server/prompts.ts` registers five canned prompts: `summarize-note` (read a note and produce a concise summary), `find-related` (cross-reference a note against backlinks and full-text search), `expand-template` (discover `{{placeholders}}` in a template via `extractPlaceholders` and walk the user through filling them, with completion against the configured templates folder), `daily-note` (resolve, create-if-missing, and open today's daily note via `vault_daily_note` + `workspace_open_file`, with optional `date: YYYY-MM-DD`), and `fix-broken-links` (enumerate unresolved wikilinks vault-wide or for one note via `search_unresolved_links` and walk through retarget/stub/delete fixes one tool call at a time, with completion against the unresolved-links sources). Path arguments use the SDK's `completable` wrapper so MCP clients can offer typeahead.
- **TR30** — Server-level `instructions` field on the MCP initialize handshake (per #301). `createMcpServer` passes a fixed `SERVER_INSTRUCTIONS` string (`src/server/mcp-server.ts`) into the `McpServer` constructor's options. The string contains short tool-use hints that per-tool descriptions cannot convey on their own — preferring `search_*` over `vault_read` when the path is unknown, scoping `editor_*` tools to the active file, the vault-relative-with-forward-slashes path convention, and the unified `vault_get_aspect` tool for frontmatter/headings/links/embeds/backlinks/block-refs. Intentionally short because the tokens are paid every conversational turn.
- **TR31** — Output schemas on read tools (per #288). Read-style tools that emit `structuredContent` declare an `outputSchema` next to their input `schema`, and `registerTool` forwards it to the SDK. Modern MCP clients use the schema to validate and introspect typed payloads while existing `result.content[0].text` callers see no change. Examples include `vault_read`, `vault_get_metadata`, `vault_list`, `vault_list_recursive`, `vault_read_binary`, `vault_get_aspect` (a discriminated union on `aspect`), `plugin_list`, `plugin_check`, `plugin_dataview_query`, `plugin_dataview_describe_js_query`, and `plugin_templater_describe_template` — see `src/tools/vault/index.ts` and `src/tools/plugin-interop/index.ts`.
- **TR32** — Tool titles and sibling cross-references in tool descriptions (per #296, #310–#312). Every `defineTool` call sets a short human-readable `title` (e.g. `Read file`, `Get file aspect`, `Run Dataview query`), which `registerTool` forwards to the SDK both as the top-level `title` and inside `annotations.title` so MCP clients can surface it in their UI. Tool descriptions composed via `describeTool` accept an optional `seeAlso` list that is rendered into the description body as a "See also" section pointing at related tools (e.g. `vault_read` references `editor_get_content`, `vault_list` references `vault_list_recursive`, `editor_set_cursor` references `editor_set_selection`, `editor_get_active_file` references `workspace_get_active_leaf`, `template_create_from` references `template_expand`). Helps the LLM pick the right tool when several near-neighbours exist.

### Obsidian Integration

- **TR13** — Plugin class extends Obsidian's Plugin base class
- **TR14** — Settings tab class extends PluginSettingTab
- **TR15** — Ribbon icon showing server status (running/stopped)
- **TR16** — Command palette commands: start server, stop server, restart server, copy access key
- **TR26** — Adds a "Copy Debug Info" command palette entry alongside the four listed in TR16. Invoking it opens the same diagnostics modal as the "Copy debug info" button in the settings UI (CR22).

### Testing

- **TR17** — Vitest as test framework
- **TR18** — Mock layer for Obsidian API (obsidian module mock with typed stubs)
- **TR19** — Integration tests that boot the MCP server and call tools via MCP client
- **TR20** — Unit tests for each tool handler in isolation
- **TR21** — Test fixtures for vault content (markdown files, folders, frontmatter samples) — *audit (2026-05-07): no on-disk `tests/fixtures/` directory; vault content is constructed programmatically via `MockObsidianAdapter` (`src/obsidian/mock-adapter.ts`) inside each test*
- **TR22** — E2E tests using WebdriverIO + wdio-obsidian-service in Docker with Xvfb. (Aspirational: CI today runs lint, typecheck, unit tests with coverage, and build only — no WebdriverIO/E2E job is wired up yet. Visual verification is done ad-hoc on the host via the Xvfb + CDP screenshot pipeline described in `docs/screenshots-on-host.md`.)

### CI/CD

- **TR23** — GitHub Actions workflow: build-and-test (lint, type-check, test, build) on every PR and push to main
- **TR24** — GitHub Actions workflow: please-release for release management (tag-based, produces main.js, manifest.json, styles.css as release assets) — *audit (2026-05-07): the workflow is `.github/workflows/release.yml` and uses `googleapis/release-please-action@v5` (not "please-release"); release assets uploaded are `main.js`, `manifest.json`, `styles.css`, `versions.json`, plus a `vault-mcp-server-<version>.zip` bundle*
- **TR25** — Dependabot for dependency updates
- **TR27** — GitHub Actions workflow `notify-failure.yml` listens for `workflow_run` completions of `CI`, `Release`, and `Release Screenshots` and, when `conclusion == 'failure'`, auto-files a tracking issue. A single open issue per workflow is kept (matched by the `workflow-failure` label and a title of the form `Workflow failure: <workflow-name>`); repeat failures append a comment to that issue instead of opening duplicates, and once the issue is closed the next failure opens a fresh one. The workflow requires only `issues: write` permission and runs from the `main` definition, so fork PRs cannot inject into the notifier.
- **TR33** — GitHub Actions workflow `codeql.yml` runs CodeQL static analysis against the `javascript-typescript` language matrix (`build-mode: none`, `queries: security-and-quality`) on every push to `main`, every PR targeting `main`, and on a weekly schedule (Mondays 06:00 UTC). Findings surface in the repository's Security tab via `security-events: write`.
- **TR34** — GitHub Actions workflow `dependabot-auto-merge.yml` auto-approves and enables auto-merge (squash) on Dependabot PRs whose dependency type is `direct:development` OR whose ecosystem is `github_actions`, and whose update type is `version-update:semver-patch` OR `version-update:semver-minor`. Production dependencies and major-version bumps still require a human reviewer. Uses `dependabot/fetch-metadata@v3` to classify the PR.
- **TR35** — GitHub Actions workflow `docs-screenshots.yml` regenerates localized settings screenshots on `release: published` (and via `workflow_dispatch` with a `tag` input). It boots Obsidian under Xvfb + CDP on Ubuntu, runs `docker/scripts/docs_screenshots.py` against `.supported-locales.yml` to produce one PNG per locale under `docs/screenshots/<locale>/settings.png`, rewrites the `<!-- BEGIN: screenshot-settings --> … <!-- END: screenshot-settings -->` block in any matching `docs/help/<locale>.md` to reference the captured plugin version, and commits both back to `main` (see **NFR35**).
- **TR36** — GitHub Actions workflow `release-screenshots.yml` captures release-time screenshots on `release: published` (and via `workflow_dispatch` with a `tag` input). It boots Obsidian under Xvfb + CDP at 1920×1400, runs `docker/scripts/release_screenshots.py` to produce `release-settings.png`, uploads it to the release as an asset via `gh release upload --clobber`, and rewrites the release notes to include a `## Screenshots` section that embeds the asset (replacing any prior `## Screenshots` block).

## Documentation

### User Documentation

- **DR1** — README.md with project overview, installation instructions, and quick-start guide
- **DR2** — Configuration reference documenting all settings and their defaults — *audit (2026-05-07): `docs/configuration.md` covers `serverAddress`, `port`, `accessKey`, `httpsEnabled`, `tlsCertificate`, `debugMode`, but is missing entries for `Require Bearer authentication`, `Require Origin header`, `autoStart`, and per-tool toggles; the module table tool counts (16/12/10/5/3/3/5) also disagree with the live counts in `docs/tools.generated.md` (18/6/10/5/1/3/6/1)*
- **DR3** — MCP client setup guide (how to connect Claude Desktop, Claude Code, and other MCP clients)
- **DR4** — Security best practices (access key management, network exposure warnings)

### Developer Documentation

- **DR5** — CONTRIBUTING.md with development setup, architecture overview, and PR process
- **DR6** — Architecture decision records for key choices (transport, auth, testing framework) — *audit (2026-05-07): no formal `docs/adr/` or `docs/decisions/` directory exists; `docs/superpowers/specs/` holds per-feature design docs that cover some decisions (e.g. `2026-05-03-mcp-server-instructions-field-design.md`, `245-timing-safe-bearer-compare.md`) but they are change-scoped specs rather than canonical ADRs covering transport, auth, and testing-framework choices*
- **DR7** — How to add a new feature category (step-by-step guide for contributors)
- **DR8** — API reference: list of all MCP tools with parameter schemas and example responses — *audit (2026-05-07): `docs/tools.generated.md` lists every tool by name/title with `readOnly`/`destructive` flags but does not include parameter (input) schemas, output schemas, or example responses; full schemas are only available at runtime via the MCP `tools/list` call*

## Appendix A: Settings Schema Migrations

This appendix grounds CR14 in the concrete migration steps implemented in `migrateSettings` (`src/settings.ts`). Each step is idempotent and runs in order; `schemaVersion` is written after each successful step so partial upgrades resume correctly.

- **v1** — Baseline. Fills in defaults for required fields that may be missing on data loaded from a pre-versioned install: `port` (28741), `accessKey` (empty string), `httpsEnabled` (false), `debugMode` (false), and an empty `moduleStates` map.
- **v2** — Adds `serverAddress`, defaulting to `127.0.0.1` (see CR17).
- **v3** — Adds `autoStart`, defaulting to `false` for existing installs so the server never starts unexpectedly after an upgrade (see CR19).
- **v4** — Removes the per-module `readOnly` flag from every `moduleStates` entry (the feature was dropped), and converts the Extras group from a single module-level toggle to per-tool toggles (`toolStates`). Preserves behaviour: if the Extras module was previously enabled, the known `get_date` tool stays enabled; otherwise its `toolStates` map is initialized empty.
- **v5** — Adds `tlsCertificate`, defaulting to `null` so the self-signed certificate is generated on the next server start with HTTPS enabled.
- **v6** — Adds `authEnabled`, defaulting to `false` (see CR24 / NFR5). Existing installs that previously relied on always-on Bearer auth will need to flip the toggle back on after upgrading; the access key itself is preserved so re-enabling auth restores the prior behaviour without regenerating the key. — *audit (2026-05-07): v6's behaviour as a migration hop is unchanged in code (`migrateV5ToV6` still leaves `authEnabled: false` for installs that lack the field), but the **default in `DEFAULT_SETTINGS` was later flipped to `true`** in support of secure-by-default; see the v10 entry below and **CR28** (which replaces CR24)*
- **v7** — Adds `useCustomTls` (default `false`), `customTlsCertPath` (default `null`), and `customTlsKeyPath` (default `null`) in support of CR25, CR26, CR27, and NFR34. Existing installs retain their cached `tlsCertificate`, so toggling CR25 back off restores the prior self-signed behaviour without regenerating the cert.
- **v8** — Adds `executeCommandAllowlist`, defaulting to `[]` (an empty list, which means `plugin_execute_command` refuses every call). Existing installs cannot accidentally run destructive Obsidian commands via MCP; users opt in per command id. See the Execute Command Allowlist surface in `src/settings/allowlist-section.ts`.
- **v9** — Adds the DNS-rebind protection settings: `allowedOrigins` (defaults to the four loopback variants `http://127.0.0.1`, `http://localhost`, `https://127.0.0.1`, `https://localhost`), `allowedHosts` (defaults to `127.0.0.1`, `localhost`), `allowNullOrigin` (default `false`), and `requireOrigin` (default `false`). Existing installs become loopback-only on upgrade so the loopback-bound server rejects hostile webpages that resolve attacker-controlled hostnames to 127.0.0.1 and try to fetch the MCP endpoint.
- **v10** — Flips Bearer auth to secure-by-default and introduces the explicit insecure-mode acknowledgement. Two carry-along concerns: (1) Existing installs that were running default-insecure (`authEnabled === false && accessKey === ''`) are grandfathered by setting `iAcceptInsecureMode: true` so they keep working after upgrade; the plugin surfaces a one-time `Notice` on next load (tracked via the new `seenInsecureWarning` flag, also added here, default `false`) so users know about the new posture. (2) The `extras_get_date` tool was renamed from `get_date`; the per-tool key in `moduleStates.extras.toolStates` is renamed to `extras_get_date` so the user's prior enabled/disabled choice carries over. The `DEFAULT_SETTINGS` value of `authEnabled` is also flipped to `true` in this hop's broader change, but the migration only sets `iAcceptInsecureMode` — it does not rewrite `authEnabled` for existing installs. See **CR28** and **CR29**.
- **v11** — Adds `resourcesEnabled`, defaulting to `true`. Enables the MCP resources surface (vault files exposed via `obsidian://vault/{+path}` template plus the `obsidian://vault/index` static resource) on existing installs by default; users can disable it in Server Settings if they prefer a tools-only server. See `docs/superpowers/specs/2026-05-03-mcp-resources-vault-files-design.md`.
- **v12** — Adds `promptsEnabled`, defaulting to `true`. Enables the MCP prompts surface (canned slash-command prompts such as `/summarize-note`, `/find-related`, `/expand-template`) on existing installs by default; users can disable it in Server Settings to skip the slash-command prompts. See `docs/superpowers/specs/2026-05-03-mcp-prompts-slash-commands-design.md`.

Future schema versions must be appended here with the same format (version number, behaviour summary, rationale, and links to the CRs/NFRs they serve).
