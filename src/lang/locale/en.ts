// English is the source of truth. Every translation key MUST exist here;
// other locales are `Partial<typeof en>` and fall back to English for
// missing keys. Keep keys in snake_case and scoped by surface.

const en = {
  // Settings — status row (first group, no heading)
  setting_status_name: 'Status',
  status_stopped: 'Stopped',
  status_running_one: 'Running on {url} (1 connection)',
  status_running_many: 'Running on {url} ({count} connections)',
  tooltip_start_server: 'Start MCP server',
  tooltip_stop_server: 'Stop MCP server',
  tooltip_restart_server: 'Restart server',

  // Settings — Server section
  heading_server: 'Server',
  setting_server_address_name: 'Server address',
  setting_server_address_desc:
    'IP address the server binds to (default: 127.0.0.1). Requires restart.',
  warning_non_localhost:
    'Warning: this address exposes the server to your network. The server starts on it only with authentication on.',
  error_insecure_non_loopback:
    'Authentication is off, so the server won\'t start on this address. Turn on "Require Bearer authentication" or use 127.0.0.1.',
  error_invalid_ipv4: 'Invalid IPv4 address. Expected format: 127.0.0.1',
  setting_port_name: 'Port',
  setting_port_desc: 'HTTP port for the MCP server (default: 28741)',
  error_invalid_port: 'Invalid port. Enter a whole number between 1 and 65535.',
  setting_server_url_name: 'Server URL',
  tooltip_copy_server_url: 'Copy server URL',
  notice_server_url_copied: 'MCP server URL copied to clipboard',
  setting_auth_enabled_name: 'Require Bearer authentication',
  setting_auth_enabled_desc:
    'When on, the server requires a valid Bearer access key on every MCP request. When off, the server starts only on 127.0.0.1 and only if "Accept insecure mode" is also on, so unauthenticated traffic is never started by accident.',
  setting_access_key_name: 'Access key',
  setting_access_key_desc:
    'Bearer token for authenticating MCP clients. Auto-generated on first load (32 bytes, base64url) if this field is empty when auth is on.',
  placeholder_access_key: 'Enter access key',
  tooltip_copy_access_key: 'Copy access key',
  notice_access_key_copied: 'Access key copied to clipboard',
  setting_insecure_mode_name: 'Accept insecure mode',
  setting_insecure_mode_desc:
    'Acknowledge that you want the server to run with authentication off. Required (in addition to turning authentication off) for the server to start. Works only with the server address 127.0.0.1.',
  notice_insecure_mode_refused:
    'Vault MCP Server: server not started. Authentication is off but "Accept insecure mode" is not on. Turn on authentication or accept insecure mode in the plugin settings.',
  notice_insecure_non_loopback_refused:
    'Vault MCP Server: server not started. Authentication is off and the server address is not 127.0.0.1. Turn on authentication or set the server address to 127.0.0.1 in the plugin settings.',
  notice_grandfather_warning:
    'Vault MCP Server: authentication is off. The plugin used to default to that, but new installs are secure by default. Turn authentication on in the plugin settings (recommended) or keep insecure mode explicitly.',
  tooltip_generate: 'Generate',
  setting_https_name: 'HTTPS',
  setting_https_desc:
    'Serve MCP over HTTPS with a locally generated self-signed certificate. Clients must trust the certificate (or disable certificate verification). Requires restart.',
  setting_tls_cert_name: 'TLS certificate',
  setting_tls_cert_desc_present:
    'A self-signed certificate is cached. Regenerate to replace it (e.g. after changing the server address).',
  setting_tls_cert_desc_absent:
    'No certificate cached yet — one will be generated on the next server start.',
  tooltip_regenerate_cert: 'Regenerate certificate',
  notice_tls_regenerated: 'TLS certificate regenerated. Restart the server to apply.',
  setting_custom_tls_toggle_name: 'Bring your own certificate',
  setting_custom_tls_toggle_desc:
    'Use your own TLS certificate and private key instead of the generated self-signed certificate. Files are read from disk at every server start.',
  heading_custom_tls_group: 'Custom TLS certificate',
  setting_custom_tls_cert_name: 'Public certificate (PEM)',
  setting_custom_tls_cert_desc: 'Path: {path}',
  setting_custom_tls_key_name: 'Private key (PEM)',
  setting_custom_tls_key_desc: 'Path: {path}',
  button_browse: 'Browse…',
  label_no_file_selected: 'No file selected',
  dialog_title_pick_cert: 'Select public certificate (PEM)',
  dialog_title_pick_key: 'Select private key (PEM)',
  error_custom_tls_cert_not_readable: "Can't read the certificate file at that path.",
  error_custom_tls_key_not_readable: "Can't read the private-key file at that path.",
  error_custom_tls_invalid_cert: 'The certificate file is not a valid PEM certificate.',
  error_custom_tls_invalid_key: 'The private-key file is not a valid PEM key.',
  error_custom_tls_key_cert_mismatch:
    'The private key does not match the public certificate.',
  error_custom_tls_cert_expired: 'The certificate is past its expiry date.',
  notice_custom_tls_server_refused:
    'MCP server not started — bring-your-own certificate is invalid: {message}',
  setting_autostart_name: 'Auto-start on launch',
  setting_autostart_desc: 'Start MCP server automatically when Obsidian launches',
  setting_resources_enabled_name: 'Expose vault files as MCP resources',
  setting_resources_enabled_desc:
    'When on, MCP hosts can browse and read vault files via the resources surface (obsidian://vault/{path}) in addition to tools. Restart the server to apply changes.',
  setting_prompts_enabled_name: 'Expose MCP slash-command prompts',
  setting_prompts_enabled_desc:
    'When on, MCP hosts can run canned vault workflows (/summarize-note, /find-related, /expand-template) via the prompts surface. Restart the server to apply changes.',

  // Settings — DNS rebind protection group (Origin / Host validation)
  heading_dns_rebind: 'DNS rebind protection',
  setting_allowed_origins_name: 'Allowed origins',
  setting_allowed_origins_desc:
    'One per line. Requests whose Origin header is not on this list are rejected with 403. Default: loopback only (http(s)://127.0.0.1, http(s)://localhost). Match is exact — include the port if your client sends it.',
  setting_allowed_hosts_name: 'Allowed hosts',
  setting_allowed_hosts_desc:
    'One per line. Requests whose Host header (port stripped) is not on this list are rejected with 403. Default: 127.0.0.1, localhost.',
  setting_allow_null_origin_name: 'Allow Origin: null',
  setting_allow_null_origin_desc:
    'When on, requests with `Origin: null` (sandboxed iframes, file://) are accepted. Off by default — only enable if you know you need it.',
  setting_require_origin_name: 'Require Origin header',
  setting_require_origin_desc:
    'When on, every request must carry an Origin header. Tightens browser-side checks but breaks server-side and CLI clients (curl, native MCP clients) that do not send Origin.',
  warning_non_loopback_origin:
    'Warning: one or more origins point outside loopback. This widens the attack surface — only do this if you understand DNS-rebind risks.',
  warning_non_loopback_host:
    'Warning: one or more hosts point outside loopback. This widens the attack surface — only do this if you understand DNS-rebind risks.',
  setting_debug_name: 'Debug mode',
  setting_debug_desc: 'Log the method and URL of each request plus session and tool events',

  // Settings — MCP client configuration section
  heading_mcp_client_config: 'MCP client configuration',
  setting_client_config_name: 'Client configuration',
  setting_client_config_desc:
    'Copy the JSON snippet for your MCP client and paste it into the mcpServers section of its config (Claude Desktop, Claude Code, …). It contains your access key: keep it out of git, e.g. with ${VAR} in the .mcp.json of Claude Code (see the manual).',
  tooltip_copy_config: 'Copy configuration',
  notice_config_copied: 'MCP client configuration copied to clipboard',

  // Settings — Feature modules / Extras section
  heading_feature_modules: 'Feature modules',
  heading_extras: 'Extras',
  message_modules_open_note:
    'The editor, workspace and UI tools act on the note open in Obsidian, not on files in the vault. They are off by default; switch them on if your assistant should work with the open note.',
  message_no_modules:
    'No modules registered. Select "Refresh modules" to run discovery again.',
  button_refresh_modules: 'Refresh modules',
  setting_read_and_edit_only_name: 'Read and edit only',
  setting_read_and_edit_only_desc:
    'Hide the tools that delete or overwrite whole files: vault_delete, vault_delete_folder, vault_update and vault_write_binary. Assistants can still read, create, move, rename and edit notes. Takes effect right away, also for connected clients.',

  // Settings — Command allowlist section
  heading_command_allowlist: 'Command allowlist',
  message_command_allowlist:
    'The plugin_execute_command tool can perform only the Obsidian commands listed here (one command ID per line). While the list is empty, MCP clients do not see the tool at all.',

  // Plugin lifecycle notices (main.ts)
  notice_server_started: 'MCP server started on port {port}',
  notice_server_start_failed: 'Failed to start MCP server: {message}',
  // `{action}` is an English scope such as "save settings" (report-error.ts).
  notice_action_failed: 'Vault MCP Server: {action} failed. See the developer console for details.',
  status_bar_port_in_use: 'Port {port} is already in use',
  settings_port_in_use_error:
    'Port {port} is already in use. Choose a different port.',

  // Settings — Diagnostics section
  heading_diagnostics: 'Diagnostics',
  setting_log_file_name: 'Log file',
  setting_copy_debug_info_name: 'Copy debug info',
  setting_copy_debug_info_desc:
    'Open a preview of the debug info bundle (settings, modules, server status, recent log) and copy it to the clipboard.',
  tooltip_copy_debug_info: 'Open debug info preview',
  setting_clear_log_name: 'Clear log',
  setting_clear_log_desc: 'Empty the persistent debug log file.',
  tooltip_clear_log: 'Clear log file',
  notice_log_cleared: 'Debug log cleared',
  notice_debug_info_copied: 'Debug info copied to clipboard',
  modal_debug_info_title: 'Debug info',
  modal_debug_info_loading: 'Collecting…',
  button_copy: 'Copy',
  button_close: 'Close',

  // Settings — About section
  heading_about: 'About',
  setting_about_version_name: 'Version',
  setting_about_repository_name: 'Repository',
  setting_about_report_issue_name: 'Report an issue',
  setting_about_report_issue_desc:
    'Opens a new GitHub issue with your plugin and Obsidian versions filled in. Paste the output of "Copy debug info" into it.',
  link_report_issue: 'Open a new issue on GitHub',

  // Command palette entries
  command_start_server: 'Start MCP server',
  command_stop_server: 'Stop MCP server',
  command_restart_server: 'Restart MCP server',
  command_copy_access_key: 'Copy access key',
  command_copy_debug_info: 'Copy debug info',

  // Ribbon icon
  ribbon_mcp_server: 'MCP server',
  ribbon_tooltip_running: 'MCP server (running on :{port})',
  ribbon_tooltip_stopped: 'MCP server (stopped)',
} as const;

export default en;
