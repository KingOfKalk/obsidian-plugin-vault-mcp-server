import type { McpPluginSettings } from '../types';

/** The only address the server binds to while authentication is off. */
export const LOOPBACK_ADDRESS = '127.0.0.1';

export type InsecureBindRefusal =
  | 'insecure_mode_not_accepted'
  | 'insecure_non_loopback';

/**
 * Why the server must not start with authentication off, or `null` when it
 * may. Without authentication the server needs the explicit "Accept insecure
 * mode" opt-in and the loopback address: on any other address every client
 * on the network could use the vault, and the Host allowlist does not stop a
 * non-browser client, which can send any Host header (#558).
 */
export function insecureBindRefusal(
  settings: Pick<McpPluginSettings, 'authEnabled' | 'iAcceptInsecureMode' | 'serverAddress'>,
): InsecureBindRefusal | null {
  if (settings.authEnabled) return null;
  if (!settings.iAcceptInsecureMode) return 'insecure_mode_not_accepted';
  if (settings.serverAddress !== LOOPBACK_ADDRESS) return 'insecure_non_loopback';
  return null;
}
