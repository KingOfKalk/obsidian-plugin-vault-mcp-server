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
- **R16** — Get file metadata (size, creation date, modification date)

### Search and Metadata

- **R17** — Full-text search across vault contents with query string
- **R18** — Query frontmatter properties for a given file
- **R19** — Query all tags in the vault with file associations
- **R20** — Query headings for a given file
- **R21** — Query all outgoing links for a given file
- **R22** — Query all embeds for a given file
- **R23** — Get all backlinks for a given file
- **R24** — Get resolved links across the vault
- **R25** — Get unresolved links across the vault
- **R26** — Query block references for a given file
- **R27** — Search files by tag
- **R28** — Search files by frontmatter property value

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
- **R45** — Show a confirmation modal (yes/no) and return the user response
- **R46** — Show an input prompt modal and return the user-entered text

### Templates and Content Generation

- **R47** — List available templates from the configured templates folder
- **R48** — Create a new file from a template with variable substitution
- **R49** — Process and expand template variables in a given string (date, title, etc.)

### Plugin Interop

- **R50** — List installed community plugins with enabled/disabled status
- **R51** — Check if a specific plugin is installed and enabled
- **R52** — Execute a Dataview query and return results (if Dataview is installed)
- **R53** — Execute a Templater template (if Templater is installed)
- **R54** — Provide a generic plugin command execution interface

### Extras

Utility tools that do not mirror an Obsidian API. Modules in this group render under a separate "Extras" heading in the settings UI (not under "Feature Modules"). Unlike core feature modules, Extras modules are not toggled as a single unit: the settings UI renders one toggle **per tool** within the Extras group, and the registry stores per-tool enable state on the module. All Extras tools are disabled by default — users opt in one tool at a time.

- **R55** — `get_date` tool returns the current local datetime as a plain ISO-8601 string with timezone offset (e.g. `2026-04-16T14:32:05.123+02:00`). The offset is already encoded in the string, so no additional fields are returned. Disabled by default. Belongs to the "Extras" module group.

### Internationalization (I18N)

