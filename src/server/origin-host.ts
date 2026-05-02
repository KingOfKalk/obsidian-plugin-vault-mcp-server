import type { IncomingMessage, IncomingHttpHeaders } from 'http';

/**
 * Settings consumed by `validateOriginHost`. Mirrors the subset of
 * `McpPluginSettings` relevant to DNS-rebind protection so the validator
 * stays decoupled from the full settings type and trivially testable.
 */
export interface OriginHostOptions {
  /**
   * Exact origins (scheme + host [+ port]) that may issue requests.
   * Compared case-insensitively after stripping a trailing slash.
   */
  allowedOrigins: string[];
  /**
   * Hostnames that may appear in the `Host` header. The port portion of
   * the header is stripped before comparison; entries here are bare
   * hostnames (e.g. `127.0.0.1`, `localhost`, `::1`).
   */
  allowedHosts: string[];
  /** When true, treat literal `Origin: null` as allowed. */
  allowNullOrigin: boolean;
  /** When true, requests without an `Origin` header are rejected. */
  requireOrigin: boolean;
}

/** Discriminated result returned by {@link validateOriginHost}. */
export type OriginHostResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      origin: string | undefined;
      host: string | undefined;
    };

/**
 * Validate the `Origin` and `Host` of an inbound request against the
 * configured allowlists. The check protects loopback HTTP servers from
 * DNS-rebind attacks: a hostile webpage can only reach the server if it
 * arrives with an allowlisted `Origin` AND `Host`.
 */
export function validateOriginHost(
  req: IncomingMessage,
  opts: OriginHostOptions,
): OriginHostResult {
  const headers = req.headers;
  const origin = pickHeader(headers, 'origin');
  const host = pickHeader(headers, 'host');

  // Host first: every request must carry an allowlisted Host.
  if (host === undefined || host.length === 0) {
    return { ok: false, reason: 'Missing Host header', origin, host };
  }
  const hostName = stripPort(host).toLowerCase();
  const allowedHostsLower = opts.allowedHosts.map((h) => h.toLowerCase());
  if (!allowedHostsLower.includes(hostName)) {
    return { ok: false, reason: 'Host not allowlisted', origin, host };
  }

  // Origin handling.
  if (origin === undefined) {
    if (opts.requireOrigin) {
      return { ok: false, reason: 'Missing Origin header', origin, host };
    }
    return { ok: true };
  }

  if (origin === 'null') {
    if (opts.allowNullOrigin) {
      return { ok: true };
    }
    return { ok: false, reason: 'Origin "null" not allowed', origin, host };
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const allowedOriginsNormalized = opts.allowedOrigins.map(normalizeOrigin);
  if (!allowedOriginsNormalized.includes(normalizedOrigin)) {
    return { ok: false, reason: 'Origin not allowlisted', origin, host };
  }

  return { ok: true };
}

function pickHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Strip a `:port` suffix from a `Host` header value while preserving the
 * IPv6 bracketed form (`[::1]:28741` → `::1`).
 */
function stripPort(host: string): string {
  // IPv6 bracketed form: `[addr]:port` or just `[addr]`.
  if (host.startsWith('[')) {
    const closing = host.indexOf(']');
    if (closing === -1) {
      return host;
    }
    return host.slice(1, closing);
  }
  // Plain hostname or IPv4 — last colon separates the port. Bare IPv6 (no
  // brackets) shouldn't appear in a Host header per RFC 7230, so the
  // last-colon rule is safe for the realistic cases.
  const colon = host.lastIndexOf(':');
  if (colon === -1) {
    return host;
  }
  return host.slice(0, colon);
}

/**
 * Normalize an origin for comparison: lowercase and trim a trailing `/`.
 * The Origin header is always `scheme://host[:port]` per RFC 6454; we
 * leave the port untouched because the issue requires exact comparison.
 */
function normalizeOrigin(value: string): string {
  let v = value.trim().toLowerCase();
  if (v.endsWith('/')) {
    v = v.slice(0, -1);
  }
  return v;
}
