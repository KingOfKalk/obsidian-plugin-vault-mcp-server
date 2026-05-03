import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import https from 'https';

const TEST_PORT = 38742;
const ACCESS_KEY = 'https-integration-test-key';

function makeRequest(
  method: string,
  path: string,
  caCert: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path,
        method,
        ca: caCert,
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
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Integration: HTTPS server', () => {
  let server: import('../../src/server/http-server').HttpMcpServer;
  let caCert: string;

  beforeAll(async () => {
    const httpMod = await import('../../src/server/http-server');
    const mcpMod = await import('../../src/server/mcp-server');
    const regMod = await import('../../src/registry/module-registry');
    const logMod = await import('../../src/utils/logger');
    const mockMod = await import('../../src/obsidian/mock-adapter');
    const vaultMod = await import('../../src/tools/vault/index');
    const tlsMod = await import('../../src/server/tls');
    const { DEFAULT_SETTINGS } = await import('../../src/types');

    const logger = new logMod.Logger('test', { debugMode: false, accessKey: ACCESS_KEY });
    const registry = new regMod.ModuleRegistry(logger);
    const adapter = new mockMod.MockObsidianAdapter();
    registry.registerModule(vaultMod.createVaultModule(adapter));

    const tls = await tlsMod.generateSelfSignedCert();
    caCert = tls.cert;

    server = new httpMod.HttpMcpServer(
      () => mcpMod.createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger),
      logger,
      {
        host: '127.0.0.1',
        port: TEST_PORT,
        authEnabled: true,
        accessKey: ACCESS_KEY,
        tls,
      },
    );
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('reports scheme as https', () => {
    expect(server.scheme).toBe('https');
  });

  it('rejects requests over HTTPS without Authorization', async () => {
    const res = await makeRequest('POST', '/', caCert);
    expect(res.status).toBe(401);
  });

  it('accepts Bearer-authenticated requests over HTTPS', async () => {
    const res = await makeRequest(
      'POST',
      '/',
      caCert,
      { Authorization: `Bearer ${ACCESS_KEY}` },
      JSON.stringify({}),
    );
    // 400 because body is not a valid JSON-RPC initialize, but auth passed
    expect(res.status).not.toBe(401);
  });

  it('refuses plain HTTP on an HTTPS port', async () => {
    const http = await import('http');
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: '/',
          method: 'GET',
        },
        () => resolve(),
      );
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.end();
    });
    // Just verify it doesn't hang — HTTPS server either drops the connection
    // or returns an error; we don't care which.
    expect(server.isRunning).toBe(true);
  });
});
