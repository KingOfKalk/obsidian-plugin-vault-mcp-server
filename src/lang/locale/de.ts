import type en from './en';

// German translation. Keys are constrained to `keyof typeof en` so a typo
// fails the build, but the value type stays `string` so translations don't
// have to mimic the English literal. Missing keys fall back to English at
// runtime (see `src/lang/helpers.ts`).

const de: Partial<Record<keyof typeof en, string>> = {
  // Server Status section
  heading_server_status: 'Serverstatus',
  setting_status_name: 'Status',
  status_stopped: 'Gestoppt',
  status_running_one: 'Läuft auf {url} (1 Verbindung)',
  status_running_many: 'Läuft auf {url} ({count} Verbindungen)',
  tooltip_start_server: 'MCP-Server starten',
  tooltip_stop_server: 'MCP-Server stoppen',
  tooltip_restart_server: 'Server neu starten',

  // Server Settings section
  heading_server_settings: 'Servereinstellungen',
  setting_server_address_name: 'Serveradresse',
  setting_server_address_desc:
    'IP-Adresse, an die der Server gebunden wird (Standard: 127.0.0.1). Neustart erforderlich.',
  warning_non_localhost:
    'Warnung: Eine Nicht-Localhost-Adresse macht den Server im Netzwerk erreichbar. Stelle sicher, dass ein Zugriffsschlüssel gesetzt ist.',
  error_invalid_ipv4: 'Ungültige IPv4-Adresse. Erwartetes Format: 127.0.0.1',
  setting_port_name: 'Port',
  setting_port_desc: 'HTTP-Port für den MCP-Server (Standard: 28741)',
  error_invalid_port: 'Ungültiger Port. Gib eine ganze Zahl zwischen 1 und 65535 ein.',
  setting_server_url_name: 'Server-URL',
  tooltip_copy_server_url: 'Server-URL kopieren',
  notice_server_url_copied: 'MCP-Server-URL in die Zwischenablage kopiert',
  setting_auth_enabled_name: 'Bearer-Authentifizierung erforderlich',
  setting_auth_enabled_desc:
    'Wenn aktiviert, verlangt der Server bei jeder MCP-Anfrage einen gültigen Bearer-Zugriffsschlüssel. Wenn deaktiviert, werden Anfragen ohne Authentifizierung akzeptiert — nur in einer vertrauenswürdigen, ausschließlich lokal erreichbaren Umgebung sicher.',
  setting_access_key_name: 'Zugriffsschlüssel',
  setting_access_key_desc: 'Bearer-Token zur Authentifizierung von MCP-Clients',
  placeholder_access_key: 'Zugriffsschlüssel eingeben',
  tooltip_copy_access_key: 'Zugriffsschlüssel kopieren',
  notice_access_key_copied: 'Zugriffsschlüssel in die Zwischenablage kopiert',
  tooltip_generate: 'Generieren',
  setting_https_name: 'HTTPS',
  setting_https_desc:
    'MCP über HTTPS mit einem lokal erzeugten selbstsignierten Zertifikat ausliefern. Clients müssen dem Zertifikat vertrauen (oder die Zertifikatsprüfung deaktivieren). Neustart erforderlich.',
  setting_tls_cert_name: 'TLS-Zertifikat',
  setting_tls_cert_desc_present:
    'Ein selbstsigniertes Zertifikat ist gecacht. Neu erzeugen, um es zu ersetzen (z. B. nach Änderung der Serveradresse).',
  setting_tls_cert_desc_absent:
    'Noch kein Zertifikat gecacht — beim nächsten Serverstart wird eines erzeugt.',
  tooltip_regenerate_cert: 'Zertifikat neu erzeugen',
  notice_tls_regenerated:
    'TLS-Zertifikat neu erzeugt. Starte den Server neu, damit es aktiv wird.',
  setting_autostart_name: 'Beim Start automatisch starten',
  setting_autostart_desc: 'MCP-Server automatisch starten, wenn Obsidian gestartet wird',
  setting_debug_name: 'Debug-Modus',
  setting_debug_desc: 'Ausführliches Protokollieren von MCP-Anfragen und -Antworten',

  // MCP Client Configuration section
  heading_mcp_client_config: 'MCP-Client-Konfiguration',
  setting_client_config_name: 'Client-Konfiguration',
  setting_client_config_desc:
    'Kopiere das JSON-Snippet für deinen MCP-Client und füge es in den mcpServers-Abschnitt seiner Konfiguration ein (Claude Desktop, Claude Code, …).',
  tooltip_copy_config: 'Konfiguration kopieren',
  notice_config_copied: 'MCP-Client-Konfiguration in die Zwischenablage kopiert',

  // Feature Modules / Extras section
  heading_feature_modules: 'Funktionsmodule',
  heading_extras: 'Extras',
  message_no_modules:
    'Keine Module registriert. Klicke auf „Module neu laden", um die Erkennung erneut auszuführen.',
  button_refresh_modules: 'Module neu laden',

  // Plugin lifecycle notices
  notice_server_started: 'MCP-Server auf Port {port} gestartet',
  notice_server_start_failed: 'MCP-Server konnte nicht gestartet werden: {message}',

  // Diagnostics section
  heading_diagnostics: 'Diagnose',
  setting_log_file_name: 'Protokolldatei',
  setting_copy_debug_info_name: 'Debug-Infos kopieren',
  setting_copy_debug_info_desc:
    'Öffnet eine Vorschau des Debug-Pakets (Einstellungen, Module, Serverstatus, aktuelles Protokoll) und kopiert es in die Zwischenablage.',
  tooltip_copy_debug_info: 'Debug-Vorschau öffnen',
  setting_clear_log_name: 'Protokoll leeren',
  setting_clear_log_desc: 'Leert die persistente Debug-Protokolldatei.',
  tooltip_clear_log: 'Protokolldatei leeren',
  notice_log_cleared: 'Debug-Protokoll geleert',
  notice_debug_info_copied: 'Debug-Infos in die Zwischenablage kopiert',
  modal_debug_info_title: 'Debug-Infos',
  modal_debug_info_loading: 'Wird zusammengestellt …',
  button_copy: 'Kopieren',
  button_close: 'Schließen',

  // Command palette entries
  command_start_server: 'MCP-Server starten',
  command_stop_server: 'MCP-Server stoppen',
  command_restart_server: 'MCP-Server neu starten',
  command_copy_access_key: 'Zugriffsschlüssel kopieren',
  command_copy_debug_info: 'Debug-Infos kopieren',

  // Ribbon icon
  ribbon_mcp_server: 'MCP-Server',
  ribbon_tooltip_running: 'MCP-Server (läuft auf :{port})',
  ribbon_tooltip_stopped: 'MCP-Server (gestoppt)',
};

export default de;
