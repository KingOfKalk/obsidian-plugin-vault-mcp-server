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
  setting_custom_tls_toggle_name: 'Eigenes Zertifikat verwenden',
  setting_custom_tls_toggle_desc:
    'Eigenes SSL-Zertifikat und privaten Schlüssel statt des automatisch erzeugten, selbstsignierten Zertifikats verwenden. Die Dateien werden bei jedem Serverstart von der Festplatte gelesen.',
  heading_custom_tls_group: 'Eigenes SSL-Zertifikat',
  setting_custom_tls_cert_name: 'Öffentliches Zertifikat (PEM)',
  setting_custom_tls_cert_desc: 'Pfad: {path}',
  setting_custom_tls_key_name: 'Privater Schlüssel (PEM)',
  setting_custom_tls_key_desc: 'Pfad: {path}',
  button_browse: 'Durchsuchen …',
  label_no_file_selected: 'Keine Datei ausgewählt',
  dialog_title_pick_cert: 'Öffentliches Zertifikat (PEM) auswählen',
  dialog_title_pick_key: 'Privaten Schlüssel (PEM) auswählen',
  error_custom_tls_cert_not_readable:
    'Die Zertifikatsdatei unter diesem Pfad kann nicht gelesen werden.',
  error_custom_tls_key_not_readable:
    'Die Datei des privaten Schlüssels unter diesem Pfad kann nicht gelesen werden.',
  error_custom_tls_invalid_cert:
    'Die Zertifikatsdatei ist kein gültiges PEM-Zertifikat.',
  error_custom_tls_invalid_key:
    'Die Datei des privaten Schlüssels ist kein gültiger PEM-Schlüssel.',
  error_custom_tls_key_cert_mismatch:
    'Der private Schlüssel passt nicht zum öffentlichen Zertifikat.',
  error_custom_tls_cert_expired:
    'Das Zertifikat ist bereits abgelaufen.',
  notice_custom_tls_server_refused:
    'MCP-Server nicht gestartet — das eigene Zertifikat ist ungültig: {message}',
  setting_autostart_name: 'Beim Start automatisch starten',
  setting_autostart_desc: 'MCP-Server automatisch starten, wenn Obsidian gestartet wird',
  setting_resources_enabled_name: 'Vault-Dateien als MCP-Ressourcen freigeben',
  setting_resources_enabled_desc:
    'Wenn aktiviert, können MCP-Hosts Vault-Dateien zusätzlich zu den Tools über die Resources-Schnittstelle (obsidian://vault/{Pfad}) lesen und durchsuchen. Server neu starten, damit die Änderung wirksam wird.',
  setting_prompts_enabled_name: 'MCP-Slash-Befehle freigeben',
  setting_prompts_enabled_desc:
    'Wenn aktiviert, können MCP-Hosts vorgefertigte Vault-Abläufe (/summarize-note, /find-related, /expand-template) über die Prompts-Schnittstelle ausführen. Server neu starten, damit die Änderung wirksam wird.',

  // DNS Rebind Protection
  heading_dns_rebind: 'DNS-Rebind-Schutz',
  setting_allowed_origins_name: 'Erlaubte Origins',
  setting_allowed_origins_desc:
    'Ein Eintrag pro Zeile. Anfragen mit einem Origin-Header außerhalb dieser Liste werden mit 403 abgelehnt. Standard: nur Loopback (http(s)://127.0.0.1, http(s)://localhost). Vergleich ist exakt — Port mit angeben, falls dein Client einen sendet.',
  setting_allowed_hosts_name: 'Erlaubte Hosts',
  setting_allowed_hosts_desc:
    'Ein Eintrag pro Zeile. Anfragen mit einem Host-Header (ohne Port) außerhalb dieser Liste werden mit 403 abgelehnt. Standard: 127.0.0.1, localhost.',
  setting_allow_null_origin_name: 'Origin: null erlauben',
  setting_allow_null_origin_desc:
    'Wenn aktiviert, werden Anfragen mit „Origin: null" (Sandbox-iframes, file://) akzeptiert. Standardmäßig aus — nur einschalten, wenn du es wirklich brauchst.',
  setting_require_origin_name: 'Origin-Header verpflichtend',
  setting_require_origin_desc:
    'Wenn aktiviert, muss jede Anfrage einen Origin-Header tragen. Verschärft die Browser-Prüfung, bricht aber Server- und CLI-Clients (curl, native MCP-Clients), die keinen Origin senden.',
  warning_non_loopback_origin:
    'Warnung: Mindestens ein Origin liegt außerhalb von Loopback. Das vergrößert die Angriffsfläche — nur aktivieren, wenn du DNS-Rebind-Risiken verstehst.',
  warning_non_loopback_host:
    'Warnung: Mindestens ein Host liegt außerhalb von Loopback. Das vergrößert die Angriffsfläche — nur aktivieren, wenn du DNS-Rebind-Risiken verstehst.',
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
  status_bar_port_in_use: 'Port {port} ist bereits belegt',
  settings_port_in_use_error:
    'Port {port} ist bereits belegt. Wähle einen anderen Port.',

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
