# Vault MCP Server

Vault MCP Server is an Obsidian desktop plugin that runs an MCP (Model Context Protocol) server, exposing vault operations as tools over Streamable HTTP. AI agents like Claude, Codex, and others can connect and interact with your vault programmatically.

## Features

- **52 MCP tools** across 9 modules (the exact, always-current breakdown is in [`docs/tools.generated.md`](docs/tools.generated.md))
- **Vault and file operations**: Create, read, update, delete, move, copy files and folders
- **Search and metadata**: Full-text search, frontmatter, tags, headings, links, backlinks
- **Editor operations**: Access and manipulate the active editor (off by default)
- **Workspace and navigation**: Manage panes, open files, navigate the workspace (off by default)
- **UI interactions**: Show notices in Obsidian (off by default)
- **Templates and content generation**: List, create from, and expand templates
- **Plugin interop**: List plugins, execute commands, run Dataview queries
- **Extras**: Utility tools toggled per tool (e.g. `extras_get_date`)
- **Security**: Bearer token authentication, Origin and Host allowlists, CORS, path traversal protection (see [Security](#security))
- **Dynamic module toggles**: Enable/disable feature categories with a single per-module switch

## Installation

Vault MCP Server needs Obsidian **1.15.0** or later and runs on desktop only (Windows, macOS, Linux), not on mobile.

### From Obsidian Community Plugins (coming soon)

1. Open Settings > Community plugins
2. Search for "Vault MCP Server"
3. Install and enable

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/releases)
2. Create folder `<vault>/.obsidian/plugins/vault-mcp-server/`
3. Copy the downloaded files into the folder
4. Reload Obsidian and enable the plugin

## Quick Start

1. Enable the plugin. It generates an access key on first load; copy it from the plugin settings (**Access key**) or with the **Copy access key** command
2. Start the server with the ribbon icon or the **Start MCP server** command. It listens on `127.0.0.1:28741`. The server does not start by itself; turn on **Auto-start on launch** to start it with Obsidian
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
claude mcp add obsidian --transport http --url http://127.0.0.1:28741/mcp --header "Authorization: Bearer YOUR_ACCESS_KEY"
```

To share a project's `.mcp.json` without the key in git, let Claude Code read it from an environment variable (`export OBSIDIAN_MCP_TOKEN=...`):

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "http://127.0.0.1:28741/mcp",
      "headers": {
        "Authorization": "Bearer ${OBSIDIAN_MCP_TOKEN}"
      }
    }
  }
}
```

See [Keep the access key out of git](docs/help/en.md#keep-the-access-key-out-of-git) in the manual.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Server address | 127.0.0.1 | IPv4 address the server binds to (loopback only by default) |
| Port | 28741 | Port for the MCP server |
| Require Bearer authentication | On | Every request needs the access key |
| Access key | Generated on first load | Bearer token: 32 random bytes as 43 base64url characters |
| HTTPS | Off | Serve over HTTPS with a self-signed certificate, or your own |
| Auto-start on launch | Off | Start the server when Obsidian starts |
| Debug mode | Off | Also log request method and URL, session and tool registration events |

Changes to the server address, port, authentication, access key, HTTPS and the Origin and Host allowlists take effect the next time the server starts.

Feature modules can be individually enabled or disabled in the settings tab. When a module is enabled, all of its tools are exposed. A new install has Vault, Search, Templates and Plugin Interop on; Editor, Workspace and UI (which act on the note open in Obsidian) are off by default since 5.0, and installs updated from 4.x keep their switches. `plugin_dataview_query` is listed only while Dataview is enabled, `plugin_execute_command` only while the command allowlist is non-empty.

## Commands

- **Start MCP server** — Start the server
- **Stop MCP server** — Stop the server
- **Restart MCP server** — Restart the server
- **Copy access key** — Copy the access key to clipboard
- **Copy debug info** — Preview the debug info (access key and certificate left out) and copy it to clipboard

## Network use and privacy

- **Local server only.** The plugin runs an HTTP server (HTTPS if you turn it on) on your computer, by default on `127.0.0.1`, port `28741`, which other computers cannot reach. It is off until you start it; auto-start is off by default. If you set another server address, the server can be reachable from your network; see [Network exposure](docs/security.md#network-exposure).
- **No outbound connections.** The plugin makes no network requests of its own: no remote services, no telemetry or analytics, no ads, no update checks, and it never downloads or installs code. It needs no account and no payment.
- **Links to GitHub.** **Repository** and **Report an issue** in the settings open GitHub in your browser when you select them. The issue link fills in the plugin and Obsidian versions; nothing else is sent.
- **Your vault content** leaves the plugin only in the responses to the MCP clients you connect with your access key. What a client does with it, for example sending it to an AI model provider, depends on that client and its provider. Limit what clients can do with the module switches, **Read and edit only** and the command allowlist.
- **Files outside the vault.** Only with **Bring your own certificate** (HTTPS settings): you pick a certificate and a private key in the system file dialog, the plugin stores their absolute paths and reads both files at every server start to serve HTTPS with your certificate. It reads no other files outside the vault and writes none.
- **Data stored on your computer**, in the plugin's folder (`<vault>/.obsidian/plugins/vault-mcp-server/`):
  - `data.json`: the settings in plain text, including, with HTTPS, the self-signed certificate and its private key. Not the access key: it is kept in Obsidian's secret storage on this device, outside the vault folder and not synced (in `data.json` only if secret storage is not available; see [Where the access key is stored](docs/security.md#where-the-access-key-is-stored)).
  - `debug.log`: the plugin's log: server start and stop, module registration, errors, failed logins, and requests rejected by the Origin and Host check with the client's IP address, method, path, Origin and Host. With **Debug mode** on, also the method and URL of every request and session and tool events. It never leaves your computer unless you copy it; **Copy debug info** includes its last 200 lines.
  - Both files are in the vault's config folder, so anything that syncs or backs up the whole vault folder copies them too. MCP clients cannot read the config folder.

## Security

- Bearer authentication is on by default; without it the server starts only on `127.0.0.1` and only after you turn on **Accept insecure mode**
- Requests must carry an allowlisted `Host` (and `Origin`, if they send one); the defaults allow loopback only (DNS rebinding protection)
- Five failed logins within a minute block the client's IP address for 30 seconds
- File operations are scoped to the vault; the vault's config folder (with `data.json`) is off limits to clients
- HTTPS with a locally generated self-signed certificate or your own

Details, defaults and recommendations: [docs/security.md](docs/security.md).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

GPL-3.0-only
