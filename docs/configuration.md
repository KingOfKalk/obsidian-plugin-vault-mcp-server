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

### Access Key (`accessKey`)
- **Default**: (empty)
- **Description**: Bearer token for authenticating MCP clients. The server will not start without an access key configured.
- **Generate**: Click the "Generate" button in settings to create a random 64-character hex key

### HTTPS (`httpsEnabled`)
- **Default**: `false`
- **Description**: Enable HTTPS with a locally generated self-signed certificate

### Debug Mode (`debugMode`)
- **Default**: `false`
- **Description**: Enable verbose logging of all MCP requests and responses. Access keys are always redacted from logs.

## Feature Modules

Each module can be individually enabled or disabled. When a module is enabled, all of its tools are exposed; there is no per-module read-only mode. Tools still advertise an `isReadOnly` hint in their MCP metadata so clients can present them appropriately.

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
