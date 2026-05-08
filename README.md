# Obsidian MCP Plugin

An Obsidian desktop plugin that runs an MCP (Model Context Protocol) server, exposing vault operations as tools over Streamable HTTP. AI agents like Claude, Codex, and others can connect and interact with your vault programmatically.

## Features

- **55 MCP tools** across 8 modules (the exact, always-current breakdown is in [`docs/tools.generated.md`](docs/tools.generated.md))
- **Vault Operations**: Create, read, update, delete, move, copy files and folders
- **Search & Metadata**: Full-text search, frontmatter, tags, headings, links, backlinks
- **Editor Operations**: Access and manipulate the active editor
- **Workspace**: Manage panes, open files, navigate the workspace
- **UI Interactions**: Show notices, modals, and prompts
- **Templates**: List, create from, and expand templates
- **Plugin Interop**: List plugins, execute commands, Dataview/Templater integration
- **Extras**: Utility tools toggled per tool (e.g. `get_date`)
- **Security**: Bearer token authentication, CORS, path traversal protection
- **Dynamic module toggles**: Enable/disable feature categories with a single per-module switch

## Installation

### From Obsidian Community Plugins (coming soon)

1. Open Settings > Community plugins
2. Search for "MCP Server"
3. Install and enable

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/releases)
2. Create folder `<vault>/.obsidian/plugins/vault-mcp-server/`
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin

## Quick Start

1. Open plugin settings and click **Generate** to create an access key
2. The MCP server starts automatically on port `28741`
3. Connect your MCP client using the configuration below

## MCP Client Setup

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "http://127.0.0.1:28741/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_KEY"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add obsidian --transport http --url http://127.0.0.1:28741 --header "Authorization: Bearer YOUR_ACCESS_KEY"
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Server Address | 127.0.0.1 | IP address the server binds to (localhost only by default) |
| Port | 28741 | HTTP port for the MCP server |
| Access Key | (empty) | Bearer token for authentication |
| HTTPS | Off | Enable HTTPS with self-signed certificate |
| Debug Mode | Off | Verbose logging of requests/responses |

Feature modules can be individually enabled or disabled in the settings tab. When a module is enabled, all of its tools are exposed.

## Commands

- **Start MCP Server** — Start the server
- **Stop MCP Server** — Stop the server
- **Restart MCP Server** — Restart the server
- **Copy Access Key** — Copy the access key to clipboard

## Security

- All requests require a valid Bearer token
- File operations are scoped to the vault directory (path traversal protection)
- Access key is never logged, even in debug mode
- CORS headers are restrictive by default
- HTTPS available with locally generated self-signed certificates

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

GPL-3.0-only
