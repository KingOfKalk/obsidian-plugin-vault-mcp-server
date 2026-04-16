import { IncomingMessage, ServerResponse } from 'http';

export interface AuthResult {
  authenticated: boolean;
  error?: string;
}

export function authenticateRequest(
  req: IncomingMessage,
  accessKey: string,
): AuthResult {
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
  if (token !== accessKey) {
    return { authenticated: false, error: 'Invalid access key' };
  }

  return { authenticated: true };
}

export function sendAuthError(res: ServerResponse, error: string): void {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(JSON.stringify({ error }));
}
