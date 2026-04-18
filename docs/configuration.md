# Configuration Reference

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

### Access Key (`accessKey`)
- **Default**: (empty)
- **Description**: Bearer token for authenticating MCP clients. The server will not start without an access key configured.
- **Generate**: Click the "Generate" button in settings to create a random 64-character hex key

### HTTPS (`httpsEnabled`)
- **Default**: `false`
- **Description**: Enable HTTPS with a locally generated self-signed certificate. The certificate is generated on first server start and cached in plugin data; MCP clients must trust it explicitly (or disable certificate verification). Requires a server restart after toggling.
- **Regenerate**: Click the refresh button on the "TLS Certificate" row in settings to produce a fresh certificate (e.g. after changing the server address). Existing clients will need to re-trust the new certificate.

### TLS Certificate (`tlsCertificate`)
- **Default**: `null`
- **Description**: Cached self-signed certificate and private key (PEM) used when HTTPS is enabled. Generated automatically; regenerated on demand via the settings UI. Included in `data.json` — treat it like the access key.

### Debug Mode (`debugMode`)
- **Default**: `false`
- **Description**: Enable verbose logging of all MCP requests and responses. Access keys are always redacted from logs.

## Feature Modules

Each module can be individually enabled or disabled. When a module is enabled, all of its tools are exposed; there is no per-module read-only mode. Tools advertise MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can present them appropriately.

| Module | Tools |
|--------|-------|
| Vault and File Operations | 16 |
| Search and Metadata | 12 |
| Editor Operations | 10 |
| Workspace and Navigation | 5 |
| UI Interactions | 3 |
| Templates | 3 |
| Plugin Interop | 5 |

## Settings Persistence

All settings are stored in Obsidian's plugin `data.json` file. Settings include a schema version for automatic migration between plugin versions.
