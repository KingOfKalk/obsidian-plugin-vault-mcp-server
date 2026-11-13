# Configuration reference

This page documents every persisted setting in `data.json` that has a
matching row in the plugin's settings tab. Headings mirror the in-Obsidian
settings tab so you can cross-reference what you see on screen.

For the per-tool list (each tool's name, `readOnly` / `destructive`
annotations, etc.) see [`tools.generated.md`](tools.generated.md), which
is auto-generated from the tool registry.

## Status row

The first row of the tab, without a heading. Shows whether the server is
running, the URL it is bound to, the number of connected clients, and a
toggle plus restart button. Not a persisted setting.

## Server

### Server address (`serverAddress`)
- **Default**: `127.0.0.1`
- **Description**: IP address the MCP server binds to. The default `127.0.0.1` restricts access to the local machine only. Changing this to `0.0.0.0` will expose the server on all network interfaces — **use with caution**. Any address other than `127.0.0.1` requires `authEnabled`: without authentication the server refuses to start there (see `authEnabled` below).
- **Validation**: Must be a valid IPv4 address

### Port (`port`)
- **Default**: `28741`
- **Description**: HTTP port the MCP server listens on
- **Range**: 1–65535
- **Conflict handling**: If the configured port is already in use by another process, the server start fails. The plugin shows an Obsidian Notice, renders the port with a strike-through in the status bar (hover for the exact error), and displays an inline error under this field in settings. Change the port or free the other process, then toggle the server back on.

### Server URL
- **Read-only**. Composed live from `<scheme>://<serverAddress>:<port>/mcp` where `<scheme>` is `https` if `httpsEnabled` is true, else `http`. The settings tab exposes a copy button; not a persisted setting.
- **Other paths**: MCP is served only on `/mcp`. Every other path, including the bare root `/` and `/mcp/`, gets `404` with the hint `Not found. The MCP endpoint is /mcp`.

### Require Bearer authentication (`authEnabled`)
- **Default**: `true`
- **Description**: When on (the default since v10), the server requires a Bearer access key on every request. When off, the server only binds if `iAcceptInsecureMode` is also true and `serverAddress` is `127.0.0.1`; otherwise startup fails with a notice that names the reason. The settings tab shows the same hint under the server address.

### Accept insecure mode (`iAcceptInsecureMode`)
- **Default**: `false`
- **Description**: Explicit acknowledgement that running with auth disabled is acceptable. Required to bind when `authEnabled === false`, and only allows binding to `127.0.0.1`. Existing pre-v10 installs that ran default-insecure are grandfathered to `true` by the v9 → v10 migration so they keep working after upgrade. Toggling auth back on clears this flag.
- **When visible**: `authEnabled === false`

