export interface McpPluginSettings {
  /** Schema version for settings migration */
  schemaVersion: number;
  /** HTTP port for the MCP server */
  port: number;
  /** Access key for bearer token authentication */
  accessKey: string;
  /** Enable HTTPS with self-signed certificate */
  httpsEnabled: boolean;
  /** Enable verbose debug logging */
  debugMode: boolean;
  /** Per-module enabled/disabled state, keyed by module ID */
  moduleStates: Record<string, ModuleState>;
}

export interface ModuleState {
  enabled: boolean;
  readOnly: boolean;
}

export const DEFAULT_SETTINGS: McpPluginSettings = {
  schemaVersion: 1,
  port: 28741,
  accessKey: '',
  httpsEnabled: false,
  debugMode: false,
  moduleStates: {},
};
