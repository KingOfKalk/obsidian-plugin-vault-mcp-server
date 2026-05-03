# MCP Server — User Manual

This manual is for end users of the **MCP Server** Obsidian plugin. It covers
installation, basic setup, every setting and toggle in the UI, and a FAQ for
the most common stumbling blocks (self-signed TLS in LLM clients, port
conflicts, auth errors, etc.).

If you are a developer and want a deeper reference, see:

- [`configuration.md`](../configuration.md) — settings reference
- [`security.md`](../security.md) — security model
- [`PRD.md`](../PRD.md) — full product requirements

---

## What this plugin does

The plugin runs an **MCP (Model Context Protocol) server** inside Obsidian
Desktop. It exposes vault operations, search, the editor, the workspace, UI
prompts, templates, and plugin interop as MCP tools over **Streamable HTTP**.
Any MCP-capable client (Claude Desktop, Claude Code, Codex, custom agents) can
connect to the server and read or modify your vault programmatically.

- **Desktop only** (Node-only APIs are required)
- **Default endpoint**: `http://127.0.0.1:28741/mcp`
- **Auth**: opt-in HTTP Bearer token
- **Transport**: Streamable HTTP (MCP SDK 1.x)

---

## Installation

### Option A — Install via BRAT (recommended while in beta)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is the "Beta Reviewers
Auto-update Tool" community plugin. It installs and keeps beta plugins up to
date directly from a GitHub release.

1. In Obsidian, open **Settings → Community plugins** and make sure
   **Restricted mode** is **off**.
2. Browse the community plugin store and install **BRAT**, then enable it.
3. Open **Settings → BRAT → Beta Plugin List → Add Beta plugin**.
4. Paste the repository URL:

   ```
   https://github.com/KingOfKalk/obisdian-plugin-mcp
   ```

5. Pick **Latest version** and click **Add Plugin**. BRAT downloads
   `main.js`, `manifest.json`, and `styles.css` from the latest GitHub
   release.
6. Open **Settings → Community plugins** and enable **MCP Server**.

BRAT will check for new releases on Obsidian startup and update the plugin
automatically.

### Option B — Manual install

The simplest manual install uses the prebuilt zip attached to each release.
The zip contains an `obsidian-mcp/` folder with `main.js`, `manifest.json`,
and `styles.css` inside, ready to drop into your vault.

1. Open the [latest release](https://github.com/KingOfKalk/obisdian-plugin-mcp/releases)
   and download `obsidian-mcp-<version>.zip` from the **Assets** section.
2. Extract the zip into `<your-vault>/.obsidian/plugins/`. You should end up
   with the folder `<your-vault>/.obsidian/plugins/obsidian-mcp/` containing
   the three plugin files.
3. Reload Obsidian (`Ctrl/Cmd+R` or restart) and enable **MCP Server** under
   **Settings → Community plugins**.

If you'd rather grab the files individually, download `main.js`,
`manifest.json`, and `styles.css` from the same release, create the folder
`<your-vault>/.obsidian/plugins/obsidian-mcp/` yourself, and drop the three
files into it.

---

## Basic setup (5 minutes)

The shipping defaults are intentionally conservative: the server is **off**,
**auth is on**, and binding is restricted to `127.0.0.1`. The plugin
auto-generates a 32-byte access key on first load. Walk through these
steps once after install:

1. **Open the settings tab**: **Settings → MCP Server**.
2. **Copy the auto-generated access key**. The plugin already populated
   it on first load; click the **Copy** button next to **Access Key**.
   - If you'd rather run unauthenticated (only safe on a trusted,
     localhost-only setup), toggle **Require Bearer authentication**
     off, then explicitly toggle **Accept insecure mode** on. The
     server refuses to bind without that second toggle.
3. **(Optional) Pick which feature modules you want**. By default all core
   modules are enabled. Disable anything you don't need (principle of least
   privilege).
