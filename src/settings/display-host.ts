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
