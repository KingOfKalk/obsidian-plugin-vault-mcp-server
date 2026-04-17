export interface McpPluginSettings {
  /** Schema version for settings migration */
  schemaVersion: number;
  /** IP address the MCP server binds to */
  serverAddress: string;
  /** HTTP port for the MCP server */
  port: number;
  /** Access key for bearer token authentication */
  accessKey: string;
  /** Enable HTTPS with self-signed certificate */
  httpsEnabled: boolean;
  /** Enable verbose debug logging */
  debugMode: boolean;
  /** Auto-start the MCP server when Obsidian launches */
  autoStart: boolean;
  /** Per-module enabled/disabled state, keyed by module ID */
  moduleStates: Record<string, ModuleState>;
}

export interface ModuleState {
  enabled: boolean;
  readOnly: boolean;
  /** Per-tool enabled state, keyed by tool name. Only populated for modules in the 'extras' group. */
  toolStates?: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: McpPluginSettings = {
  schemaVersion: 4,
  serverAddress: '127.0.0.1',
  port: 28741,
  accessKey: '',
  httpsEnabled: false,
  debugMode: false,
  autoStart: false,
  moduleStates: {},
};