4. **Start the server** by flipping the **Status** toggle on, or by running
   the **MCP Server: Start MCP Server** command from the command palette.
   - The status bar will show `MCP :28741` while the server is running.
   - The ribbon icon switches from a plain plug to a "plug-zap" lightning
     icon.
5. **Connect your MCP client**. In the **MCP Client Configuration** section
   click the copy button — the snippet is generated live from your current
   address, port, auth, and key. Paste it into your client's `mcpServers`
   config (e.g. Claude Desktop's `claude_desktop_config.json`, or Claude
   Code's `mcp.json`).

That's it. The client should see the tools advertised by your enabled
modules.

---

## Settings reference

<!-- BEGIN: screenshot-settings -->
![MCP Server settings tab (English, captured from v0.0.0)](../screenshots/en/settings.png)

*Figure 1 — The MCP Server settings tab, captured from plugin v0.0.0.*
<!-- END: screenshot-settings -->

The settings tab is split into five sections.

### 1. Status

| Control | What it does |
|---|---|
| **Status toggle** | Flip on to start the server, off to stop it. While running, the row also shows the server URL and the number of connected clients. |
| **Restart icon** | Appears next to the toggle while the server is running. Click to restart (apply changes that need a fresh listen). |

### 2. Server Settings

| Setting | Default | What it does |
|---|---|---|
| **Server Address** | `127.0.0.1` | IPv4 address the server binds to. `127.0.0.1` is local-only. Setting this to `0.0.0.0` exposes the server on every network interface — only do that with auth enabled and a firewall in front. Requires a restart. |
| **Port** | `28741` | TCP port to listen on. Any integer 1–65535. Restart required. |
| **Server URL** | (read-only) | Full `http(s)://address:port/mcp` URL. The copy button puts it on your clipboard. |
| **Require Bearer authentication** | **on** | Master switch for auth. When on, every request must carry `Authorization: Bearer <key>`. When off, the server **refuses to bind** unless you also turn on **Accept insecure mode** (see below). |
| **Access Key** | (auto-generated) | Visible only when auth is on. On a fresh install with auth on, the plugin auto-generates a 32-byte base64url key on first load and persists it. Use **Generate** to rotate it. The **Copy** button copies it to the clipboard. |
| **Accept insecure mode** | off | Visible only when auth is off. The server refuses to bind without this toggle, so you can't accidentally expose an unauthenticated MCP endpoint. Only safe on a trusted, localhost-only setup. |
| **HTTPS** | off | Switch to HTTPS using a locally generated self-signed certificate. Restart required. See the FAQ for client-side trust. |
| **TLS Certificate** | auto | Generated on the first HTTPS start, then cached in `data.json`. Use **Regenerate certificate** if you change the address or want a fresh key pair — clients will need to re-trust the new cert. |
| **Auto-start on launch** | off | Start the MCP server automatically when Obsidian loads. The server still applies the auth/insecure-mode guard on auto-start, so a misconfigured install stays stopped and the reason is logged. |

#### DNS Rebind Protection

Even though the server binds to `127.0.0.1`, a hostile webpage in your
browser can use **DNS rebinding** to point `attacker.com` at `127.0.0.1`
and reach the loopback port. The server defends against this by
allowlisting the inbound `Origin` and `Host` headers — anything else is
rejected with a `403`.

| Setting | Default | What it does |
|---|---|---|
| **Allowed Origins** | `http://127.0.0.1`, `http://localhost`, `https://127.0.0.1`, `https://localhost` | Exact-match list (one per line). If the request's `Origin` header isn't on the list, it's rejected. Include the port if your client sends it (e.g. `http://127.0.0.1:28741`). |
| **Allowed Hosts** | `127.0.0.1`, `localhost` | Hostname-only list (one per line). The port portion of the inbound `Host` header is stripped before comparison. |
| **Allow Origin: null** | off | When on, requests with `Origin: null` (sandboxed iframes, `file://` pages) are accepted. |
| **Require Origin header** | off | When on, every request must carry an `Origin` header. Tightens browser-side checks but rejects server-side and CLI clients (`curl`, native MCP clients) that don't send `Origin`. |

The settings tab warns you if you add a non-loopback entry to either
list — only widen the allowlist if you understand the DNS-rebind risk.

Rejections are logged at `warn` with the client IP, method, path, and
the offending `Origin`/`Host` values. Body and Authorization headers are
never logged.

### 3. MCP Client Configuration

A single row with a **Copy** button. The JSON snippet is built live from your
current settings:

- Always includes the `url` field with the right scheme and port.
- Includes a `headers` block with `Authorization: Bearer <key>` **only** when
  auth is on **and** the key is non-empty.

Paste it into:

- **Claude Desktop** → `claude_desktop_config.json`, under `mcpServers`.
- **Claude Code** → `~/.claude/mcp.json` (or per-project `.claude/mcp.json`).
- Any other MCP client that supports Streamable HTTP transport.

### 4. Feature Modules

Each module is a collapsible card with one enable/disable toggle. Disabled
modules are hidden from `tools/list`, so the client never sees them.

| Module | Tools | Notes |
|---|---|---|
| Vault and File Operations | 16 | Create / read / update / delete files and folders, rename, move, copy, list, binary I/O, metadata. |
| Search and Metadata | 12 | Full-text search, frontmatter, tags, headings, links, embeds, backlinks, block refs. |
| Editor Operations | 10 | Read/insert/replace/delete text in the active editor, cursor and selection management. |
| Workspace and Navigation | 5 | Inspect / open / focus leaves, read the layout. |
| UI Interactions | 3 | Show notices and confirm/prompt modals. |
| Templates | 3 | List templates, create from template, expand variables. |
| Plugin Interop | 5 | List plugins, run Dataview / Templater queries, execute commands. |

There is also an **Extras** group for utility tools that don't mirror an
Obsidian API. Extras are toggled **per tool**, not per module, and are off by
default. Today this contains:

- `extras_get_date` (Get current date) — returns the current local time as ISO-8601 with offset.

### Execute Command Allowlist

The `plugin_execute_command` (Execute command) tool in Plugin Interop can run any Obsidian
command — including destructive ones (e.g. `app:delete-file`). By default
the allowlist is empty, which means the tool refuses every call with a
clear error. To enable specific commands, add their ids (one per line) to
the **Execute Command Allowlist** section in settings. Only commands on the
allowlist will run; everything else is rejected with the command id echoed
back. Keep the list short and curated — you're granting MCP clients the
same power as the Obsidian command palette.

A **Refresh** button at the top of this section re-discovers modules without
restarting Obsidian (useful when developing modules).

### 5. Diagnostics

| Control | What it does |
|---|---|
| **Debug Mode** | Verbose logging of every MCP request and response. Access keys are **always** redacted. |
| **Log file** | Read-only path to the persistent log at `<vault>/.obsidian/plugins/obsidian-mcp/debug.log`. The file rotates in place at 1 MiB (trims to the most recent 512 KiB). |
| **Copy debug info** | Opens a modal with a copy-pasteable bundle: settings (with the access key replaced by `<set>`/`<empty>` and the cert by `<present>`/`<absent>`), module list, server status, and the most recent log lines. Safe to share when filing a bug. |
| **Clear log** | Empties `debug.log`. |

---

## Commands and UI surfaces

### Command palette

- **MCP Server: Start MCP Server**
- **MCP Server: Stop MCP Server**
- **MCP Server: Restart MCP Server**
- **MCP Server: Copy Access Key**
- **MCP Server: Copy Debug Info**

### Ribbon

- A **plug** icon in the left ribbon. Grey when stopped, "plug-zap"
  (lightning) when running. Click to toggle the server.

### Status bar

- Shows `MCP :<port>` while the server is running. Empty when stopped.
- After a failed start (most commonly because the configured port is already
  in use), the status bar shows `MCP :<port>` with a strike-through in the
  error color. Hover to see the exact error. The indicator stays until the
  next successful start, an explicit stop, or a port change.

---

## For developers / MCP client builders

The MCP server advertises a short set of tool-use hints in the protocol-level
`instructions` field of the `initialize` response. MCP clients (Claude
Desktop, Claude Code, etc.) typically lift this string into the model's
system prompt for the session, so the hints persist across every turn
without being repeated in each tool description.

The current text:

```
This server exposes an Obsidian vault as MCP tools.

- Prefer `search_fulltext` (or other `search_*` tools) before `vault_read` when you don't already know the file path.
- `editor_*` tools operate on the **active** file only — open one with `workspace_open_file` first if needed.
- Paths are vault-relative with forward slashes (e.g. `notes/foo.md`); never absolute filesystem paths.
- Frontmatter, headings, links, embeds, backlinks, and block refs are exposed as separate `vault_get_*` tools — don't parse them out of `vault_read` output.
```

Source of truth: [`src/server/mcp-server.ts`](https://github.com/KingOfKalk/obsidian-plugin-mcp/blob/main/src/server/mcp-server.ts)
(`SERVER_INSTRUCTIONS`). If you suspect drift between the quoted text above
and the live string, the source file wins.

---

## FAQ

### "self-signed certificate" / "unable to verify the first certificate" in my LLM client

When you enable **HTTPS** the plugin generates a local self-signed RSA-2048
certificate (SHA-256, 365-day validity, valid for `localhost`, `127.0.0.1`,
`::1`, and the configured server address). Public CAs cannot validate it, so
your MCP client will refuse the connection by default. You have three
options:

1. **Use plain HTTP on `127.0.0.1`** (simplest). Localhost traffic never
   leaves your machine; HTTPS adds little for a local-only server. Turn HTTPS
   off and use `http://127.0.0.1:28741/mcp`.
2. **Trust the certificate explicitly** in the client. The exact mechanism
   depends on the runtime:
   - Node-based clients: pass `--cafile <path-to-pem>` or set the `ca` option
     when constructing the HTTPS agent.
   - `curl`: `--cacert <path-to-pem>`.
   - System trust stores (macOS Keychain, Windows certmgr, Linux
     `update-ca-trust`) also work but affect every app on the machine.
   The PEM is embedded in `data.json` under `tlsCertificate.cert` — copy it
   into a `.pem` file. Click **Regenerate certificate** in settings whenever
   you rotate the address; clients will then need to re-trust the new cert.
3. **Disable certificate verification in the client**. Convenient for local
   testing, dangerous everywhere else. Only do this if the connection is
   provably local-only.

### My client says "401 Unauthorized" / "Bearer token required"

You enabled **Require Bearer authentication** but the client isn't sending
the right header. Check:

- The `Authorization: Bearer <key>` header is present on every request.
- The `<key>` matches the one in **Settings → MCP Server → Access Key**
  exactly. Use the **Copy** button — never type it by hand.
- Re-copy the **MCP Client Configuration** snippet after generating a new
  key; the snippet is rebuilt from the live key.

### My client says "429 Too Many Requests"

After 5 failed authentication attempts within 60 seconds from the same
client IP, the server temporarily blocks that IP for 30 seconds and
returns HTTP 429 with a `Retry-After` header. This is anti-brute-force
protection and isn't configurable.

- Wait the indicated number of seconds (the `Retry-After` header tells
  you how long), then retry with the correct token.
- A successful authentication clears the failure counter for that IP
  immediately, so once you fix the token, the next request succeeds.
- If you keep hitting this after fixing the token, an old client or
  background process is probably still using the wrong key — close it.

### My client says "403 Forbidden" / "Origin not allowlisted" / "Host not allowlisted"

DNS-rebind protection rejected the request. The server only accepts
requests whose `Origin` and `Host` headers are on the allowlists in
**Server Settings → DNS Rebind Protection**. Causes and fixes:

- **Browser client on a non-default origin**: add the exact origin
  (`scheme://host[:port]`) to **Allowed Origins**. The compare is exact —
  `http://127.0.0.1` and `http://127.0.0.1:28741` are different entries.
- **Custom hostname** (you mapped `obsidian.local` to `127.0.0.1`): add
  the hostname to **Allowed Hosts**.
- **`Origin: null`** (sandboxed iframe, `file://`): turn on **Allow
  Origin: null**.
- **`curl`/CLI without `Origin`** rejected: only happens when **Require
  Origin header** is on. Either send an `Origin` header or turn the
  setting off.

The rejection is logged at `warn` with the offending values and never
hits the rate limiter, so it can't lock you out of authentication.

### The server won't auto-start

Auto-start is gated by the same checks as the manual start button.
Two configurations cause an auto-start to fail silently with an `info`
log entry:

- **Require Bearer authentication** is on but **Access Key** is empty
  (rare — the plugin auto-generates a key on first load, so this
  usually only happens if you cleared the field manually).
- **Require Bearer authentication** is off and **Accept insecure
  mode** is also off. The server refuses to bind in this state so
  unauthenticated traffic is never started by accident. Open the
  settings tab to turn auth back on (and let the plugin generate a
  key) or to explicitly accept insecure mode.

### "EADDRINUSE" / port conflict on start

Another process holds port 28741. Either stop that process or change
**Port** in settings. The plugin only checks the port when starting; you must
restart the server after changing the port.

When this happens you'll see three signals at once:

- A transient Obsidian Notice: "Failed to start MCP server: Port … is
  already in use."
- The status bar shows the port struck through. Hover for the exact error.
- An inline error appears under the **Port** field in settings. Edit the
  port (or pick a new one) to dismiss it; the next successful start clears
  all three.

The toggle under **Server Status** flips back to **off** so clicking it
again retries the start.

### Tool not showing up in my client

- The module that ships the tool is disabled. Enable it under **Feature
  Modules**.
- For Extras tools (e.g. `extras_get_date` (Get current date)), the per-tool toggle is off by default.
- The client cached the previous `tools/list` response. Reconnect.

### How do I expose the server to another machine on my LAN?

1. Set **Server Address** to `0.0.0.0`.
2. Turn on **Require Bearer authentication** and generate a key.
3. Strongly consider enabling **HTTPS** (and follow the trust steps above).
4. Configure your firewall to allow only the hosts you trust to reach the
   port.
5. Restart the server.

The settings UI shows a warning whenever the bind address is anything other
than `127.0.0.1` — read it.

### Where are the settings stored? Are they safe to commit?

Settings live in `<vault>/.obsidian/plugins/obsidian-mcp/data.json`. **Do
not** commit this file: it contains your access key and the cached TLS
private key. Treat it like a secret.

### How do I rotate the access key?

Click **Generate** next to **Access Key**, then re-copy the **MCP Client
Configuration** snippet into every client. Old keys stop working
immediately.

### Where can I see what the server is doing?

- Turn on **Debug Mode** for live request/response logging in the developer
  console (`Ctrl+Shift+I`).
- The persistent log is at
  `<vault>/.obsidian/plugins/obsidian-mcp/debug.log`.
- Use **Copy debug info** to grab a sanitized bundle for bug reports.

### How do I report a bug?

1. Reproduce the issue with **Debug Mode** on.
2. Click **Copy debug info** in **Diagnostics** and paste the bundle into a
   GitHub issue at
   <https://github.com/KingOfKalk/obisdian-plugin-mcp/issues>. The bundle
   never includes your access key or TLS private key, but always re-read it
   before sharing.
