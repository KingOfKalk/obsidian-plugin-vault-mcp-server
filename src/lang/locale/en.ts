// English is the source of truth. Every translation key MUST exist here;
// other locales are `Partial<typeof en>` and fall back to English for
// missing keys. Keep keys in snake_case and scoped by surface.

const en = {
  // Settings — Server Status section
  heading_server_status: 'Server Status',
  setting_status_name: 'Status',
  status_stopped: 'Stopped',
  status_running_one: 'Running on {url} (1 connection)',
  status_running_many: 'Running on {url} ({count} connections)',
  tooltip_start_server: 'Start MCP server',
  tooltip_stop_server: 'Stop MCP server',
  tooltip_restart_server: 'Restart server',

  // Settings — Server Settings section
  heading_server_settings: 'Server Settings',
  setting_server_address_name: 'Server Address',
  setting_server_address_desc:
    'IP address the server binds to (default: 127.0.0.1). Requires restart.',
  warning_non_localhost:
    'Warning: Non-localhost address exposes the server to the network. Ensure an access key is set.',
  error_invalid_ipv4: 'Invalid IPv4 address. Expected format: 127.0.0.1',
  setting_port_name: 'Port',
  setting_port_desc: 'HTTP port for the MCP server (default: 28741)',
  error_invalid_port: 'Invalid port. Enter a whole number between 1 and 65535.',
  setting_server_url_name: 'Server URL',
  tooltip_copy_server_url: 'Copy server URL',
  notice_server_url_copied: 'MCP server URL copied to clipboard',
  setting_auth_enabled_name: 'Require Bearer authentication',
  setting_auth_enabled_desc:
    'When on, the server requires a valid Bearer access key on every MCP request. When off, the server refuses to bind unless "Accept insecure mode" is also on — so unauthenticated traffic is never started by accident.',
  setting_access_key_name: 'Access Key',
  setting_access_key_desc:
    'Bearer token for authenticating MCP clients. Auto-generated on first load (32 bytes, base64url) if this field is empty when auth is on.',
  placeholder_access_key: 'Enter access key',
  tooltip_copy_access_key: 'Copy access key',
  notice_access_key_copied: 'Access key copied to clipboard',
  notice_access_key_generated:
    'Generated a fresh 32-byte access key. Open MCP settings to copy it.',
  setting_insecure_mode_name: 'Accept insecure mode',
  setting_insecure_mode_desc:
    'Acknowledge that you want the server to bind with authentication disabled. Required (in addition to turning auth off) for the server to start. Only safe on a trusted, localhost-only setup.',
  notice_insecure_mode_refused:
    'MCP server refused to start: authentication is disabled but "Accept insecure mode" is not on. Open MCP settings to enable auth or accept insecure mode.',
  notice_grandfather_warning:
    'MCP authentication is disabled. The plugin used to default to that, but new installs are secure-by-default. Open MCP settings to turn auth on (recommended) or to keep insecure mode explicitly.',
  tooltip_generate: 'Generate',
  setting_https_name: 'HTTPS',
  setting_https_desc:
    'Serve MCP over HTTPS with a locally generated self-signed certificate. Clients must trust the certificate (or disable certificate verification). Requires restart.',
  setting_tls_cert_name: 'TLS Certificate',
  setting_tls_cert_desc_present:
    'A self-signed certificate is cached. Regenerate to replace it (e.g. after changing the server address).',
  setting_tls_cert_desc_absent:
    'No certificate cached yet — one will be generated on the next server start.',
  tooltip_regenerate_cert: 'Regenerate certificate',
  notice_tls_regenerated: 'TLS certificate regenerated. Restart the server to apply.',
  setting_custom_tls_toggle_name: 'Bring your own certificate',
  setting_custom_tls_toggle_desc:
    'Use your own SSL cert and private key instead of the auto-generated self-signed certificate. Files are read from disk at every server start.',
  heading_custom_tls_group: 'Own SSL certification',
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

  // Settings — DNS Rebind Protection subsection (Origin / Host validation)
  heading_dns_rebind: 'DNS Rebind Protection',
  setting_allowed_origins_name: 'Allowed Origins',
  setting_allowed_origins_desc:
    'One per line. Requests whose Origin header is not on this list are rejected with 403. Default: loopback only (http(s)://127.0.0.1, http(s)://localhost). Match is exact — include the port if your client sends it.',
  setting_allowed_hosts_name: 'Allowed Hosts',
  setting_allowed_hosts_desc:
    'One per line. Requests whose Host header (port stripped) is not on this list are rejected with 403. Default: 127.0.0.1, localhost.',
  setting_allow_null_origin_name: 'Allow Origin: null',
  setting_allow_null_origin_desc:
    'When on, requests with `Origin: null` (sandboxed iframes, file://) are accepted. Off by default — only enable if you know you need it.',
  setting_require_origin_name: 'Require Origin header',
  setting_require_origin_desc:
    'When on, every request must carry an Origin header. Tightens browser-side checks but breaks server-side and CLI clients (curl, native MCP clients) that do not send Origin.',
  warning_non_loopback_origin:
    'Warning: One or more Origins point outside loopback. This widens the attack surface — only do this if you understand DNS-rebind risks.',
  warning_non_loopback_host:
    'Warning: One or more Hosts point outside loopback. This widens the attack surface — only do this if you understand DNS-rebind risks.',
  setting_debug_name: 'Debug Mode',
  setting_debug_desc: 'Enable verbose logging of MCP requests and responses',

  // Settings — MCP Client Configuration section
  heading_mcp_client_config: 'MCP Client Configuration',
  setting_client_config_name: 'Client configuration',
  setting_client_config_desc:
    'Copy the JSON snippet for your MCP client and paste it into the mcpServers section of its config (Claude Desktop, Claude Code, …).',
  tooltip_copy_config: 'Copy configuration',
  notice_config_copied: 'MCP client configuration copied to clipboard',

  // Settings — Feature Modules / Extras section
  heading_feature_modules: 'Feature Modules',
  heading_extras: 'Extras',
  message_no_modules:
    'No modules registered. Click "Refresh Modules" to re-run discovery.',
  button_refresh_modules: 'Refresh Modules',

  // Plugin lifecycle notices (main.ts)
  notice_server_started: 'MCP server started on port {port}',
  notice_server_start_failed: 'Failed to start MCP server: {message}',
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

  // Command palette entries
  command_start_server: 'Start MCP Server',
  command_stop_server: 'Stop MCP Server',
  command_restart_server: 'Restart MCP Server',
  command_copy_access_key: 'Copy Access Key',
  command_copy_debug_info: 'Copy Debug Info',

  // Ribbon icon
  ribbon_mcp_server: 'MCP Server',
  ribbon_tooltip_running: 'MCP Server (running on :{port})',
  ribbon_tooltip_stopped: 'MCP Server (stopped)',
} as const;

export default en;
