# Product Requirements Document — Obsidian MCP Plugin

## Overview

This Obsidian plugin runs an MCP (Model Context Protocol) server inside Obsidian Desktop. It exposes vault operations, search, editor, workspace, UI, templates, and plugin interop as MCP tools over Streamable HTTP. AI agents (Claude, Codex, etc.) connect to this server with an access key and interact with Obsidian programmatically. The plugin is desktop-only, written in TypeScript, and licensed under GPL v3.

## ID Governance

- Never delete an ID — if a requirement is removed, ~~strikethrough~~ it instead
- Never reuse an ID — once assigned, it is permanently taken even if struck through
- New IDs only — when consolidating or replacing requirements, assign a new ID
- New/replacement requirements must explain why and reference the struck-through ID(s) they supersede

## Feature Categories

Each category is a toggleable module. Modules self-register. The settings UI auto-discovers them. A "Refresh" button re-discovers modules without restarting Obsidian. Each category can be set to read-only where applicable.

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

## Configuration

### Server Settings

- **CR1** — Configurable HTTP port with default value 28741
- **CR2** — Access key field for authentication (user-provided, with a "Generate" button for convenience)
- **CR3** — Toggle between HTTP and HTTPS (self-signed certificate), HTTP by default
- **CR4** — Debug mode toggle that enables verbose logging
- **CR17** — Configurable server IP address (default `127.0.0.1`). Must validate IPv4 format. Settings UI shows a security warning when bound to a non-localhost address. Requires server restart to take effect.

### Feature Access Control

- ~~CR5~~ — ~~Toggle to enable/disable Vault and File Operations~~
- ~~CR6~~ — ~~Toggle to enable/disable Search and Metadata~~
- ~~CR7~~ — ~~Toggle to enable/disable Editor Operations~~
- ~~CR8~~ — ~~Toggle to enable/disable Workspace and Navigation~~
- ~~CR9~~ — ~~Toggle to enable/disable UI Interactions~~
- ~~CR10~~ — ~~Toggle to enable/disable Templates and Content Generation~~
- ~~CR11~~ — ~~Toggle to enable/disable Plugin Interop~~
- **CR12** — Dynamic feature toggle system: modules self-register with metadata (name, description, tool list), settings UI auto-discovers and renders toggles, "Refresh" button to re-discover without restart. Includes per-module read-only mode where applicable. Replaces ~~CR5~~–~~CR11~~, consolidated into dynamic system.

### Server Controls

- **CR16** — Settings UI provides dedicated Start, Stop, and Restart buttons for MCP server lifecycle management. The Stop button is only enabled when the server is running. The Start button is only enabled when the server is stopped. The Restart button is only enabled when the server is running.

### Settings Persistence

- **CR13** — All settings persisted in Obsidian's plugin data.json
- **CR14** — Settings migration strategy between plugin versions (versioned schema)
- **CR15** — Sensible defaults for all settings on first install

## Non-Functional Requirements

### Performance

- **NFR1** — File listing operations handle vaults with 10,000+ files without UI freezing
- **NFR2** — Search operations on large vaults return results within 5 seconds
- **NFR3** — Server startup completes within 2 seconds
- **NFR4** — Plugin adds no noticeable latency to Obsidian startup

### Security

- **NFR5** — All MCP requests require a valid access key (Bearer token)
- **NFR6** — CORS headers configurable and restrictive by default
- **NFR7** — Disabled feature categories reject requests with 403, not just hide tools
- **NFR8** — File operations scoped to the vault directory (no path traversal)
- **NFR9** — Self-signed HTTPS certificate generated locally, never transmitted
- **NFR10** — Access key never appears in logs even in debug mode

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
- **NFR19** — Plugin passes MCP Inspector validation for all exposed tools
- **NFR20** — Test coverage target of 80% for business logic (tool handlers, validation, auth)

### Maintainability

- **NFR21** — Modular architecture: each feature category is a self-contained module
- **NFR22** — Adding a new MCP tool requires no changes to the server core
- **NFR23** — Fully dynamic toggle system: modules self-register with metadata, settings UI auto-discovers and renders toggles, no hardcoded toggle list

### Observability

- **NFR24** — Structured logging with levels: debug, info, warn, error
- **NFR25** — Debug mode logs all incoming MCP requests and outgoing responses
- **NFR26** — Server status (running, port, connected clients) visible in the settings tab

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

### Testing

- **TR17** — Vitest as test framework
- **TR18** — Mock layer for Obsidian API (obsidian module mock with typed stubs)
- **TR19** — Integration tests that boot the MCP server and call tools via MCP client
- **TR20** — Unit tests for each tool handler in isolation
- **TR21** — Test fixtures for vault content (markdown files, folders, frontmatter samples)
- **TR22** — E2E tests using WebdriverIO + wdio-obsidian-service in Docker with Xvfb

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