### Access key (`accessKey`)
- **Default**: generated at first load. When `authEnabled` is true and the key is empty, the plugin stores 32 random bytes as a 43-character base64url string.
- **Description**: Bearer token for authenticating MCP clients. The server will not start without an access key configured.
- **Storage**: Not in `data.json`: the key is kept in Obsidian's secret storage (`app.secretStorage`, id `vault-mcp-server-access-key`), per device and not synced with the vault. An older install's key is moved there unchanged on the first load. If secret storage is not available, the key stays in `data.json` as before. See [Where the access key is stored](security.md#where-the-access-key-is-stored).
- **Generate**: Select the "Generate" button in settings to create a new key in the same format (32 random bytes, 43 base64url characters)
- **When visible**: `authEnabled === true`

### HTTPS (`httpsEnabled`)
- **Default**: `false`
- **Description**: Enable HTTPS with a locally generated self-signed certificate. The certificate is generated on first server start and cached in plugin data; MCP clients must trust it explicitly (or disable certificate verification). Requires a server restart after toggling.
- **Regenerate**: Select the refresh button on the "TLS certificate" row in settings to produce a fresh certificate (e.g. after changing the server address). Existing clients will need to re-trust the new certificate.

### TLS certificate (`tlsCertificate`)
- **Default**: `null`
- **Description**: Cached self-signed certificate and private key (PEM) used when HTTPS is enabled. Generated automatically; regenerated on demand via the settings UI. Included in `data.json` — treat it like the access key.
- **Renewal**: At every server start, a cached certificate that expires within 30 days (`CERT_RENEWAL_THRESHOLD_DAYS`), has expired or does not parse is replaced by a new one, saved, and announced with a notice; clients must trust the new certificate. A custom certificate (`useCustomTls`) is never replaced; it gets a warning notice and log entry when it expires within 30 days.
- **When visible**: `httpsEnabled === true && useCustomTls === false`

### Bring your own certificate (`useCustomTls`)
- **Default**: `false`
- **Description**: When on, the server loads a user-provided cert/key pair from disk (`customTlsCertPath` + `customTlsKeyPath`) instead of the auto-generated self-signed cert.
- **When visible**: `httpsEnabled === true`

### Custom TLS certificate

When `useCustomTls` is on, a "Custom TLS certificate" heading appears below with two file
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

### Auto-start on launch (`autoStart`)
- **Default**: `false`
- **Description**: Start the MCP server automatically when Obsidian launches the plugin. Off by default so a fresh install doesn't open a network port until the user opts in.

### Expose vault files as MCP resources (`resourcesEnabled`)
- **Default**: `true`
- **Description**: Expose vault files as MCP resources (`obsidian://vault/{+path}` template + `obsidian://vault/index` static) in addition to tools. Turn off if your client doesn't speak the resources protocol or you want a tools-only surface.

### Expose MCP slash-command prompts (`promptsEnabled`)
- **Default**: `true`
- **Description**: Expose canned slash-command prompts via the MCP prompts surface (`/summarize-note`, `/find-related`, `/expand-template`, etc.). Turn off if your client doesn't use prompts.

### DNS rebind protection

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

## MCP client configuration

Read-only section that exposes a "Copy" button. Copies a JSON fragment
shaped for `mcpServers`-style client configuration (URL plus a Bearer
header when auth is on). Not a persisted setting. The fragment holds the
access key as plain text; for a committed Claude Code `.mcp.json`, use
`${VAR}` expansion instead (see the manual, "Keep the access key out of git").

## Feature modules

Each module can be individually enabled or disabled. When a module is enabled, all of its tools are exposed; there is no per-module read-only mode. Tools advertise MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can present them appropriately.

The per-tool list (names, annotations) lives in
[`tools.generated.md`](tools.generated.md), which is auto-generated from
the registry; the table below mirrors its module / count rows.

| Module                           | Tools  | Default (new install) |
| -------------------------------- | ------ | --------------------- |
| Vault and file operations        | 20     | on                    |
| Editor operations                | 10     | off                   |
| Search and metadata              | 7      | on                    |
| Workspace and navigation         | 5      | off                   |
| UI interactions                  | 1      | off                   |
| Templates and content generation | 3      | on                    |
| Plugin interop                   | 4      | on                    |
| Extras                           | 1      | off (per tool)        |
| Server (always on)               | 1      | on                    |
| **Total**                        | **52** |                       |

Editor, Workspace and UI act on the note open in Obsidian and are off by
default since 5.0. The state lives in `moduleStates[<moduleId>].enabled` in
`data.json`; a module without an entry uses its default. The settings
migration to schema version 13 writes `{ "enabled": true }` for any of the
three that an existing install has no entry for, so a 4.x install keeps the
modules it had on. New installs have no `data.json` to migrate and get the
new defaults.

### Conditional plugin tools

Two Plugin interop tools are listed only while they can work, independent of
the module switch:

- `plugin_dataview_query`: while the Dataview plugin is enabled
  (`app.plugins.enabledPlugins` contains `dataview`).
- `plugin_execute_command`: while `executeCommandAllowlist` is non-empty.

Obsidian has no public event for a plugin being enabled or disabled, so the
plugin re-checks every 5 seconds, once the workspace layout is ready, when
a client connects, and when the allowlist is saved. A change sends
`notifications/tools/list_changed` to every open session.

### Extras

Modules in the `extras` group expose **per-tool** toggles instead of a
single per-module toggle. Each tool can be turned on or off
individually; the state is stored under
`moduleStates[<moduleId>].toolStates[<toolName>]` in `data.json`. Today
the only Extras module ships `extras_get_date`.

## Command allowlist (`executeCommandAllowlist`)

- **Default**: `[]`
- **Description**: Allowlist of Obsidian command ids that `plugin_execute_command` is permitted to run. Empty (the default) means command execution is disabled and the tool is not listed in `tools/list`; a non-empty list makes it appear for connected clients. Listed one per line; example:
  ```
  app:reload
  editor:save-file
  ```

## Diagnostics

### Debug mode (`debugMode`)
- **Default**: `false`
- **Description**: Log the method and URL of each request, plus session and tool events (not request or response bodies). Access keys are always redacted from logs.

### Log file
- **Read-only**. Displays the absolute path of the plugin's log file. Not a persisted setting.

### Copy debug info
- **Action**. Opens a modal that copies a redacted bundle of plugin state (settings without secrets, recent log lines, plugin / Obsidian version) to the clipboard for bug reports. Not a persisted setting.

### Clear log
- **Action**. Truncates the log file. Not a persisted setting.

## Settings Persistence

All settings are stored in Obsidian's plugin `data.json` file, except the access key, which is kept in Obsidian's secret storage (with `data.json` as the fallback, see [Access key](#access-key-accesskey)). Settings include a schema version for automatic migration between plugin versions.
