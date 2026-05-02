import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { request as httpRequest, IncomingMessage } from 'http';
import { HttpMcpServer, HttpServerOptions } from '../../src/server/http-server';
import { Logger } from '../../src/utils/logger';
import type { OriginHostOptions } from '../../src/server/origin-host';

interface InternalRateLimiter {
  recordFailure: (ip: string) => void;
  recordSuccess: (ip: string) => void;
  check: (ip: string) => { blocked: boolean; retryAfterMs?: number };
}
interface InternalHttpMcpServer {
  rateLimiter: InternalRateLimiter;
}

interface ResponseSnapshot {
  status: number;
  body: string;
  headers: IncomingMessage['headers'];
}

const LOOPBACK_ORIGIN_HOST: OriginHostOptions = {
  allowedOrigins: [
    'http://127.0.0.1',
    'http://localhost',
    'https://127.0.0.1',
    'https://localhost',
  ],
  allowedHosts: ['127.0.0.1', 'localhost'],
  allowNullOrigin: false,
  requireOrigin: false,
};

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

function createServer(
  factorySpy: ReturnType<typeof vi.fn>,
  overrides: Partial<HttpServerOptions> = {},
): HttpMcpServer {
  const opts: HttpServerOptions = {
    host: '127.0.0.1',
    port: 0,
    authEnabled: false,
    accessKey: '',
    sessionSweepIntervalMs: 0,
    originHost: LOOPBACK_ORIGIN_HOST,
    ...overrides,
  };
  return new HttpMcpServer(
    factorySpy as unknown as () => never,
    makeLogger(),
    opts,
  );
}

function send(
  port: number,
  method: string,
  headers: Record<string, string>,
  body: string | undefined = undefined,
): Promise<ResponseSnapshot> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path: '/mcp',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function getPort(server: HttpMcpServer): number {
  // Internal: pull listening port from the underlying http.Server.
  const internal = server as unknown as {
    httpServer: { address: () => AddressInfo | null };
  };
  const addr = internal.httpServer.address();
  if (!addr) {
    throw new Error('server has no address');
  }
  return addr.port;
}

describe('HttpMcpServer — Origin/Host validation', () => {
  let server: HttpMcpServer;
  let factorySpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    factorySpy = vi.fn();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('returns 403 with JSON body for a cross-origin POST', async () => {
    server = createServer(factorySpy);
    await server.start();

    const port = getPort(server);
    const res = await send(
      port,
      'POST',
      {
        Host: '127.0.0.1',
        Origin: 'http://attacker.com',
        'Content-Type': 'application/json',
      },
      '{}',
    );

    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/json');
    const parsed = JSON.parse(res.body) as { error: string };
    expect(parsed.error).toBe('Origin not allowlisted');
  });

  it('returns 403 with CORS headers attached on a cross-origin preflight', async () => {
    server = createServer(factorySpy);
    await server.start();

    const port = getPort(server);
    const res = await send(port, 'OPTIONS', {
      Host: '127.0.0.1',
      Origin: 'http://attacker.com',
      'Access-Control-Request-Method': 'POST',
    });

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeTruthy();
  });

  it('rejects Origin: null by default', async () => {
    server = createServer(factorySpy);
    await server.start();

    const port = getPort(server);
    const res = await send(
      port,
      'POST',
      { Host: '127.0.0.1', Origin: 'null', 'Content-Type': 'application/json' },
      '{}',
    );

    expect(res.status).toBe(403);
  });

  it('accepts Origin: null when allowNullOrigin is true', async () => {
    server = createServer(factorySpy, {
      originHost: { ...LOOPBACK_ORIGIN_HOST, allowNullOrigin: true },
    });
    await server.start();

    const port = getPort(server);
    const res = await send(
      port,
      'POST',
      { Host: '127.0.0.1', Origin: 'null', 'Content-Type': 'application/json' },
      '{}',
    );

    // Past the validator → JSON-RPC parse error path. Anything other than 403.
    expect(res.status).not.toBe(403);
  });

  it('accepts a missing Origin by default', async () => {
    server = createServer(factorySpy);
    await server.start();

    const port = getPort(server);
    const res = await send(
      port,
      'POST',
      { Host: '127.0.0.1', 'Content-Type': 'application/json' },
      '{}',
    );

    expect(res.status).not.toBe(403);
  });

  it('rejects a missing Origin when requireOrigin is true', async () => {
    server = createServer(factorySpy, {
      originHost: { ...LOOPBACK_ORIGIN_HOST, requireOrigin: true },
    });
    await server.start();

    const port = getPort(server);
    const res = await send(
      port,
      'POST',
      { Host: '127.0.0.1', 'Content-Type': 'application/json' },
      '{}',
    );

    expect(res.status).toBe(403);
  });

  it('rejects a hostile Host header', async () => {
    server = createServer(factorySpy);
    await server.start();

    const port = getPort(server);
    const res = await send(
      port,
      'POST',
      {
        Host: 'attacker.com',
        Origin: 'http://127.0.0.1',
        'Content-Type': 'application/json',
      },
      '{}',
    );

    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body) as { error: string };
    expect(parsed.error).toBe('Host not allowlisted');
  });

  it('accepts an allowlisted Host with port suffix', async () => {
    server = createServer(factorySpy);
    await server.start();

    const port = getPort(server);
    const res = await send(
      port,
      'POST',
      {
        Host: `127.0.0.1:${String(port)}`,
        Origin: 'http://127.0.0.1',
        'Content-Type': 'application/json',
      },
      '{}',
    );

    expect(res.status).not.toBe(403);
  });

  it('does not consume the failure rate-limiter budget on rejection', async () => {
    server = createServer(factorySpy, { authEnabled: true, accessKey: 'k' });
    const internal = server as unknown as InternalHttpMcpServer;
    const recordFailure = vi.spyOn(internal.rateLimiter, 'recordFailure');
    await server.start();

    const port = getPort(server);
    await send(
      port,
      'POST',
      {
        Host: 'attacker.com',
        Origin: 'http://attacker.com',
        'Content-Type': 'application/json',
      },
      '{}',
    );

    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('does not dispatch to the JSON-RPC handler on rejection', async () => {
    server = createServer(factorySpy);
    await server.start();

    const port = getPort(server);
    await send(
      port,
      'POST',
      {
        Host: 'attacker.com',
        Origin: 'http://attacker.com',
        'Content-Type': 'application/json',
      },
      '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}',
    );

    expect(factorySpy).not.toHaveBeenCalled();
  });

  // Note: missing/empty Host is covered in `tests/server/origin-host.test.ts`
  // — node's HTTP layer rejects an empty Host header at the parser stage
  // before our handler ever sees it, so a true end-to-end test isn't possible.
});
