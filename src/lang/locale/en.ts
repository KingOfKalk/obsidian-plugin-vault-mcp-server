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
    'When on, the server requires a valid Bearer access key on every MCP request. When off, requests are accepted without authentication — only safe on a trusted, localhost-only setup.',
  setting_access_key_name: 'Access Key',
  setting_access_key_desc: 'Bearer token for authenticating MCP clients',
  placeholder_access_key: 'Enter access key',
  tooltip_copy_access_key: 'Copy access key',
  notice_access_key_copied: 'Access key copied to clipboard',
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