The plugin UI is translated via a tiny in-house i18n helper modelled on the [obsidian-kanban pattern](https://github.com/mgmeyers/obsidian-kanban/blob/main/src/lang/helpers.ts) — zero runtime dependencies, all translations compiled into the plugin bundle. See `src/lang/helpers.ts` for the `t()` function and `src/lang/locale/` for per-locale maps.

- **I1** — Plugin UI strings support multiple locales. English and German ship out of the box (`src/lang/locale/en.ts`, `src/lang/locale/de.ts`). `en` is the source of truth; other locales are `Partial<Record<keyof typeof en, string>>` maps.
- **I2** — The active locale is auto-detected via `window.localStorage.getItem('language')` (the key Obsidian itself writes). No in-plugin settings override in this iteration — the plugin simply follows Obsidian's own language setting.
- **I3** — Missing keys in non-English locales fall back to the English value at runtime. If the detected locale is not registered in the locale map, `t()` logs a single `console.error` and returns the English value. `t()` is typed as `t(key: keyof typeof en, params?: Record<string, string | number>): string`, so a missing/misspelled key is a TypeScript compile error.
- **I4** — MCP tool names, tool descriptions, input schemas, and MCP error payloads remain English-only. These surfaces are LLM-facing (agents, not humans), and keeping them English maximizes tool-selection quality and MCP interop stability. Structured log output is also English by convention.

## Configuration

### Server Settings

- **CR1** — Configurable HTTP port with default value 28741
- **CR2** — Access key field for authentication (user-provided, with a "Generate" button for convenience). The Generate button produces a new access key by calling Node's `crypto.randomBytes(32)` and rendering the 32 random bytes as a 64-character lowercase hex string, then overwrites the stored access key and re-renders the settings tab. The Access Key row only renders when **CR24** ("Require Bearer authentication") is on; with auth disabled the row is hidden because the key has no effect.
- **CR3** — Toggle between HTTP and HTTPS (self-signed certificate), HTTP by default
- **CR4** — Debug mode toggle that enables verbose logging
- **CR17** — Configurable server IP address (default `127.0.0.1`). Must validate IPv4 format. Settings UI shows a security warning when bound to a non-localhost address. Requires server restart to take effect.
- **CR19** — Auto-start on launch toggle. Defaults to off. When on, the plugin's `onload` starts the MCP server automatically during plugin load. The auto-start gate respects **CR24**: if Bearer auth is enabled but no access key is configured, the server is left stopped and the plugin logs an `info` entry explaining why; if Bearer auth is disabled, no access key is required for auto-start. Users must explicitly opt in per install.
- **CR20** — Server URL row displays the current `http://<address>:<port>/mcp` URL in its description and exposes a clipboard-copy extra button ("Copy server URL") that writes that URL to the clipboard and shows a confirmation Notice.
- **CR24** — "Require Bearer authentication" toggle in Server Settings. Defaults to **off** so a fresh install can be used without first generating an access key. When off, `authenticateRequest` short-circuits and the server accepts every request regardless of the `Authorization` header; the Access Key row (CR2) is hidden, and the MCP client configuration snippet (CR21) omits the `headers`/`Authorization` entry. When on, the existing CR2 access key field is rendered and **NFR5** Bearer enforcement applies. Persisted as `authEnabled` in the v6 settings schema (see Appendix A).

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

- **CR21** — Settings UI contains an "MCP Client Configuration" section with a clipboard-copy extra button that copies a ready-to-paste JSON snippet for the `mcpServers` entry of Claude Desktop / Claude Code config files. The snippet is derived live from the current `serverAddress`, `port`, `authEnabled`, and `accessKey`: it always includes the MCP endpoint URL (`http://<address>:<port>/mcp`) and, only when Bearer auth is enabled (CR24) **and** the access key is non-empty, a `headers` object with `Authorization: Bearer <key>`. The copy action shows a confirmation Notice.

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

- **NFR5** — Bearer-token authentication is opt-in and controlled by **CR24** (`authEnabled`, default off). When enabled, every MCP request must carry a valid `Authorization: Bearer <key>` header; enforcement happens in `authenticateRequest` before any request-routing logic, including the MCP `initialize` handshake and any subsequent `mcp-session-id`-keyed calls. With auth enabled and no access key configured, every request is rejected with an authentication error. When `authEnabled` is off, `authenticateRequest` short-circuits and accepts every request — operators must rely on network controls (localhost-only binding, firewall) instead. CORS preflight (`OPTIONS`) requests are handled earlier and never reach the auth check in either mode.
- **NFR6** — CORS headers configurable and restrictive by default
- ~~NFR7~~ — ~~Disabled feature categories reject requests with 403, not just hide tools~~
- **NFR30** — Disabled feature modules (and, for Extras, individually disabled tools) are filtered out of the MCP tool list advertised to clients. A client that invokes a tool from a disabled module receives the standard MCP unknown-tool error from the SDK; the plugin does not emit an HTTP 403 for feature-gating. Replaces ~~NFR7~~ because the implemented contract is "hide disabled tools at `tools/list` time", not "reject with HTTP 403".
- **NFR8** — File operations scoped to the vault directory (no path traversal)
- **NFR9** — Self-signed HTTPS certificate generated locally, never transmitted
- **NFR10** — Access key never appears in logs even in debug mode. The `Logger` enforces this by substituting the configured access key with the literal placeholder `[REDACTED]` in every formatted message string and every string reached recursively inside structured log data before the entry is emitted. `updateOptions` keeps the redaction key in sync with the current settings.
- **NFR32** — The HTTP transport caps individual request bodies at 4 MiB. Requests whose body exceeds `MAX_BODY_BYTES` are rejected with a JSON-RPC `-32700` ("Parse error: Request body too large") response and the underlying socket is destroyed mid-upload to avoid buffering unbounded input. Implemented in `src/server/http-server.ts` (`readJsonBody`).
- **NFR33** — The "Copy debug info" bundle (CR22) is plain text and never includes secret material. The access key is rendered as the literal placeholder `<set>` or `<empty>` (never the configured value), and the cached TLS certificate is rendered as `<present>` or `<absent>` (never the PEM contents). The recent-log tail included in the bundle is read straight from `debug.log` (CR23), which is already redacted at write time by the `Logger` per NFR10, so no additional scrubbing is performed on the tail.

### Reliability

- **NFR11** — HTTP server starts when plugin loads and stops when plugin unloads
- **NFR12** — Graceful shutdown: finish in-flight requests, then close connections
- **NFR13** — Port conflict recovery with clear error message to the user
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
- **NFR31** — Plugin registers an Obsidian status bar item that displays `MCP :<port>` while the MCP server is running and renders as empty text while the server is stopped. The status bar text is refreshed on every start/stop transition so users can see at a glance whether the server is live and on which port without opening settings.

### Compatibility

- **NFR27** — Minimum Obsidian version: document chosen version at development start (recommend latest stable)
- **NFR28** — Follow Obsidian community plugin guidelines for eventual submission
- **NFR29** — MCP SDK version 1.x pinned (document exact version in package.json)

## Technical Requirements

### Project Structure

- **TR1** — TypeScript strict mode, no `any` types unless explicitly justified
- **TR2** — esbuild as the bundler producing a single main.js output
- **TR3** — manifest.json following Obsidian plugin specification (id, name, version, minAppVersion, description, author, isDesktopOnly)
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
- **TR21** — Test fixtures for vault content (markdown files, folders, frontmatter samples)
- **TR22** — E2E tests using WebdriverIO + wdio-obsidian-service in Docker with Xvfb. (Aspirational: CI today runs lint, typecheck, unit tests with coverage, and build only — no WebdriverIO/E2E job is wired up yet. Visual verification is done ad-hoc on the host via the Xvfb + CDP screenshot pipeline described in `docs/screenshots-on-host.md`.)

### CI/CD

- **TR23** — GitHub Actions workflow: build-and-test (lint, type-check, test, build) on every PR and push to main
- **TR24** — GitHub Actions workflow: please-release for release management (tag-based, produces main.js, manifest.json, styles.css as release assets)
- **TR25** — Dependabot for dependency updates

## Documentation

### User Documentation

- **DR1** — README.md with project overview, installation instructions, and quick-start guide
- **DR2** — Configuration reference documenting all settings and their defaults
- **DR3** — MCP client setup guide (how to connect Claude Desktop, Claude Code, and other MCP clients)
- **DR4** — Security best practices (access key management, network exposure warnings)

### Developer Documentation

- **DR5** — CONTRIBUTING.md with development setup, architecture overview, and PR process
- **DR6** — Architecture decision records for key choices (transport, auth, testing framework)
- **DR7** — How to add a new feature category (step-by-step guide for contributors)
- **DR8** — API reference: list of all MCP tools with parameter schemas and example responses

## Appendix A: Settings Schema Migrations

This appendix grounds CR14 in the concrete migration steps implemented in `migrateSettings` (`src/settings.ts`). Each step is idempotent and runs in order; `schemaVersion` is written after each successful step so partial upgrades resume correctly.

- **v1** — Baseline. Fills in defaults for required fields that may be missing on data loaded from a pre-versioned install: `port` (28741), `accessKey` (empty string), `httpsEnabled` (false), `debugMode` (false), and an empty `moduleStates` map.
- **v2** — Adds `serverAddress`, defaulting to `127.0.0.1` (see CR17).
- **v3** — Adds `autoStart`, defaulting to `false` for existing installs so the server never starts unexpectedly after an upgrade (see CR19).
- **v4** — Removes the per-module `readOnly` flag from every `moduleStates` entry (the feature was dropped), and converts the Extras group from a single module-level toggle to per-tool toggles (`toolStates`). Preserves behaviour: if the Extras module was previously enabled, the known `get_date` tool stays enabled; otherwise its `toolStates` map is initialized empty.
- **v5** — Adds `tlsCertificate`, defaulting to `null` so the self-signed certificate is generated on the next server start with HTTPS enabled.
- **v6** — Adds `authEnabled`, defaulting to `false` (see CR24 / NFR5). Existing installs that previously relied on always-on Bearer auth will need to flip the toggle back on after upgrading; the access key itself is preserved so re-enabling auth restores the prior behaviour without regenerating the key.

Future schema versions must be appended here with the same format (version number, behaviour summary, rationale, and links to the CRs/NFRs they serve).
