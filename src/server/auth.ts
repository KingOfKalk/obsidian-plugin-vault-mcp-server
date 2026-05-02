import { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';

export interface AuthResult {
  authenticated: boolean;
  error?: string;
}

export function authenticateRequest(
  req: IncomingMessage,
  accessKey: string,
  authEnabled: boolean,
): AuthResult {
  if (!authEnabled) {
    return { authenticated: true };
  }

  if (!accessKey || accessKey.length === 0) {
    return { authenticated: false, error: 'Server access key is not configured' };
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return { authenticated: false, error: 'Missing Authorization header' };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { authenticated: false, error: 'Invalid Authorization header format. Expected: Bearer <key>' };
  }

  const token = parts[1];
  if (!constantTimeEqual(token, accessKey)) {
    return { authenticated: false, error: 'Invalid access key' };
  }

  return { authenticated: true };
}

/**
 * Constant-time string compare designed to avoid leaking information
 * about either operand via timing.
 *
 * Both inputs are zero-padded to a common length so `timingSafeEqual`
 * always runs over equal-sized buffers. The length-equality check is
 * AND-ed into the result *after* the timing-safe compare so a length
 * mismatch never short-circuits the work.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const length = Math.max(aBuf.length, bBuf.length, 1);
  const aPadded = Buffer.alloc(length);
  const bPadded = Buffer.alloc(length);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  const equal = timingSafeEqual(aPadded, bPadded);
  return equal && aBuf.length === bBuf.length;
}

export function sendAuthError(res: ServerResponse, error: string): void {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(JSON.stringify({ error }));
}

export function sendRateLimitError(
  res: ServerResponse,
  retryAfterMs: number,
): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Retry-After': String(retryAfterSeconds),
  });
  res.end(JSON.stringify({ error: 'Too many failed authentication attempts' }));
}
