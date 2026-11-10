/**
 * Settings migrations. Each step bumps data to its target schemaVersion and
 * is pure — no Obsidian APIs, no plugin access. That lets every step have
 * its own unit test without the UI or plugin lifecycle.
 *
 * The values written here are frozen: they are what an install of that age
 * ran with, so they must not follow later changes to `DEFAULT_SETTINGS`.
 */

type Settings = Record<string, unknown>;

/** Run one step on `data`, which is at schemaVersion `from`. */
type MigrationStep = (data: Settings, from: number) => void;

interface ModuleStateShape {
  enabled?: boolean;
  readOnly?: boolean;
  toolStates?: Record<string, boolean>;
}

/** Set every key of `defaults` that is `undefined` in `data`. */
function fillUndefined(data: Settings, defaults: Settings): void {
  for (const [key, value] of Object.entries(defaults)) {
    if (data[key] === undefined) data[key] = value;
  }
}

function moduleStatesOf(data: Settings): Record<string, ModuleStateShape> {
  return (data.moduleStates ?? {}) as Record<string, ModuleStateShape>;
}

/**
 * Schema 0-9 to 10. Each block fills the fields one old version added, and
 * only for data older than that version.
 */
export function migrateToV10(data: Settings, from: number): void {
  if (from < 1) {
    if (!data.port) data.port = 28741;
    if (!data.accessKey) data.accessKey = '';
    fillUndefined(data, { httpsEnabled: false, debugMode: false });
    if (!data.moduleStates) data.moduleStates = {};
  }
  if (from < 2 && !data.serverAddress) data.serverAddress = '127.0.0.1';
  // autoStart defaults off for existing installs so upgrades don't
  // surprise-start the server.
  if (from < 3) fillUndefined(data, { autoStart: false });
  if (from < 4) {
    // Per-module read-only flags are gone; the date tool became a
    // per-tool state of `extras` (renamed to extras_get_date below).
    const moduleStates = moduleStatesOf(data);
    for (const entry of Object.values(moduleStates)) {
      if (entry && typeof entry === 'object') delete entry.readOnly;
    }
    const extras = moduleStates.extras;
    if (extras && extras.toolStates === undefined) {
      extras.toolStates = extras.enabled ? { get_date: true } : {};
    }
    data.moduleStates = moduleStates;
  }
  if (from < 5) fillUndefined(data, { tlsCertificate: null });
  // Bearer auth defaulted off on upgrade to v6, like new installs then.
  if (from < 6) fillUndefined(data, { authEnabled: false });
  // Bring-your-own TLS certificate, off so installs keep the self-signed one.
  if (from < 7) {
    fillUndefined(data, { useCustomTls: false, customTlsCertPath: null, customTlsKeyPath: null });
  }
  // The execute-command allowlist starts empty (= disabled): installs
  // cannot run destructive Obsidian commands until the user opts in.
  if (from < 8 && !Array.isArray(data.executeCommandAllowlist)) {
    data.executeCommandAllowlist = [];
  }
  if (from < 9) {
    // DNS-rebind protection: loopback-only allowlists, so a hostile page
    // resolving attacker.com to 127.0.0.1 cannot reach the endpoint.
    // Literal on purpose: the v9 defaults, not today's.
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
    fillUndefined(data, { allowNullOrigin: false, requireOrigin: false });
  }

  // v10: auth flips secure-by-default. Installs that ran default-insecure
  // (auth off, no key) keep working: grandfather them into
  // iAcceptInsecureMode. The plugin shows a one-time notice on next load
  // (tracked via seenInsecureWarning).
  if (data.iAcceptInsecureMode === undefined) {
    data.iAcceptInsecureMode = data.authEnabled === false && data.accessKey === '';
  }
  fillUndefined(data, { seenInsecureWarning: false });

  // `get_date` was renamed to `extras_get_date`; carry the user's
  // per-tool choice over to the new key.
  const moduleStates = moduleStatesOf(data);
  const toolStates = moduleStates.extras?.toolStates;
  if (toolStates && 'get_date' in toolStates) {
    const value = toolStates.get_date;
    delete toolStates.get_date;
    if (!('extras_get_date' in toolStates)) {
      toolStates.extras_get_date = value;
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

export function migrateV11ToV12(data: Settings): void {
  // Default the new prompts surface on for existing installs. They can
  // disable it in Server Settings if they prefer to skip the
  // slash-command prompts. See
  // docs/superpowers/specs/2026-05-03-mcp-prompts-slash-commands-design.md.
  if (data.promptsEnabled === undefined) data.promptsEnabled = true;
}

/**
 * Modules that were on by default before 5.0 and are off by default for new
 * installs since (#469).
 */
const MODULES_OFF_BY_DEFAULT_SINCE_V5 = ['editor', 'workspace', 'ui'] as const;

export function migrateV12ToV13(data: Settings): void {
  // 5.0 turns editor, workspace and ui off by default for new installs
  // (#469). An existing install keeps what it had: a module without a saved
  // state ran on the old default (on), so write that down. A saved state,
  // on or off, is left as it is. New installs have no data to migrate and
  // get the new defaults.
  const moduleStates = moduleStatesOf(data);
  for (const id of MODULES_OFF_BY_DEFAULT_SINCE_V5) {
    const entry = moduleStates[id];
    if (entry === undefined || typeof entry !== 'object' || typeof entry.enabled !== 'boolean') {
      moduleStates[id] = { enabled: true };
    }
  }
  data.moduleStates = moduleStates;
}

const STEPS: Array<{ target: number; run: MigrationStep }> = [
  { target: 10, run: migrateToV10 },
  { target: 11, run: migrateV10ToV11 },
  { target: 12, run: migrateV11ToV12 },
  { target: 13, run: migrateV12ToV13 },
];

export const CURRENT_SCHEMA_VERSION = 13;

export function migrateSettings(data: Settings): Settings {
  for (const step of STEPS) {
    const from = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
    if (from < step.target) {
      step.run(data, from);
      data.schemaVersion = step.target;
    }
  }
  return data;
}
