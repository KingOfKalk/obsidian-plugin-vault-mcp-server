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
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  maxAge: 86400,
};

export function applyCorsHeaders(res: ServerResponse, options: CorsOptions = DEFAULT_CORS_OPTIONS): void {
  res.setHeader('Access-Control-Allow-Origin', options.allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', options.allowMethods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', options.allowHeaders.join(', '));
  res.setHeader('Access-Control-Max-Age', String(options.maxAge));
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

export function handlePreflight(req: IncomingMessage, res: ServerResponse, options: CorsOptions = DEFAULT_CORS_OPTIONS): boolean {
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(res, options);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
