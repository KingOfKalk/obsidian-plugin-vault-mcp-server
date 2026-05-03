/**
 * Settings migrations. Each function bumps data from schemaVersion N-1 to N
 * and is pure — no Obsidian APIs, no plugin access. That lets every hop have
 * its own unit test without the UI or plugin lifecycle.
 */

type Settings = Record<string, unknown>;

type MigrationHop = (data: Settings) => void;

interface ModuleStateShape {
  enabled?: boolean;
  readOnly?: boolean;
  toolStates?: Record<string, boolean>;
}

export function migrateV0ToV1(data: Settings): void {
  if (!data.port) data.port = 28741;
  if (!data.accessKey) data.accessKey = '';
  if (data.httpsEnabled === undefined) data.httpsEnabled = false;
  if (data.debugMode === undefined) data.debugMode = false;
  if (!data.moduleStates) data.moduleStates = {};
}

export function migrateV1ToV2(data: Settings): void {
  if (!data.serverAddress) data.serverAddress = '127.0.0.1';
}

export function migrateV2ToV3(data: Settings): void {
  // autoStart defaults off for existing installs so upgrades don't
  // surprise-start the server.
  if (data.autoStart === undefined) data.autoStart = false;
}

export function migrateV3ToV4(data: Settings): void {
  const moduleStates = (data.moduleStates ?? {}) as Record<
    string,
    ModuleStateShape
  >;
  for (const id of Object.keys(moduleStates)) {
    const entry = moduleStates[id];
    if (entry && typeof entry === 'object') {
      delete entry.readOnly;
    }
  }
  const extras = moduleStates.extras;
  if (extras && extras.toolStates === undefined) {
    extras.toolStates = extras.enabled ? { get_date: true } : {};
  }
  data.moduleStates = moduleStates;
}

export function migrateV4ToV5(data: Settings): void {
  if (data.tlsCertificate === undefined) data.tlsCertificate = null;
}

export function migrateV5ToV6(data: Settings): void {
  // Bearer auth defaults off on upgrade so existing installs behave like
  // new installs; users can toggle it back on in Server Settings.
  if (data.authEnabled === undefined) data.authEnabled = false;
}

export function migrateV6ToV7(data: Settings): void {
  // Bring-your-own SSL certificate. Default off so existing installs keep
  // their cached self-signed cert.
  if (data.useCustomTls === undefined) data.useCustomTls = false;
  if (data.customTlsCertPath === undefined) data.customTlsCertPath = null;
  if (data.customTlsKeyPath === undefined) data.customTlsKeyPath = null;
}

export function migrateV7ToV8(data: Settings): void {
  // executeCommand allowlist defaults empty (= disabled) so existing
  // installs cannot accidentally run destructive Obsidian commands via
  // plugin_execute_command. Users opt in per command.
  if (!Array.isArray(data.executeCommandAllowlist)) {
    data.executeCommandAllowlist = [];
  }
}

export function migrateV8ToV9(data: Settings): void {
  // DNS-rebind protection. Default to loopback-only allowlists so the
  // loopback-bound server rejects hostile webpages that resolve
  // attacker.com to 127.0.0.1 and try to fetch the MCP endpoint.
  if (!Array.isArray(data.allowedOrigins)) {
    data.allowedOrigins = [
      'http://127.0.0.1',
      'http://localhost',
      'https://127.0.0.1',
      'https://localhost',
    ];
  }
  if (!Array.isArray(data.allowedHosts)) {
    data.allowedHosts = ['127.0.0.1', 'localhost'];
  }
  if (data.allowNullOrigin === undefined) data.allowNullOrigin = false;
  if (data.requireOrigin === undefined) data.requireOrigin = false;
}

export function migrateV9ToV10(data: Settings): void {
  // Auth flips secure-by-default. Two carry-along concerns:
  //   1. Existing installs that were running default-insecure
  //      (authEnabled === false && accessKey === '') must keep
  //      working after upgrade. Grandfather them by setting
  //      iAcceptInsecureMode: true. The plugin will surface a
  //      one-time notice on next load (tracked via
  //      seenInsecureWarning) so they know about the new posture.
  //   2. The `extras_get_date` tool was renamed from `get_date`. The
  //      per-tool toolStates key needs the same rename so the user's
  //      enabled/disabled choice carries over.
  if (data.iAcceptInsecureMode === undefined) {
    const wasDefaultInsecure =
      data.authEnabled === false && data.accessKey === '';
    data.iAcceptInsecureMode = wasDefaultInsecure;
  }
  if (data.seenInsecureWarning === undefined) {
    data.seenInsecureWarning = false;
  }

  const moduleStates = (data.moduleStates ?? {}) as Record<
    string,
    { enabled?: boolean; toolStates?: Record<string, boolean> }
  >;
  const extras = moduleStates.extras;
  if (extras && extras.toolStates && 'get_date' in extras.toolStates) {
    const value = extras.toolStates.get_date;
    delete extras.toolStates.get_date;
    if (!('extras_get_date' in extras.toolStates)) {
      extras.toolStates.extras_get_date = value;
    }
  }
  data.moduleStates = moduleStates;
}

export function migrateV10ToV11(data: Settings): void {
  // Default the new resources surface on for existing installs. They
  // can disable it in Server Settings if they prefer a tools-only
  // server. See docs/superpowers/specs/2026-05-03-mcp-resources-vault-files-design.md.
  if (data.resourcesEnabled === undefined) data.resourcesEnabled = true;
}

const HOPS: Array<{ target: number; run: MigrationHop }> = [
  { target: 1, run: migrateV0ToV1 },
  { target: 2, run: migrateV1ToV2 },
  { target: 3, run: migrateV2ToV3 },
  { target: 4, run: migrateV3ToV4 },
  { target: 5, run: migrateV4ToV5 },
  { target: 6, run: migrateV5ToV6 },
  { target: 7, run: migrateV6ToV7 },
  { target: 8, run: migrateV7ToV8 },
  { target: 9, run: migrateV8ToV9 },
  { target: 10, run: migrateV9ToV10 },
  { target: 11, run: migrateV10ToV11 },
];

export const CURRENT_SCHEMA_VERSION = 11;

export function migrateSettings(data: Settings): Settings {
  const currentVersion =
    typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  for (const hop of HOPS) {
    if ((typeof data.schemaVersion === 'number' ? data.schemaVersion : 0) < hop.target) {
      hop.run(data);
      data.schemaVersion = hop.target;
    }
  }
  // Touch `currentVersion` to avoid unused-var complaints — keeping it as
  // a local improves readability of the loop above.
  void currentVersion;
  return data;
}
