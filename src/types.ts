export interface McpPluginSettings {
  /** Schema version for settings migration */
  schemaVersion: number;
  /** IP address the MCP server binds to */
  serverAddress: string;
  /** HTTP port for the MCP server */
  port: number;
  /** When true, the server requires a Bearer access key on every request. */
  authEnabled: boolean;
  /** Access key for bearer token authentication */
  accessKey: string;
  /** Enable HTTPS with self-signed certificate */
  httpsEnabled: boolean;
  /** Cached self-signed TLS certificate (PEM). Regenerated on demand. */
  tlsCertificate: TlsCertificateData | null;
  /** When true, the server loads a user-provided cert/key pair from disk instead of the auto-generated self-signed cert. */
  useCustomTls: boolean;
  /** Absolute filesystem path to the user-provided public certificate (PEM). */
  customTlsCertPath: string | null;
  /** Absolute filesystem path to the user-provided private key (PEM). */
  customTlsKeyPath: string | null;
  /** Enable verbose debug logging */
  debugMode: boolean;
  /** Auto-start the MCP server when Obsidian launches */
  autoStart: boolean;
  /**
   * When true, the server exposes vault files as MCP resources
   * (obsidian://vault/{+path} template + obsidian://vault/index static)
   * in addition to tools. Default true.
   */
  resourcesEnabled: boolean;
  /**
   * When true, the server exposes canned slash-command prompts via the
   * MCP prompts surface (`/summarize-note`, `/find-related`,
   * `/expand-template`). Default true.
   */
  promptsEnabled: boolean;
  /**
   * Allowlist of Obsidian command ids that `plugin_execute_command` is
   * permitted to run. Empty (the default) means command execution is
   * disabled and the tool refuses every call with a clear error.
   */
  executeCommandAllowlist: string[];
  /**
   * Origins (scheme + host [+ port]) allowed to issue requests. Used to
   * block DNS-rebind attacks. Defaults to the loopback variants only.
   */
  allowedOrigins: string[];
  /**
   * Hostnames allowed to appear in the `Host` header. The port portion is
   * stripped before comparison. Defaults to `127.0.0.1` and `localhost`.
   */
  allowedHosts: string[];
  /**
   * When true, requests with `Origin: null` (sandboxed iframes, file://)
   * are accepted. Default false.
   */
  allowNullOrigin: boolean;
  /**
   * When true, every request must carry an `Origin` header — server-side
   * MCP clients without `Origin` get rejected. Default false to keep
   * `curl`/native clients working.
   */
  requireOrigin: boolean;
  /**
   * Explicit acknowledgement that running the server with
   * `authEnabled === false` is acceptable. Defaults to `false`.
   * When `authEnabled === false && iAcceptInsecureMode !== true`, the
   * server refuses to bind. Existing installs that were running
   * default-insecure pre-v10 are grandfathered to `true` by the
   * v9 → v10 migration so they keep working after upgrade.
   */
  iAcceptInsecureMode: boolean;
  /**
   * Internal one-shot flag: did we already show the user the
   * "auth is disabled" grandfather notice on plugin load? Persisted so
   * the warning fires exactly once, never again.
   */
  seenInsecureWarning: boolean;
  /** Per-module enabled/disabled state, keyed by module ID */
  moduleStates: Record<string, ModuleState>;
}

export interface TlsCertificateData {
  cert: string;
  key: string;
}

export interface ModuleState {
  enabled: boolean;
  /** Per-tool enabled state, keyed by tool name. Only populated for modules in the 'extras' group. */
  toolStates?: Record<string, boolean>;
}

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://127.0.0.1',
  'http://localhost',
  'https://127.0.0.1',
  'https://localhost',
] as const;

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  '127.0.0.1',
  'localhost',
] as const;

export const DEFAULT_SETTINGS: McpPluginSettings = {
  schemaVersion: 12,
  serverAddress: '127.0.0.1',
  port: 28741,
  authEnabled: true,
  accessKey: '',
  httpsEnabled: false,
  tlsCertificate: null,
  useCustomTls: false,
  customTlsCertPath: null,
  customTlsKeyPath: null,
  debugMode: false,
  autoStart: false,
  resourcesEnabled: true,
  promptsEnabled: true,
  executeCommandAllowlist: [],
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
  allowedHosts: [...DEFAULT_ALLOWED_HOSTS],
  allowNullOrigin: false,
  requireOrigin: false,
  iAcceptInsecureMode: false,
  seenInsecureWarning: false,
  moduleStates: {},
};
