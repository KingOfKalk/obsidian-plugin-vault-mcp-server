import { MCP_ENDPOINT_PATH } from '../constants';
import type { McpPluginSettings } from '../types';

/**
 * Map a stored bind address to the hostname we show users in
 * client-config snippets and copyable URLs. The default loopback
 * (`127.0.0.1`) becomes `localhost` because that is what users
 * type and recognise. Every other address passes through
 * unchanged — `0.0.0.0` and LAN IPs reflect a deliberate user
 * choice and must not be silently rewritten.
 */
export function displayHost(address: string): string {
  return address === '127.0.0.1' ? 'localhost' : address;
}

type AddressSettings = Pick<McpPluginSettings, 'httpsEnabled' | 'serverAddress' | 'port'>;

/** `scheme://host:port` of the server, with the host as {@link displayHost} shows it. */
export function serverOrigin(settings: AddressSettings): string {
  const scheme = settings.httpsEnabled ? 'https' : 'http';
  return `${scheme}://${displayHost(settings.serverAddress)}:${String(settings.port)}`;
}

/** The MCP endpoint URL a client connects to. */
export function serverUrl(settings: AddressSettings): string {
  return serverOrigin(settings) + MCP_ENDPOINT_PATH;
}
