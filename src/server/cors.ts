import { IncomingMessage, ServerResponse } from 'http';

export interface CorsOptions {
  allowOrigin: string;
  allowMethods: string[];
  allowHeaders: string[];
  maxAge: number;
}

export const DEFAULT_CORS_OPTIONS: CorsOptions = {
  allowOrigin: 'http://localhost',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  // Mcp-Protocol-Version is sent on every request after initialize, and
  // Last-Event-ID when a client resumes an SSE stream. Without them a
  // browser client fails the preflight for everything but initialize.
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'Mcp-Session-Id',
    'Mcp-Protocol-Version',
    'Last-Event-ID',
  ],
  maxAge: 86400,
};

/**
 * Response headers a browser client may read. `Mcp-Session-Id` carries the
 * session, `Mcp-Protocol-Version` the negotiated version, and
 * `WWW-Authenticate` the auth challenge on a 401.
 */
export const EXPOSED_HEADERS = ['Mcp-Session-Id', 'Mcp-Protocol-Version', 'WWW-Authenticate'];

/**
 * Set the CORS response headers.
 *
 * `allowedRequestOrigin` is the request's `Origin` once it has passed the
 * Origin allowlist (`validateOriginHost`). It is echoed back, so every
 * allowlisted origin works in a browser, not only `options.allowOrigin`.
 * Never pass an origin that has not been validated.
 */
export function applyCorsHeaders(
  res: ServerResponse,
  options: CorsOptions = DEFAULT_CORS_OPTIONS,
  allowedRequestOrigin?: string,
): void {
  res.setHeader('Access-Control-Allow-Origin', allowedRequestOrigin ?? options.allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', options.allowMethods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', options.allowHeaders.join(', '));
  res.setHeader('Access-Control-Max-Age', String(options.maxAge));
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));
}

export function handlePreflight(
  req: IncomingMessage,
  res: ServerResponse,
  options: CorsOptions = DEFAULT_CORS_OPTIONS,
  allowedRequestOrigin?: string,
): boolean {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res, options, allowedRequestOrigin);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
