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
notices, templates, and plugin interop as MCP tools over **Streamable HTTP**.
Any MCP-capable client (Claude Desktop, Claude Code, Codex, custom agents) can
connect to the server and read or modify your vault programmatically.

- **Desktop only** (Node-only APIs are required)
- **Default endpoint**: `http://localhost:28741/mcp` (or `http://127.0.0.1:28741/mcp` if `localhost` doesn't resolve in your setup)
- **Auth**: HTTP Bearer token, on by default
- **Transport**: Streamable HTTP (MCP SDK 1.x)

---

## Upgrading to 4.0

Version 4.0 has two breaking changes for agents and scripts that call the
tools. Nothing changes in the settings or the UI.

- **`vault_daily_note` no longer creates the note by default.** The
  `create` parameter now defaults to `false`: a call without it only looks
  the note up, and a missing note returns
  `{ "path": …, "created": false, "exists": false }` without `content`.
  **What to do:** pass `create: true` wherever you relied on the note being
  created (for example `{ "create": true }` or
  `{ "date": "2026-01-02", "create": true }`). Calls that already passed
  `create` explicitly behave as before. The `/daily-note` prompt already
  asks for `create: true`, so it still creates a missing note.
- **The `response_format` alias is gone.** Since 3.1.4 the parameter has
  been called `responseFormat`; the old name `response_format` was still
  accepted with a deprecation warning. It now fails like any other unknown
  parameter: `Unknown parameter: response_format. Valid parameters: …`.
  **What to do:** send `responseFormat` instead. If your server log showed
  the warning `called with deprecated parameter "response_format"`, that
  client needs the change.

`server_info` lists both changes under version `4.0.0`.

## Breaking changes in 3.0

The six single-aspect getters have been collapsed into one tool. If your
LLM client or scripts hard-code the old names, update calls as follows:

| Old call | New call |
|---|---|
| `vault_get_frontmatter({ path })` | `vault_get_aspect({ path, aspect: "frontmatter" })` |
| `vault_get_headings({ path })` | `vault_get_aspect({ path, aspect: "headings" })` |
| `vault_get_outgoing_links({ path })` | `vault_get_aspect({ path, aspect: "outgoing_links" })` |
| `vault_get_embeds({ path })` | `vault_get_aspect({ path, aspect: "embeds" })` |
| `vault_get_backlinks({ path })` | `vault_get_aspect({ path, aspect: "backlinks" })` |
| `vault_get_block_references({ path })` | `vault_get_aspect({ path, aspect: "block_references" })` |

---

## Installation

If you are building the plugin from source or running the repository's `npm`
tasks yourself, use **Node.js 22.12.0 or newer**. The packaged release assets
do not require a separate Node install inside Obsidian.

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
   https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server
   ```

5. Pick **Latest version** and click **Add Plugin**. BRAT downloads
   `main.js`, `manifest.json`, and `styles.css` from the latest GitHub
   release.
6. Open **Settings → Community plugins** and enable **MCP Server**.

BRAT will check for new releases on Obsidian startup and update the plugin
automatically.

### Option B — Manual install

The simplest manual install uses the prebuilt zip attached to each release.
The zip contains a `vault-mcp-server/` folder with `main.js`, `manifest.json`,
and `styles.css` inside, ready to drop into your vault.

1. Open the [latest release](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/releases)
   and download `vault-mcp-server-<version>.zip` from the **Assets** section.
2. Extract the zip into `<your-vault>/.obsidian/plugins/`. You should end up
   with the folder `<your-vault>/.obsidian/plugins/vault-mcp-server/` containing
   the three plugin files.
3. Reload Obsidian (`Ctrl/Cmd+R` or restart) and enable **MCP Server** under
   **Settings → Community plugins**.

If you'd rather grab the files individually, download `main.js`,
`manifest.json`, and `styles.css` from the same release, create the folder
`<your-vault>/.obsidian/plugins/vault-mcp-server/` yourself, and drop the three
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

The settings tab is split into six sections.

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
| **Expose vault files as MCP resources** | **on** | When on, MCP hosts can browse and read vault files via the resources surface (`obsidian://vault/{path}`) in addition to tools. Restart the server to apply changes. See [Resources](#resources) below. |
| **Expose MCP slash-command prompts** | **on** | When on, MCP hosts surface canned vault workflows (`/summarize-note`, `/find-related`, `/expand-template`, `/daily-note`, `/fix-broken-links`) as slash commands via the prompts surface. Restart the server to apply changes. See [Prompts](#prompts) below. |

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

- Always includes `"type": "http"` so MCP clients (notably Claude Code)
  recognize the Streamable HTTP transport.
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

Switches take effect right away, also for clients that are already
connected: a tool you switch off disappears from `tools/list` and calls to it
fail with "Tool … disabled"; a tool you switch on is listed and callable. The
server tells connected clients with a `notifications/tools/list_changed`
message. Clients that support it update their tool list immediately; others
see the change after they reconnect. The server instructions (see
[For developers / MCP client builders](#for-developers--mcp-client-builders))
are sent once when a client connects and keep the state from that moment.

| Module | Tools | Notes |
|---|---|---|
| Vault and File Operations | 21 | Create / read / update / delete files and folders, read one section, replace a passage or insert into a section, rename, move, copy, list, binary I/O, metadata, set frontmatter, daily note. |
| Search and Metadata | 6 | Full-text search, list tags, find notes by tag / frontmatter, find resolved / unresolved links. |
| Editor Operations | 10 | Read/insert/replace/delete text in the active editor, cursor and selection management. |
| Workspace and Navigation | 5 | Inspect / open / focus leaves, read the layout. |
| UI Interactions | 1 | Show notices. |
| Templates | 3 | List templates, create from template, expand variables. |
| Plugin Interop | 6 | List / check plugins, run / describe Dataview queries, describe Templater templates, execute commands. |

There is also an **Extras** group for utility tools that don't mirror an
Obsidian API. Extras are toggled **per tool**, not per module, and are off by
default. Today this contains:

- `extras_get_date` (Get current date) — returns the current local time as ISO-8601 with offset.

One tool is **always on** and has no toggle: `server_info` (Get server
info). It reports the plugin version, the ids of the enabled modules and a
short list of agent-relevant changes per version (renamed parameters or
output fields, new tools). Turning every module off still leaves
`server_info` in `tools/list`.

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
| **Log file** | Read-only path to the persistent log at `<vault>/.obsidian/plugins/vault-mcp-server/debug.log`. The file rotates in place at 1 MiB (trims to the most recent 512 KiB). |
| **Copy debug info** | Opens a modal with a copy-pasteable bundle: settings (with the access key replaced by `<set>`/`<empty>` and the cert by `<present>`/`<absent>`), module list, server status, and the most recent log lines. Safe to share when filing a bug. |
| **Clear log** | Empties `debug.log`. |

### 6. About

The last section of the tab.

| Row | What it shows |
|---|---|
| **Version** | The installed plugin version. |
| **Repository** | Link to the plugin's GitHub repository. Opens in your browser. |
| **Report an issue** | Link that opens a new GitHub issue in your browser. The issue body is already filled in with your plugin version, your Obsidian version, and a spot to paste the output of **Copy debug info** (see [Diagnostics](#5-diagnostics)). You need a GitHub account to submit it. |

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

The text is built when a client connects (MCP `initialize`) from the tools
that are switched on at that moment: a hint about a tool you switched off
is left out (the `search_fulltext` line without the Search module, the
`editor_*` line without the Editor module, the `workspace_open_file` and
`vault_list_recursive` parts without their tools, and the write-tool and
`vault_get_aspect` lines without the Vault module). A client that is already
connected keeps the text it got. With every module on, the text is (the
first line carries the running plugin version, here shown as `<version>`):

```
vault-mcp-server v<version>
Call `server_info` for agent-relevant changes (renamed parameters or fields, new tools).

This server exposes an Obsidian vault as MCP tools.

- Find notes by content with `search_fulltext` (note text, not file names); by name with `vault_list_recursive`.
- `editor_*` tools work on the **active** file only (open one with `workspace_open_file`); no expectedMtime check; most fail with "No active editor" if no Markdown view is focused.
- Paths: vault-relative, forward slashes, case-sensitive; files with the extension (e.g. `notes/foo.md`); a leading / is ignored. Never absolute filesystem paths; leaving the vault fails with "Path must not traverse outside the vault". The config folder (usually `.obsidian`) is blocked.
- To edit a note, prefer `vault_replace` or `vault_insert`; `vault_update` only to rewrite a whole file read in one window.
- Frontmatter, headings, links, embeds, backlinks, block refs: use `vault_get_aspect`, don't parse `vault_read` output.
```

The text is sent once per session, in the `initialize` response, so it
reflects the state at connect time. Module and tool switches made later
reach the session through `tools/list` and `notifications/tools/list_changed`,
not through the instructions.

Source of truth: [`src/server/mcp-server.ts`](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/blob/main/src/server/mcp-server.ts)
(`SERVER_INSTRUCTIONS`). If you suspect drift between the quoted text above
and the live string, the source file wins.

### Which version is running?

Models usually don't see the version from the MCP handshake, so the server
shows it in two other places:

- The first line of the `instructions` text above: `vault-mcp-server v<version>`.
- The description of the `server_info` tool, which every client passes to
  the model. Calling `server_info` (no arguments) returns `name`,
  `version`, `enabledModules` and `changes`, a short list of agent-relevant
  changes per version. A version without an entry had no agent-relevant
  changes; the list is not out of date. It is not the full changelog; see
  `CHANGELOG.md` for that.

The server introduces itself as `vault-mcp-server` everywhere: in the MCP
handshake (`serverInfo.name`, which clients show as the server's name), in
the `instructions` text and in `server_info`. Versions up to 3.4.1 sent
`obsidian-mcp-server` in the handshake.

### Tool behaviour worth knowing

The full parameter and output reference for every tool, with an example
call and its response, is in
[`docs/tools.generated.md`](../tools.generated.md). A few behaviours that
clients and agents commonly trip over:

- **Parameters are documented in the input schema.** Tool descriptions hold
  a summary, examples and error notes; each parameter's meaning lives in its
  `description` inside `inputSchema` in `tools/list`. Rules that many tools
  share are written once in the server instructions instead of on every
  tool: the full path rule (each path parameter only says "vault-relative,
  with extension" and gives an example) and the "No active editor" error of
  the `editor_*` tools. Ranges, defaults and limits that the input schema
  states itself (`minimum`, `maximum`, `default`, `enum`) are not repeated
  in the text.
- **Unknown parameters are rejected.** A call with a parameter the tool does
  not declare fails with an error that names it and lists the valid ones,
  e.g. `Unknown parameter: new_name. Valid parameters: path, newName.`
  `tools/list` advertises `additionalProperties: false` for every tool.
- **Listing the vault root.** `vault_list` and `vault_list_recursive` accept
  `""`, `"/"` or `"."` as `path` for the top level of the vault. Tools that
  work on a single file still require a real path. Both return full
  vault-relative paths (`notes/a.md`, not `a.md`).
- **Paths.** Every path is vault-relative with forward slashes and
  case-sensitive, and a file path includes its extension (`notes/a.md`,
  not `notes/a`). A leading `/` is ignored; a path that would leave the
  vault is rejected.
- **The config folder is blocked.** No tool, prompt or resource reads or
  writes inside the vault's config folder (usually `.obsidian`; the plugin
  uses the folder Obsidian reports, so a renamed config folder is covered
  too). It holds plugin code, settings and this plugin's `data.json` with
  the access key. A path in it fails with "Path is inside the Obsidian
  config folder (.obsidian); it cannot be read or written", also when it
  is only the destination of `vault_rename`, `vault_move`, `vault_copy`,
  `vault_rename_folder` or `template_create_from`, and whatever the case
  (`.Obsidian/…`). `vault_list`, `vault_list_recursive` and the
  `obsidian://vault/index` resource leave it out.
- **Reading large files.** `vault_read` returns files of up to 24 000
  characters whole. Longer files come back in windows: the text ends with a
  `[TRUNCATED: …]` footer, and `structuredContent` carries `totalLength`,
  `hasMore` and `nextOffset`. Call `vault_read` again with
  `offset: <nextOffset>` to continue. You can also pass `length` (1–24 000)
  for smaller windows. With `responseFormat: "json"` the JSON text is always
  complete and valid: when escaping (line breaks, quotes) would make a full
  window too long, the window is made shorter, so always continue at
  `nextOffset` rather than at `offset + length`. The paging fields come
  before `content` in the JSON. Never write a single window back with `vault_update`:
  that replaces the whole file and cuts off the rest. Use `vault_replace`
  for targeted edits instead.
- **Editing part of a file.** `vault_replace` takes `path`, `oldString`
  and `newString` and swaps that exact passage (literal text, no regex),
  leaving the rest of the file untouched. `oldString` must occur exactly
  once; if it occurs 0 times, or more than once, the call fails with the
  match count and nothing is written. Add surrounding text to make it
  unique, or pass `replaceAll: true` to replace every occurrence. The edit
  runs through Obsidian's atomic `vault.process()`. `oldString` is matched
  against the raw file text, line endings included, so in a file with
  CRLF line endings a line break in `oldString` must be `\r\n`.
  `structuredContent` is `{ path, replacements, modified }`.
- **Several edits in one call.** Instead of `oldString` and `newString`,
  `vault_replace` also takes `edits`: a list of up to 100
  `{ oldString, newString, replaceAll? }` entries, for example
  `{ "path": "plan.md", "edits": [{ "oldString": "- standup", "newString": "- retro" }, { "oldString": "- [ ] report", "newString": "- [x] report" }] }`.
  Use one form or the other; sending both, or neither, fails. The edits
  are all or nothing: each one is checked against the note as it was
  before the call (each must match exactly once unless that edit sets
  `replaceAll`, and no two edits may match overlapping text), and only
  if every edit passes is the note written, in one atomic step. Text
  inserted by one edit is never matched by another. If an edit fails, the
  error names it by its position, counting from 0 (for example
  `edits[1].oldString not found … (0 matches)` or
  `edits[0] and edits[2] overlap …`), and nothing is written. One
  `expectedMtime` covers the whole call. `structuredContent` is
  `{ path, replacements, edits: [{ index, replacements }], modified }`,
  where `replacements` is the total.
- **Working with one section (`heading`).** A section runs from its
  heading line to the next heading of the same or a higher level (fewer
  `#`), or to the end of the file, so nested subsections belong to it.
  `heading` is the heading text without the `#` marks (`"Log"`), or with
  them to pick a level (`"## Log"`). Only `#`-style headings count; headings
  inside fenced code blocks and in the frontmatter are ignored. The heading
  must match exactly one heading: otherwise the call fails, listing the
  available headings (or the matches) with their line numbers.
  - `vault_read` with `heading` returns only that section, heading line
    included. `structuredContent` adds `heading` (as written, e.g.
    `"## Log"`) and `line` (1-based line of the heading); `offset`,
    `length`, `totalLength` and `nextOffset` then count within the section.
  - `vault_insert` takes `path`, `heading`, `text` and `position` (`"end"`,
    the default, or `"start"`). `end` puts the text right after the
    section's last non-blank line, so blank lines before the next heading
    stay; `start` puts it before the first non-blank line below the
    heading, so blank lines right after the heading stay above the text
    (in an empty section the text goes right below the heading). The text goes in as whole lines, one trailing
    newline is ignored, and the file's line endings are kept; start the
    text with a newline to leave a blank line before it. The edit runs
    through `vault.process()` and accepts `expectedMtime`.
    `structuredContent` is `{ path, heading, position, line, modified }`,
    where `line` is the first inserted line.
- **Appending to a note.** `vault_append` adds `content` at the end of the
  file on a new line: if the file is not empty, does not end with a line
  break and `content` does not start with one, one line break (the file's
  own LF or CRLF) goes in between. So appending `- call Ada` to a list adds
  a new bullet instead of extending the last one. Start `content` with a
  line break to leave a blank line. Before 4.0.2 the text was joined
  directly onto the last line.
- **Detecting concurrent edits (`expectedMtime`).** `vault_update`,
  `vault_append`, `vault_replace`, `vault_insert`, `vault_write_binary` and
  `vault_set_frontmatter` accept an optional `expectedMtime`. Pass the latest
  `modified` value you have: from `vault_read` or `vault_get_metadata`, or
  from the previous write (an ISO-8601 timestamp; epoch milliseconds also
  work). If the file was changed since, for example because you typed in
  it in Obsidian, the call fails with `File changed since expectedMtime`,
  names the file's current modification time, and writes nothing. Re-read
  the file and retry. Every tool that writes file content (`vault_create`,
  `vault_update`, `vault_append`, `vault_replace`, `vault_insert`,
  `vault_set_frontmatter`, `vault_write_binary` and `template_create_from`)
  returns the new `modified`, so several edits in a row can chain it. Without `expectedMtime` the tools
  write unconditionally, as before.
- **Full-text search results per file.** `search_fulltext` searches the
  text of Markdown (`.md`) notes only, not file names or other file types;
  to find a file by name, use `vault_list_recursive`. It returns at most
  `maxMatchesPerFile` matching lines per file (default 5, maximum 100);
  `matchCount` always reports the real number of matches. `limit` and
  `offset` page over files, and `total` and `count` count files. The
  default Markdown text lists only the paths and match counts; the
  matching lines are in `structuredContent` and in the text with
  `responseFormat: "json"`.
- **Frontmatter key search.** `search_by_frontmatter` with only `key` finds
  every note that has that frontmatter property; add `value` to match a
  specific value. For a list property such as `tags: [project, idea]`, a
  note matches when any item equals `value`, so `value: "idea"` finds it.
  Other values are compared as text (the number `5` matches `"5"`, `true`
  matches `"true"`). The key is a top-level key and case-sensitive.
- **Where deleted files go.** `vault_delete` and `vault_delete_folder`
  follow Obsidian's **Settings → Files and links → Deleted files** option:
  the system trash, the vault's `.trash` folder, or permanent deletion.
  Choose "Move to Obsidian trash" or "Move to system trash" if you want to
  be able to restore what an agent deletes. The result's `trashedTo` says
  where it went: `system`, `vault` (the `.trash` folder), `permanent`, or
  `unknown` if the plugin cannot read the setting.
- **Links follow renamed and moved files.** `vault_rename`, `vault_move` and
  `vault_rename_folder` rename through Obsidian, so links to the file are
  updated when **Settings → Files and links → Automatically update internal
  links** is on. With it off, links are not updated and keep pointing at
  the old path, and Obsidian's "Update links" prompt does not appear, so
  the call never waits for someone to answer it. The
  result reports what happened: `autoUpdateLinks` is the setting,
  `updatedFiles` lists the notes whose links were rewritten and
  `linksUpdated` counts those links. When the setting is off and other notes
  link to the moved file or folder, the result carries a `warning`, so the
  agent can tell you the links are now stale. The tools never update links
  against your setting. `vault_rename` and `vault_move` also accept a
  folder; like `vault_rename_folder` they then count the links to every
  file in it (before 4.0.2 they missed those links and gave no warning).
  Renaming, moving or copying onto a path that already exists fails
  (`Destination file already exists!`, or an `EEXIST` error for
  `vault_copy`); nothing is overwritten.
- **Missing folders are created.** `vault_create`, `vault_copy`,
  `vault_move`, `vault_write_binary` and `template_create_from` create any
  folders in the target path that do not exist yet, so writing
  `projects/2026/plan.md` works in an empty vault. If a file has the name of
  a folder in the path, the call fails.
- **No absolute paths in errors.** Error messages never show where your vault
  lives on disk: paths inside the vault appear vault-relative (for example
  `projects/plan.md`), other filesystem paths appear as `<path>`.
- **Changing frontmatter.** `vault_set_frontmatter` sets and removes
  frontmatter keys of a Markdown note without touching the rest of the file:
  `{ "path": "notes/a.md", "set": { "status": "done" }, "remove": ["draft"] }`.
  Values can be any JSON value (text, number, true/false, null, list or
  object). Obsidian writes the YAML itself, so key order and formatting are
  kept, and the frontmatter block is created if the note has none. Keys you
  do not list stay as they are; removing a key that is not there is not an
  error. The result's `structuredContent` holds the `path`, the whole
  `frontmatter` after the change and the new `modified` timestamp. Pass
  `expectedMtime` to refuse the change if the note was edited since you
  read it. The call fails if the file does not
  exist, is not a `.md` file, if a key is in both `set` and `remove`, or if
  there is nothing to change (pass `"set": {}` to only remove keys).
- **Frontmatter when creating from a template.** `template_create_from`
  takes an optional `frontmatter` object, so a new note gets its
  properties in the same call:
  `{ "templatePath": "templates/person.md", "destPath": "people/ada.md", "frontmatter": { "email": "ada@example.com" } }`.
  The template is expanded first, then Obsidian sets the keys like
  `vault_set_frontmatter` does: keys from the template stay, keys you pass
  overwrite them. The result's `structuredContent` then also carries the
  note's whole `frontmatter`. Only `.md` destinations accept `frontmatter`;
  otherwise the call fails before any file is created.
- **Tag list with counts.** `search_tags` lists each file once per tag,
  even when the file uses the tag several times. `counts` gives the total
  number of occurrences of each tag; the number of files is the length of
  its `tags` entry. `search_by_tag` also lists each file once.
- **Frontmatter tags count.** `search_tags` and `search_by_tag` see the
  same tags as Obsidian's tag pane: inline `#tags` in the note body and
  the frontmatter `tags` (or `tag`) property, as a list (`tags: [project,
  idea]`) or as a comma- or space-separated string (`tags: project, idea`),
  with or without `#`. A note tagged only in its frontmatter is found by
  `search_by_tag`, and `counts` adds up frontmatter and inline occurrences.
  Before 4.0.1 only inline tags were seen. `search_by_tag` matches the tag
  exactly and case-sensitively: `project` does not find `#Project` or the
  nested `#project/alpha`.
- **Dataview lists as plain text.** `plugin_dataview_query` asks Dataview
  for Markdown without HTML, so a list field in a `TABLE` cell comes back
  as `a, b` instead of `<ul><li>a</li><li>b</li></ul>`. `LIST` and `TASK`
  results are unchanged.
- **Daily note: lookup by default.** `vault_daily_note` only looks the
  note up unless you pass `create: true`. A missing note then returns
  `{ "path": …, "created": false, "exists": false }` with no `content`, and
  nothing is written. With `create: true` a missing note is created from
  the configured template and the response has `"created": true`. Every
  response carries `exists`. Before 4.0 the default was `create: true`; see
  [Upgrading to 4.0](#upgrading-to-40). The tool does not open the note;
  the `/daily-note` prompt opens it with `workspace_open_file`. In a new
  note `{{date}}` is the note's date, `{{time}}` the local time (`HH:mm`)
  and `{{title}}` the file name. If the configured template file is
  missing, the note is created empty, without a warning.
- **Template placeholders.** `template_create_from` and `template_expand`
  fill `{{name}}` placeholders from `variables`. Without a value,
  `{{date}}` is today's date in UTC (`YYYY-MM-DD`), `{{time}}` the current
  time in the computer's locale format and `{{title}}` is `Untitled`, not
  the new note's name; pass `title` to set it. Unknown placeholders and
  Templater `<% %>` code stay as written. `template_list` lists only the
  files directly in the top-level folder named `templates`, not the folder
  set in the Templates or Templater plugin.
- **Editor positions.** The `editor_*` tools use 0-based lines and
  columns. A range runs from (`fromLine`, `fromCh`) up to, but not
  including, (`toLine`, `toCh`): to replace `abc` starting at column 4 of
  line 3, pass `fromLine: 3, fromCh: 4, toLine: 3, toCh: 7`.
- **Backlinks with context.** `vault_get_aspect` with
  `aspect: "backlinks"` returns the paths of the linking files. Add
  `includeContext: true` to also get `backlinkContext`: for each linking
  file, the 1-based line number and the text of every line that links to
  the note (wikilinks and embeds, taken from Obsidian's metadata cache).
  Links without a line position, such as links in frontmatter, give an
  empty `matches` list. Without `includeContext` the output is unchanged.
  A path that does not exist fails with `File not found` for every aspect;
  before 4.0.2 `backlinks` answered "has no backlinks" instead.
- **Opening a note in a view mode.** `workspace_open_file` opens the file
  in the active tab (a new tab if that tab is pinned) and focuses it. Pass
  `mode` to choose the view of a Markdown note: `"source"` (Source mode),
  `"live"` (Live Preview) or `"preview"` (Reading view); without it,
  Obsidian's default view applies. Before 4.0.2 `mode` was accepted but
  ignored.
- **Confirmation prompts.** Tools that change or remove existing content
  are marked destructive in their annotations (`destructiveHint`), so
  clients that ask before destructive calls ask for them.
  `vault_set_frontmatter` is one of them since 4.0.2, because it
  overwrites values and removes keys.
- **Structured output on every tool.** All tools declare an `outputSchema`
  and return `structuredContent`. Write tools keep their plain-text
  confirmation (for example `Created file: notes/a.md`) and add a small
  payload such as `{ "path": "notes/a.md", "created": true, "modified": "…" }` or
  `{ "from": "a.md", "to": "b.md" }`, so agents can chain calls without
  parsing the text.
- **One naming convention: camelCase.** Every parameter and every
  `structuredContent` field uses camelCase (`newName`, `maxMatchesPerFile`,
  `responseFormat`, `hasMore`, …). Paginated tools return `hasMore` and
  `nextOffset`; while `hasMore` is `true`, call again with
  `offset: <nextOffset>`.
- **Choosing text or JSON output.** Most read tools take an optional
  `responseFormat` parameter: `"markdown"` (default) for readable text, or
  `"json"` for the same payload as pretty-printed JSON in the text block.
  `structuredContent` is the same either way.
- **`response_format` was removed.** Versions before 3.1.4 called this
  parameter `response_format`, and versions up to 3.5 still accepted it as
  a deprecated alias. Since 4.0 it is rejected with
  `Unknown parameter: response_format`; use `responseFormat`.
- **Renamed output fields.** These `structuredContent` fields were renamed
  with no alias; update clients that read them:
  `has_more` → `hasMore` and `next_offset` → `nextOffset` (all paginated
  tools), `total_length` → `totalLength` (`vault_read`), `size_bytes` →
  `sizeBytes` (`vault_read_binary`, `vault_write_binary`).

---

## Resources

In addition to tools, the server exposes the vault as **MCP resources** so hosts (Claude Desktop, MCP-compatible IDEs, etc.) can browse and read notes natively without spending tool-use turns.

### URIs

- **`obsidian://vault/index`** — a static JSON listing of every file and folder in the vault. Each file entry carries a ready-to-read URI and mime type. Listings over 25 000 characters are truncated; use the `vault_list_recursive` tool for full enumeration on very large vaults.
- **`obsidian://vault/{path}`** — read any file by its vault-relative path. Markdown, text, JSON, CSV, YAML, HTML, and SVG files are returned as text; other files (images, PDFs, audio, video) are returned as base64 blobs.

Binary files larger than **1 MiB** are refused. Use the `vault_read_binary` tool if you genuinely need a larger file.

### Disabling

If you only want the tools surface, turn off **"Expose vault files as MCP resources"** in *Server Settings* and restart the server. The server then advertises a tools-only capability set.

---

## Prompts

In addition to tools and resources, the server exposes five canned **MCP prompts** so hosts surface them as slash commands. The user picks one, fills in the argument(s), and a pre-canned message lands in the conversation — no need to spell out the full tool sequence.

How the prompts appear depends on the host. Claude Code, for example, surfaces them as `/mcp__obsidian__summarize-note`, `/mcp__obsidian__find-related`, `/mcp__obsidian__expand-template`, `/mcp__obsidian__daily-note`, and `/mcp__obsidian__fix-broken-links`.

### Available prompts

- **`summarize-note`** — argument: `path` (vault-relative). Asks Claude to read the note with `vault_read` and produce a concise summary.
- **`find-related`** — argument: `path` (vault-relative). Asks Claude to read the seed note, then cross-reference it with `search_fulltext` and `vault_get_aspect` (with `aspect: "backlinks"`) and report the most relevant connections.
- **`expand-template`** — argument: `template` (vault-relative path to a template file in the vault's `templates/` folder). Reads the template, surfaces the placeholders that need values, and asks Claude to collect them and call `template_expand` (or `template_create_from` if the user wants a new note written).
- **`daily-note`** — argument: `date` (optional, ISO `YYYY-MM-DD`; omit for today / local time). Asks Claude to call `vault_daily_note` with `create: true` and then `workspace_open_file` on the resulting path, creating the note from the configured daily-notes template if it does not yet exist. Requires the **Daily notes** core plugin to be enabled in Obsidian (`Settings → Core plugins`); the underlying tool reads the plugin's configured `format`, `folder`, and `template` settings — so a German user with `format = "DD.MM.YYYY"` will get filenames like `27.04.2026.md`, exactly as they configured. The `date` argument itself is **ISO-only** (`YYYY-MM-DD`); date strings in other formats are rejected. When the configured template uses Templater syntax (`<%`), the tool copies the template body **verbatim** — Templater is never executed server-side; running the template stays the host client's responsibility.
- **`fix-broken-links`** — argument: `path` (optional, vault-relative). Enumerates broken `[[wikilinks]]` via `search_unresolved_links` and walks Claude through fixing them — retarget to an existing note or delete the link (both with `vault_replace`), or create a stub note at a path with `.md`. With `path`, scopes to that one source note; without, walks the whole vault (capped at ~20 source notes per run, re-run to continue). Each proposed edit lands as a separate tool call so you confirm or reject one at a time. Autocomplete on `path` lists vault notes that currently contain unresolved links.

### Autocomplete

Two prompts support argument autocomplete:

- **`expand-template`** (`template`): the server lists files in the vault's `templates/` folder and filters them by case-insensitive substring match.
- **`fix-broken-links`** (`path`): the server lists vault notes that currently contain unresolved links (sourced from `search_unresolved_links`'s map keys) and filters them by case-insensitive substring match.

Both completers cap at 100 entries. Hosts that implement the MCP `completion/complete` protocol expose this as a dropdown next to the argument input.

### Disabling

If you don't want the slash-command surface, turn off **"Expose MCP slash-command prompts"** in *Server Settings* and restart the server. The server then advertises a server without a prompts capability, and hosts will no longer surface the slash commands.

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
   off and use `http://localhost:28741/mcp`.
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
- The client cached the previous `tools/list` response. The server announces
  every switch with `notifications/tools/list_changed`, but not every client
  reacts to it. Reconnect.

### A tool call fails with "Unknown parameter"

The client sent a parameter the tool does not declare, often a typo or the
wrong case (`new_name` instead of `newName`). The error lists the valid
parameter names; resend the call with one of them. Earlier versions silently
dropped unknown parameters, so a call that "worked" before may now be
rejected. Since 4.0 this includes `response_format`: send `responseFormat`
instead (see [Upgrading to 4.0](#upgrading-to-40)).

### `vault_read` output ends with "[TRUNCATED: …]"

The file is longer than one window (24 000 characters). The footer names the
offset to continue at; call `vault_read` again with that `offset`, or read
`nextOffset` from `structuredContent`. See
[Tool behaviour worth knowing](#tool-behaviour-worth-knowing).

### A write fails with "File changed since expectedMtime"

The call passed `expectedMtime`, and the file was modified after that
time, by you in Obsidian, by sync, or by another tool call. Nothing was
written. Read the file again (`vault_read` returns the current
`modified`), redo the edit on the fresh content, and retry with the new
value. See
[Tool behaviour worth knowing](#tool-behaviour-worth-knowing).

### `vault_replace` fails with "0 matches" or "N matches"

`oldString` must match the file's text exactly (case, whitespace and line
breaks included) and occur exactly once. With 0 matches, re-read the file
and copy the passage verbatim. With more than one match, include more
surrounding text, or pass `replaceAll: true` if every occurrence should
change. Nothing is written when the call fails.

With `edits`, the error starts with the failing edit's position, counting
from 0: `edits[1].oldString not found … (0 matches)` means the second edit.
Fix that edit and resend the whole list; none of the edits were applied.

### `vault_replace` fails with "edits[0] and edits[1] overlap"

Two edits in one `edits` list match the same text, or text that partly
overlaps (the message gives the character position and each edit's match
count). Every edit is matched against the note as it was before the call,
so one edit cannot change text another edit replaces. Merge the two edits
into one, or make their `oldString`s cover separate passages. Nothing was
written.

### `vault_insert` or `vault_read` fails with "Heading not found" or "is ambiguous"

`heading` must match exactly one `#`-style heading of the note, ignoring
headings in code blocks and frontmatter. "Heading not found" lists the
headings the note has, with line numbers: copy the text from there. "Is
ambiguous" lists the matching headings: if they have different levels, add
the `#` marks (`"## Log"` instead of `"Log"`); if they are identical, rename
one of them or use `vault_replace`. `vault_insert` writes nothing when it
fails.

### A tool call fails with "Path is inside the Obsidian config folder"

The path points into the vault's config folder (usually `.obsidian`), which
holds plugin code, settings and this plugin's access key. The server never
reads or writes there, through any tool, prompt or resource. Change those
settings in Obsidian itself.

### `vault_get_aspect` fails with "Cannot read properties of undefined (reading '_zod')"

This was a bug in earlier versions: every `vault_get_aspect` call failed
inside the MCP SDK. Update the plugin to the current release.

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

Settings live in `<vault>/.obsidian/plugins/vault-mcp-server/data.json`. **Do
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
  `<vault>/.obsidian/plugins/vault-mcp-server/debug.log`.
- Use **Copy debug info** to grab a sanitized bundle for bug reports.

### How do I report a bug?

1. Reproduce the issue with **Debug Mode** on.
2. Click **Copy debug info** in **Diagnostics** and copy the bundle.
3. Click **Report an issue** in **About**. It opens a new GitHub issue with
   your plugin and Obsidian versions filled in. Paste the bundle into it.
   You can also open an issue yourself at
   <https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues>. The bundle
   never includes your access key or TLS private key, but always re-read it
   before sharing.
