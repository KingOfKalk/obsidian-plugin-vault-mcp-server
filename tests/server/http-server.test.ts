import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { request as httpRequest, IncomingMessage } from 'http';
import { McpServer } from '@modelcontextprotocol/server';
import {
  DEFAULT_MAX_SESSIONS,
  HttpMcpServer,
  HttpServerOptions,
} from '../../src/server/http-server';
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
  path = '/mcp',
): Promise<ResponseSnapshot> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
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

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'http-server-test', version: '0' },
  },
});

const MCP_POST_HEADERS: Record<string, string> = {
  Host: '127.0.0.1',
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

interface TrackedServer {
  closed: () => boolean;
}

/** A real, empty McpServer per session that records when it is closed. */
function trackingFactory(): {
  factory: ReturnType<typeof vi.fn>;
  created: TrackedServer[];
} {
  const created: TrackedServer[] = [];
  const factory = vi.fn((): McpServer => {
    const server = new McpServer({ name: 'test', version: '0' });
    let closed = false;
    const original = server.close.bind(server);
    server.close = async (): Promise<void> => {
      closed = true;
      await original();
    };
    created.push({ closed: () => closed });
    return server;
  });
  return { factory, created };
}

function initialize(port: number, path = '/mcp'): Promise<ResponseSnapshot> {
  return send(port, 'POST', MCP_POST_HEADERS, INITIALIZE_BODY, path);
}

function sessionIdOf(res: ResponseSnapshot): string {
  const id = res.headers['mcp-session-id'];
  if (typeof id !== 'string') {
    throw new Error(`no session id (status ${String(res.status)}): ${res.body}`);
  }
  return id;
}

/** A request that only an initialized session accepts (answers 202). */
function sendInitialized(port: number, sessionId: string): Promise<ResponseSnapshot> {
  return send(
    port,
    'POST',
    {
      ...MCP_POST_HEADERS,
      'Mcp-Session-Id': sessionId,
      'Mcp-Protocol-Version': '2025-11-25',
    },
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  );
}

describe('HttpMcpServer — endpoint path', () => {
  let server: HttpMcpServer;

  afterEach(async () => {
    await server.stop();
  });

  it.each(['/mcp', '/mcp?x=1'])('serves MCP on %s', async (path) => {
    const { factory } = trackingFactory();
    server = createServer(factory);
    await server.start();

    const res = await initialize(getPort(server), path);

    expect(res.status).toBe(200);
    expect(sessionIdOf(res)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(['/', '/?x=1', '/mcp/', '/MCP', '/foo', '/mcpx', '/mcp/extra', '/api/mcp', '/favicon.ico'])(
    'answers 404 with JSON on %s and creates no session',
    async (path) => {
      const { factory } = trackingFactory();
      server = createServer(factory);
      await server.start();

      const res = await initialize(getPort(server), path);

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect((JSON.parse(res.body) as { error: string }).error).toBe(
        'Not found. The MCP endpoint is /mcp',
      );
      expect(res.headers['access-control-allow-origin']).toBeDefined();
      expect(factory).not.toHaveBeenCalled();
      expect(server.activeSessions).toBe(0);
    },
  );

  it('answers 404 on an unknown path for GET, DELETE and OPTIONS', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory);
    await server.start();
    const port = getPort(server);

    for (const method of ['GET', 'DELETE', 'OPTIONS']) {
      const res = await send(port, method, { Host: '127.0.0.1' }, undefined, '/other');
      expect(res.status).toBe(404);
    }
  });

  it('still rejects a hostile Origin with 403 on an unknown path', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory);
    await server.start();

    const res = await send(
      getPort(server),
      'POST',
      { Host: '127.0.0.1', Origin: 'http://attacker.com' },
      '{}',
      '/other',
    );

    expect(res.status).toBe(403);
  });

  it('does not count a request to an unknown path as an auth failure', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory, { authEnabled: true, accessKey: 'k' });
    const internal = server as unknown as InternalHttpMcpServer;
    const recordFailure = vi.spyOn(internal.rateLimiter, 'recordFailure');
    await server.start();

    const res = await send(getPort(server), 'POST', { Host: '127.0.0.1' }, '{}', '/other');

    expect(res.status).toBe(404);
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

describe('HttpMcpServer — session cap default', () => {
  it('defaults to 32 sessions', () => {
    expect(DEFAULT_MAX_SESSIONS).toBe(32);
  });
});

describe('HttpMcpServer — session cap', () => {
  let server: HttpMcpServer;

  afterEach(async () => {
    await server.stop();
  });

  it('closes the least recently active session when the cap is exceeded', async () => {
    let now = 0;
    const { factory, created } = trackingFactory();
    server = new HttpMcpServer(
      factory as unknown as () => McpServer,
      makeLogger(),
      {
        host: '127.0.0.1',
        port: 0,
        authEnabled: false,
        accessKey: '',
        sessionSweepIntervalMs: 0,
        originHost: LOOPBACK_ORIGIN_HOST,
        maxSessions: 2,
      },
      () => now,
    );
    await server.start();
    const port = getPort(server);

    now = 1;
    const first = sessionIdOf(await initialize(port));
    now = 2;
    const second = sessionIdOf(await initialize(port));
    // Use the first session, so the second is the least recently active.
    now = 3;
    expect((await sendInitialized(port, first)).status).toBe(202);

    now = 4;
    const third = sessionIdOf(await initialize(port));

    expect(server.activeSessions).toBe(2);
    await vi.waitFor(() => {
      expect(created[1].closed()).toBe(true);
    });
    expect(created[0].closed()).toBe(false);
    expect(created[2].closed()).toBe(false);

    // The evicted client is told its session is gone; the others still work.
    expect((await sendInitialized(port, second)).status).toBe(404);
    expect((await sendInitialized(port, first)).status).toBe(202);
    expect((await sendInitialized(port, third)).status).toBe(202);
  });

  it('never exceeds the cap under many initializations', async () => {
    const { factory, created } = trackingFactory();
    server = createServer(factory, { maxSessions: 3 });
    await server.start();
    const port = getPort(server);

    for (let i = 0; i < 8; i++) {
      await initialize(port);
      expect(server.activeSessions).toBeLessThanOrEqual(3);
    }

    expect(server.activeSessions).toBe(3);
    await vi.waitFor(() => {
      expect(created.filter((c) => c.closed())).toHaveLength(5);
    });
  });

  it('does not cap sessions when maxSessions is 0', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory, { maxSessions: 0 });
    await server.start();
    const port = getPort(server);

    for (let i = 0; i < 5; i++) {
      await initialize(port);
    }

    expect(server.activeSessions).toBe(5);
  });
});

