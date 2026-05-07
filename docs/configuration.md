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

#### Custom TLS

When `useCustomTls` is on, an h3 subsection appears below with two file
pickers for the cert and key. Both paths are validated on load via
`loadAndValidateCustomTls`; errors render inline under the matching row.

##### Custom certificate path (`customTlsCertPath`)
- **Default**: `null`
- **Description**: Absolute filesystem path to the user-provided public certificate (PEM).
- **When visible**: `httpsEnabled === true && useCustomTls === true`

##### Custom key path (`customTlsKeyPath`)
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
