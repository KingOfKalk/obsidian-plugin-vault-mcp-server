/**
 * #518: after a plugin update MCP clients got ECONNREFUSED until Obsidian
 * was reloaded. Obsidian updates a plugin by unloading the old instance and
 * loading the new one; `onunload` cannot await, so the old server's stop()
 * and the new server's start() race for the same port.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import net from 'net';
import { HttpMcpServer } from '../../src/server/http-server';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { Logger } from '../../src/utils/logger';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { DEFAULT_SETTINGS } from '../../src/types';

const TEST_PORT = 38761;
const ACCESS_KEY = 'restart-test-key-12345';

function makeServer(port = TEST_PORT): HttpMcpServer {
  const logger = new Logger('test', { debugMode: false, accessKey: ACCESS_KEY });
  const registry = new ModuleRegistry(logger);
  const adapter = new MockObsidianAdapter();
  const settings = { ...DEFAULT_SETTINGS, accessKey: ACCESS_KEY };
  return new HttpMcpServer(
    () => createMcpServer(registry, adapter, settings, logger),
    logger,
    {
      host: '127.0.0.1',
      port,
      authEnabled: true,
      accessKey: ACCESS_KEY,
      bindRetryDelayMs: 20,
      bindRetryTimeoutMs: 2000,
    },
  );
}

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  method: string,
  headers: Record<string, string>,
  body?: string,
  port = TEST_PORT,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method,
        agent: false,
        headers: {
          Authorization: `Bearer ${ACCESS_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'restart-test', version: '1.0.0' },
  },
});

async function initializeSession(port = TEST_PORT): Promise<string> {
  const res = await request('POST', {}, INITIALIZE, port);
  const id = res.headers['mcp-session-id'];
  if (typeof id !== 'string') throw new Error(`no session id (status ${String(res.status)})`);
  return id;
}

/** Open the session's standalone SSE stream and keep it open. */
function openSseStream(sessionId: string): Promise<http.ClientRequest> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/mcp',
      method: 'GET',
      agent: false,
      headers: {
        Authorization: `Bearer ${ACCESS_KEY}`,
        Accept: 'text/event-stream',
        'mcp-session-id': sessionId,
      },
    });
    req.on('response', (res) => {
      res.on('data', () => undefined);
      res.on('error', () => undefined);
      resolve(req);
    });
    req.on('error', reject);
    req.end();
  });
}

/** A client that sent half a request and went quiet: an in-flight request. */
function openStalledRequest(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(TEST_PORT, '127.0.0.1', () => {
      socket.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${String(TEST_PORT)}\r\n`);
      resolve(socket);
    });
    socket.on('error', () => undefined);
    socket.once('error', reject);
  });
}

/** What the new plugin instance's onload does before it binds: a few awaits. */
async function someTicks(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

describe('Server restart after a plugin update (#518)', () => {
  const servers: HttpMcpServer[] = [];
  const sockets: net.Socket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    for (const server of servers.splice(0)) await server.stop();
  });

  it('stop() finishes and frees the port while an SSE stream and a stalled request are open', async () => {
    const oldServer = makeServer();
    servers.push(oldServer);
    await oldServer.start();
    const sessionId = await initializeSession();
    const stream = await openSseStream(sessionId);
    stream.on('error', () => undefined);
    sockets.push(await openStalledRequest());

    await oldServer.stop();
    expect(oldServer.isRunning).toBe(false);

    const newServer = makeServer();
    servers.push(newServer);
    await newServer.start();
    expect(newServer.isRunning).toBe(true);
  });

  it('a new instance binds when the old stop() is not awaited (Obsidian onunload)', async () => {
    const oldServer = makeServer();
    servers.push(oldServer);
    await oldServer.start();
    const sessionId = await initializeSession();
    const stream = await openSseStream(sessionId);
    stream.on('error', () => undefined);
    sockets.push(await openStalledRequest());

    // onunload: fire and forget.
    const stopping = oldServer.stop();
    await someTicks();

    const newServer = makeServer();
    servers.push(newServer);
    await newServer.start();
    expect(newServer.isRunning).toBe(true);

    // The new server answers MCP.
    const id = await initializeSession();
    expect(id.length).toBeGreaterThan(0);
    await stopping;
  });

  it('a new instance started in the same tick as the old stop() still binds', async () => {
    const oldServer = makeServer();
    servers.push(oldServer);
    await oldServer.start();
    sockets.push(await openStalledRequest());

    const stopping = oldServer.stop();
    const newServer = makeServer();
    servers.push(newServer);
    await newServer.start();
    expect(newServer.isRunning).toBe(true);
    await stopping;
  });

  it('retries the bind while the port is held, then succeeds once it frees', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(TEST_PORT, '127.0.0.1', r));
    setTimeout(() => {
      blocker.close();
    }, 100);

    const server = makeServer();
    servers.push(server);
    await server.start();
    expect(server.isRunning).toBe(true);
  });

  it('gives up with the port-in-use error when the port stays held', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(TEST_PORT, '127.0.0.1', r));
    try {
      const logger = new Logger('test', { debugMode: false, accessKey: '' });
      const server = new HttpMcpServer(() => ({}) as never, logger, {
        host: '127.0.0.1',
        port: TEST_PORT,
        authEnabled: false,
        accessKey: '',
        bindRetryDelayMs: 20,
        bindRetryTimeoutMs: 100,
      });
      await expect(server.start()).rejects.toThrow(/already in use/);
      expect(server.isRunning).toBe(false);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

describe('HttpMcpServer stop/start edge cases (#518)', () => {
  it('concurrent stop() calls share one stop', async () => {
    const server = makeServer(TEST_PORT + 1);
    await server.start();
    const a = server.stop();
    const b = server.stop();
    expect(a).toBe(b);
    await a;
    expect(server.isRunning).toBe(false);
    await server.stop();
  });

  it('fails on the first EADDRINUSE when the retry is off', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(TEST_PORT + 2, '127.0.0.1', r));
    try {
      const logger = new Logger('test', { debugMode: false, accessKey: '' });
      const server = new HttpMcpServer(() => ({}) as never, logger, {
        host: '127.0.0.1',
        port: TEST_PORT + 2,
        authEnabled: false,
        accessKey: '',
        bindRetryTimeoutMs: 0,
      });
      await expect(server.start()).rejects.toThrow(/already in use/);
      // A failed start leaves nothing to stop.
      await server.stop();
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it('does not retry other bind errors', async () => {
    const logger = new Logger('test', { debugMode: false, accessKey: '' });
    const server = new HttpMcpServer(() => ({}) as never, logger, {
      host: '203.0.113.1',
      port: TEST_PORT + 3,
      authEnabled: false,
      accessKey: '',
      bindRetryDelayMs: 1000,
      bindRetryTimeoutMs: 60_000,
    });
    await expect(server.start()).rejects.toThrow(/EADDRNOTAVAIL/);
    expect(server.isRunning).toBe(false);
  });
});