describe('HttpMcpServer — Authorization scheme', () => {
  let server: HttpMcpServer;

  afterEach(async () => {
    await server.stop();
  });

  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])(
    'accepts the %s scheme over HTTP',
    async (scheme) => {
      const { factory } = trackingFactory();
      server = createServer(factory, { authEnabled: true, accessKey: 'secret-key' });
      await server.start();

      const res = await send(
        getPort(server),
        'POST',
        { ...MCP_POST_HEADERS, Authorization: `${scheme} secret-key` },
        INITIALIZE_BODY,
      );

      expect(res.status).toBe(200);
    },
  );

  it('still rejects a wrong token with a lowercase scheme', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory, { authEnabled: true, accessKey: 'secret-key' });
    await server.start();

    const res = await send(
      getPort(server),
      'POST',
      { ...MCP_POST_HEADERS, Authorization: 'bearer wrong-key' },
      INITIALIZE_BODY,
    );

    expect(res.status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('HttpMcpServer — CORS', () => {
  let server: HttpMcpServer;

  afterEach(async () => {
    await server.stop();
  });

  it('answers a browser preflight for a post-initialize request', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory);
    await server.start();

    const res = await send(getPort(server), 'OPTIONS', {
      Host: '127.0.0.1',
      Origin: 'http://127.0.0.1',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers':
        'authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id',
    });

    expect(res.status).toBe(204);
    const allowed = String(res.headers['access-control-allow-headers'])
      .toLowerCase()
      .split(/,\s*/);
    for (const h of [
      'authorization',
      'content-type',
      'mcp-session-id',
      'mcp-protocol-version',
      'last-event-id',
    ]) {
      expect(allowed).toContain(h);
    }
    expect(String(res.headers['access-control-allow-methods'])).toContain('DELETE');
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1');
    expect(res.headers.vary).toContain('Origin');
  });

  it('exposes Mcp-Session-Id and echoes an allowlisted Origin on initialize', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory);
    await server.start();

    const res = await send(
      getPort(server),
      'POST',
      { ...MCP_POST_HEADERS, Origin: 'https://localhost' },
      INITIALIZE_BODY,
    );

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://localhost');
    const exposed = String(res.headers['access-control-expose-headers']);
    expect(exposed).toContain('Mcp-Session-Id');
    expect(exposed).toContain('Mcp-Protocol-Version');
    expect(exposed).toContain('WWW-Authenticate');
  });

  it('does not echo a rejected Origin', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory);
    await server.start();

    const res = await send(getPort(server), 'OPTIONS', {
      Host: '127.0.0.1',
      Origin: 'http://attacker.com',
    });

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).not.toBe('http://attacker.com');
  });

  it('falls back to the configured origin when the request has none', async () => {
    const { factory } = trackingFactory();
    server = createServer(factory);
    await server.start();

    const res = await initialize(getPort(server));

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost');
  });
});

describe('HttpMcpServer — request error logging (#542)', () => {
  let server: HttpMcpServer;

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.stop();
  });

  it('passes the error as log data when an MCP request fails', async () => {
    const crash = new Error('factory exploded');
    const factory = vi.fn((): never => {
      throw crash;
    });
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    server = createServer(factory);
    await server.start();

    const res = await initialize(getPort(server));

    expect(res.status).toBe(500);
    expect(res.body).not.toContain('factory exploded');
    expect(error).toHaveBeenCalledWith('Error handling MCP request: factory exploded', crash);
  });
});
