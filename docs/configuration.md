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

Each module can be individually enabled/disabled. Modules that support read-only mode can be restricted to only expose read operations.

| Module | Tools | Read-Only Support |
|--------|-------|-------------------|
| Vault and File Operations | 16 | Yes |
| Search and Metadata | 12 | No (all read-only) |
| Editor Operations | 10 | Yes |
| Workspace and Navigation | 5 | No |
| UI Interactions | 3 | No |
| Templates | 3 | Yes |
| Plugin Interop | 5 | No |

## Settings Persistence

All settings are stored in Obsidian's plugin `data.json` file. Settings include a schema version for automatic migration between plugin versions.
