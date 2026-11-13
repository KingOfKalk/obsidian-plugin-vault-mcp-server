# Security

How Vault MCP Server protects your vault, what the defaults are, and what you should keep in mind when you change them. Setting names are the ones in the plugin's settings tab.

Any client that gets past authentication can use every tool you enabled: read, create, change and (unless you turn on **Read and edit only**) delete notes. Treat the access key like a password.

## Server start and network exposure

- **Off until you start it.** The server starts only when you start it: with the ribbon icon, the status toggle in the settings, or the **Start MCP server** and **Restart MCP server** commands. **Auto-start on launch** is off by default; when it is on, the plugin skips the start if the configuration would be refused anyway (no access key, or authentication off without **Accept insecure mode**).
- **Loopback by default.** The server binds to `127.0.0.1`, port `28741`, so other computers cannot reach it. **Server address** accepts IPv4 addresses only.
- **Settings take effect at the next start.** Server address, port, authentication, access key, HTTPS and the Origin and Host allowlists are read when the server starts. Restart it after changing them.

### Network exposure

- With any **Server address** other than `127.0.0.1` (for example `0.0.0.0` or your LAN address), the server is reachable from other machines on that network. The settings show a warning.
- The Host allowlist does not protect such a setup: a client that is not a browser can send any `Host` header. Only the access key does. Keep authentication on, turn on HTTPS, and block the port in your firewall for every network that does not need it.
- Without authentication, the server currently also binds to a non-loopback address once **Accept insecure mode** is on. Do not combine the two.
- Planned: the server refuses to start without authentication on any address other than `127.0.0.1` ([#558](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/558)).

## Authentication

- **On by default.** **Require Bearer authentication** is on in a new install. Every request to `/mcp` must carry `Authorization: Bearer <access key>`. The scheme name is case-insensitive (`bearer` works); the key is compared in constant time.
- **The access key** is generated on first load when authentication is on and no key is set: 32 random bytes from the system's secure random generator, written as 43 base64url characters (256 bits). **Generate** (the refresh icon next to the key) creates a new one. You can also type your own; any non-empty key is accepted, so a typed key is only as strong as you make it. With an empty key, every request is rejected.
- **Wrong or missing key:** `401` with `WWW-Authenticate: Bearer`.
- **Rate limit on failed logins.** Five failed authentications from one IP address within 60 seconds block that address for 30 seconds; every request from it then gets `429` with `Retry-After`, even with the right key. A successful login clears the address's count. The limiter keeps at most 1000 addresses and is active only while authentication is on.
- **Turning authentication off.** With **Require Bearer authentication** off, the server refuses to start unless **Accept insecure mode** is on as well, and every request is then accepted without a key. Turning authentication back on clears **Accept insecure mode**, so you have to accept it again next time. Installs that ran with authentication off and no access key before settings version 10 (secure by default) were moved to insecure mode so they kept working, with a one-time notice.

## Access key handling

- **Keep it secret.** The key gives full access to every enabled tool. The **MCP client configuration** snippet in the settings contains it.
- **Don't commit it.** In a committed Claude Code `.mcp.json`, reference an environment variable instead (`"Authorization": "Bearer ${OBSIDIAN_MCP_TOKEN}"`); see the [manual](help/en.md#keep-the-access-key-out-of-git).
- **Rotate it** if you suspect it leaked: **Generate**, restart the server, update your clients.
- **Stored in plain text** in the plugin's `data.json` (see [Data on disk](#data-on-disk)). Planned: the key moves to Obsidian's secret storage ([#560](https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/issues/560)).

## DNS rebinding protection (Origin and Host)

A web page in your browser could try to reach the local server, for example through a domain that resolves to `127.0.0.1`. The server therefore checks `Host` and `Origin` on every request, before the CORS preflight, before authentication and before the path. A failed check gets `403` with the reason and is logged.

- **Host:** must be present and on **Allowed hosts** (the port is stripped, case-insensitive). Default: `127.0.0.1`, `localhost`.
- **Origin:** if present, it must be on **Allowed origins** (case-insensitive, a trailing `/` ignored, otherwise exact, so include the port if your client sends one). Default: `http://127.0.0.1`, `http://localhost`, `https://127.0.0.1`, `https://localhost`.
- **No Origin:** accepted, because native clients and `curl` usually don't send one. **Require Origin header** rejects such requests; it breaks those clients.
- **`Origin: null`** (sandboxed iframes, `file://` pages): rejected unless **Allow Origin: null** is on.
- The settings warn when an entry on either list points outside loopback.

## CORS

- A request whose `Origin` passed the allowlist gets that origin back in `Access-Control-Allow-Origin`. A request without `Origin` gets `http://localhost`. Origins not on the allowlist never reach this point (`403` above).
- No `Access-Control-Allow-Credentials` header is sent.
- Allowed methods: `GET`, `POST`, `DELETE`, `OPTIONS`. Allowed request headers: `Content-Type`, `Authorization`, `Mcp-Session-Id`, `Mcp-Protocol-Version`, `Last-Event-ID`. Exposed response headers: `Mcp-Session-Id`, `Mcp-Protocol-Version`, `WWW-Authenticate`. Preflight cache: 24 hours.
- A preflight (`OPTIONS /mcp`) is answered with `204` after the Origin and Host check and without authentication, as browsers send it without credentials.

## Request and session limits

- **One endpoint.** Only `/mcp` serves MCP (the query string is ignored); every other path gets `404` before authentication.
- **Body size:** a request body over 4 MiB is rejected.
- **Sessions:** session ids are random UUIDs. At most 32 sessions are open at once; a new session over the limit closes the least recently active one. A session idle for more than 10 minutes is closed (checked every 60 seconds). The client of a closed session gets an error on its next request (`404 Session not found` for a `POST`) and has to start a new session.
- **Stopping** the server frees the port at once and closes every session and connection.

## HTTPS and TLS certificates

HTTPS is off by default. Turn it on under **HTTPS**; the server then speaks only HTTPS on the same port.

### Self-signed certificate (default with HTTPS)

- Generated on the first HTTPS start: RSA-2048 key, SHA-256 signature, valid for 365 days, for `localhost`, `127.0.0.1`, `::1` and the configured server address.
- Cached in `data.json` together with its private key. It is not renewed automatically: after 365 days, or after changing the server address, use **Regenerate certificate** and restart the server.
- Clients must trust it explicitly (for example `curl --cacert`, or the `ca` option / `NODE_EXTRA_CA_CERTS` for Node clients); a public CA cannot verify it. A regenerated certificate must be trusted again.

### Bring your own certificate

- **Bring your own certificate** uses a certificate and private key in PEM format that you pick in the system file dialog. The plugin stores the two absolute paths in `data.json`, not the files' contents.
- Both files are read from disk at every server start. These are the only files outside the vault the plugin reads; it never writes outside the vault.
- Before starting, the plugin checks that the key and the certificate parse, that the key belongs to the certificate and that the certificate has not expired. If a check fails, the server does not start and a notice says why.

## What connected clients can do

- **Modules.** Each module is all or nothing: when it is on, all its tools are listed. A new install has Vault, Search, Templates and Plugin Interop on; Editor, Workspace and UI (they act on the note open in Obsidian) and every Extras tool are off. The Server module (`server_info`) is always on. Switch off what you don't need.
- **Read and edit only** hides `vault_delete`, `vault_delete_folder`, `vault_update` and `vault_write_binary`; calls to them fail like calls to a disabled tool. It applies at once, also to connected clients. Off by default.
- **Resources and prompts.** **Expose vault files as MCP resources** and **Expose MCP slash-command prompts** (both on by default) give clients another way to read notes; they use the same path checks as the tools.
- **Command allowlist.** `plugin_execute_command` runs only the Obsidian command ids you list in the settings. The list is empty by default, and while it is empty the tool is not listed at all. An allowed command runs with the full rights of Obsidian or of the plugin that registered it, so list only commands you trust an AI client to run.
- **Dataview.** `plugin_dataview_query` runs DQL queries only, with HTML output turned off. DataviewJS is never executed.
- **Deleting** moves files to the trash you chose in Obsidian (**Files and links → Deleted files**).
- **Notices.** `ui_notice` shows plain text of at most 1000 characters.
- **Unexpected errors** (for example from the file system) returned to clients have the vault's absolute location turned into vault-relative paths; other absolute paths become `<path>`.

### Path checks

Every path a client passes to a tool, prompt or resource is checked so it stays inside the vault. Rejected:

- empty paths, null bytes and backslashes (`\`)
- percent-encoded `.`, `/` and `\` (`%2e`, `%2f`, `%5c`)
- `..` that would leave the vault after normalisation
- paths inside the vault's config folder (`app.vault.configDir`, usually `.obsidian`), compared case-insensitively and after normalisation, for reads, writes and the destinations of rename, move and copy. The folder holds plugin code and this plugin's `data.json`. Listings and the `obsidian://vault/index` resource leave it out.

## Logging

- The plugin logs to the developer console and to `debug.log` in its folder. Without **Debug mode**, the levels info, warning and error are logged; with it, debug as well.
- **What `debug.log` holds:** server start and stop, module registration, errors (which can name notes), failed logins (the reason only), rate-limited addresses, and requests rejected by the Origin and Host check with the client's IP address, method, path, Origin and Host. **Debug mode** adds the method and URL of every request, session ids as sessions open and close, and tool and prompt registration. Request and response bodies are not logged; a tool call with invalid arguments logs the field names and the validation messages.
- `debug.log` is rotated when it grows past 1 MiB (the last 512 KiB are kept). **Clear log** in the settings empties it.
- **The access key** is not written to the log: no request header other than `Origin` and `Host` is logged. As a second guard, the logger replaces the access key with `[REDACTED]` in every message and logged value. It uses the key the plugin had when it loaded; a key you generate later is covered after Obsidian reloads the plugin.
- **Copy debug info** shows the environment, server status, a few settings (the access key and certificate only as set or not set), the module states and the last 200 lines of `debug.log`, and copies them to the clipboard. Nothing is sent anywhere.

## Data on disk

Both files are in the plugin's folder in the vault's config folder (`<vault>/.obsidian/plugins/vault-mcp-server/`):

| File | Contents |
| --- | --- |
| `data.json` | All settings, in plain text: the access key, the cached self-signed certificate with its private key, the paths of your own certificate and key, the allowlists |
| `debug.log` | The log described above |

- MCP clients cannot read or write them (config folder, see [Path checks](#path-checks)).
- Anything that syncs or backs up the whole vault folder copies them, including the access key and the private key. Exclude the plugin's folder from shared or public copies of the vault, and generate a new key and certificate if a copy leaked.

## Recommendations

- Keep the defaults: loopback address, authentication on, the generated key, loopback-only allowlists.
- Enable only the modules and Extras tools you need; turn on **Read and edit only** if clients should not delete or overwrite files.
- Add commands to the allowlist one by one, only ones that are safe to run unattended.
- For any non-loopback address: authentication on, HTTPS on, firewall rules for the port.
- Don't widen the Origin or Host allowlists unless a browser-based client needs it.
