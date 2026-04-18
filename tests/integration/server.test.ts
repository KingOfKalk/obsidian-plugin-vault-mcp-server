import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';

const TEST_PORT = 38741;
const ACCESS_KEY = 'integration-test-key-12345';

function makeRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              responseHeaders[key] = value;
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: responseHeaders,
            body: data,
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Import after checking availability
let HttpMcpServer: typeof import('../../src/server/http-server').HttpMcpServer;
let createMcpServer: typeof import('../../src/server/mcp-server').createMcpServer;
let ModuleRegistry: typeof import('../../src/registry/module-registry').ModuleRegistry;
let Logger: typeof import('../../src/utils/logger').Logger;
let MockObsidianAdapter: typeof import('../../src/obsidian/mock-adapter').MockObsidianAdapter;
let createVaultModule: typeof import('../../src/tools/vault/index').createVaultModule;

beforeAll(async () => {
  const httpMod = await import('../../src/server/http-server');
  const mcpMod = await import('../../src/server/mcp-server');
  const regMod = await import('../../src/registry/module-registry');
  const logMod = await import('../../src/utils/logger');
  const mockMod = await import('../../src/obsidian/mock-adapter');
  const vaultMod = await import('../../src/tools/vault/index');

  HttpMcpServer = httpMod.HttpMcpServer;
  createMcpServer = mcpMod.createMcpServer;
  ModuleRegistry = regMod.ModuleRegistry;
  Logger = logMod.Logger;
  MockObsidianAdapter = mockMod.MockObsidianAdapter;
  createVaultModule = vaultMod.createVaultModule;
});

describe('Integration: HTTP Server Authentication', () => {
  let server: InstanceType<typeof HttpMcpServer>;

  beforeAll(async () => {
    const logger = new Logger('test', { debugMode: false, accessKey: ACCESS_KEY });
    const registry = new ModuleRegistry(logger);
    const adapter = new MockObsidianAdapter();
    const vaultModule = createVaultModule(adapter);
    registry.registerModule(vaultModule);
    server = new HttpMcpServer(
      () => createMcpServer(registry, logger),
      logger,
      {
        host: '127.0.0.1',
        port: TEST_PORT,
        authEnabled: true,
        accessKey: ACCESS_KEY,
      },
    );
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should reject requests without Authorization header', async () => {
    const res = await makeRequest('POST', '/');
    expect(res.status).toBe(401);
  });

  it('should reject requests with invalid token', async () => {
    const res = await makeRequest('POST', '/', {
      Authorization: 'Bearer wrong-key',
    });
    expect(res.status).toBe(401);
  });

  it('should reject requests with malformed auth header', async () => {
    const res = await makeRequest('POST', '/', {
      Authorization: 'Basic abc123',
    });
    expect(res.status).toBe(401);
  });

  it('should handle CORS preflight', async () => {
    const res = await makeRequest('OPTIONS', '/');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
    expect(res.headers['access-control-allow-methods']).toBeDefined();
  });

  it('should include CORS headers in authenticated responses', async () => {
    const res = await makeRequest('POST', '/', {
      Authorization: `Bearer ${ACCESS_KEY}`,
    });
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('should accept valid auth and forward to MCP transport', async () => {
    // Send an MCP initialize request
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });
    const res = await makeRequest('POST', '/', {
      Authorization: `Bearer ${ACCESS_KEY}`,
      Accept: 'application/json, text/event-stream',
    }, body);
    // Should get a valid response (200) from the MCP transport
    expect(res.status).toBe(200);
    // Response may be SSE format — extract the JSON data
    const jsonLine = res.body.split('\n').find((l) => l.startsWith('data: '));
    expect(jsonLine).toBeDefined();
    const data = JSON.parse(jsonLine!.slice(6)) as { jsonrpc: string; id: number; result?: unknown };
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(1);
    expect(data.result).toBeDefined();
    expect(res.headers['mcp-session-id']).toBeDefined();
  });

  it('should allow multiple independent clients to initialize', async () => {
    // Regression for LM Studio "Server already initialized" error (#74).
    // Each new client without a session ID must be able to initialize.
    const makeInitRequest = async (
      clientName: string,
    ): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: clientName, version: '1.0.0' },
        },
      });
      return makeRequest('POST', '/', {
        Authorization: `Bearer ${ACCESS_KEY}`,
        Accept: 'application/json, text/event-stream',
      }, body);
    };

    const first = await makeInitRequest('client-a');
    const second = await makeInitRequest('client-b');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['mcp-session-id']).toBeDefined();
    expect(second.headers['mcp-session-id']).toBeDefined();
    expect(first.headers['mcp-session-id']).not.toBe(second.headers['mcp-session-id']);
  });

  it('should reject non-initialize POST without session ID', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/list',
      params: {},
    });
    const res = await makeRequest('POST', '/', {
      Authorization: `Bearer ${ACCESS_KEY}`,
      Accept: 'application/json, text/event-stream',
    }, body);
    expect(res.status).toBe(400);
    const data = JSON.parse(res.body) as { error?: { message?: string } };
    expect(data.error?.message).toContain('session ID');
  });

  it('should return 404 for requests with unknown session ID', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const res = await makeRequest('POST', '/', {
      Authorization: `Bearer ${ACCESS_KEY}`,
      Accept: 'application/json, text/event-stream',
      'Mcp-Session-Id': 'nonexistent-session-id',
    }, body);
    expect(res.status).toBe(404);
  });

  it('should report server as running', () => {
    expect(server.isRunning).toBe(true);
    expect(server.port).toBe(TEST_PORT);
  });
});
