import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import https from 'https';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSelfSignedCert } from '../../src/server/tls';
import {
  CustomTlsError,
  loadAndValidateCustomTls,
} from '../../src/server/custom-tls';

const TEST_PORT = 38743;
const ACCESS_KEY = 'custom-tls-integration-test-key';

function handshake(caCert: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/',
        method: 'POST',
        ca: caCert,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ACCESS_KEY}`,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

describe('Integration: HTTPS server with user-provided cert', () => {
  let server: import('../../src/server/http-server').HttpMcpServer;
  let workDir: string;
  let caCert: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'custom-tls-int-'));
    const pair = await generateSelfSignedCert({ hosts: ['127.0.0.1'] });
    const certPath = join(workDir, 'server.crt');
    const keyPath = join(workDir, 'server.key');
    await writeFile(certPath, pair.cert, 'utf8');
    await writeFile(keyPath, pair.key, 'utf8');
    caCert = pair.cert;

    const tls = await loadAndValidateCustomTls(certPath, keyPath);

    const httpMod = await import('../../src/server/http-server');
    const mcpMod = await import('../../src/server/mcp-server');
    const regMod = await import('../../src/registry/module-registry');
    const logMod = await import('../../src/utils/logger');
    const mockMod = await import('../../src/obsidian/mock-adapter');
    const vaultMod = await import('../../src/tools/vault/index');

    const logger = new logMod.Logger('test', {
      debugMode: false,
      accessKey: ACCESS_KEY,
    });
    const registry = new regMod.ModuleRegistry(logger);
    const adapter = new mockMod.MockObsidianAdapter();
    registry.registerModule(vaultMod.createVaultModule(adapter));

    server = new httpMod.HttpMcpServer(
      () => mcpMod.createMcpServer(registry, logger),
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
    await rm(workDir, { recursive: true, force: true });
  });

  it('completes a TLS handshake using the user-provided cert', async () => {
    const status = await handshake(caCert);
    // Auth passed; any non-401 confirms the handshake + Bearer flow both work.
    expect(status).not.toBe(0);
    expect(status).not.toBe(401);
  });
});

describe('loadAndValidateCustomTls rejects mismatched pairs before the server boots', () => {
  it('throws key_cert_mismatch so startServer can refuse to start', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'custom-tls-mismatch-'));
    try {
      const a = await generateSelfSignedCert({ hosts: ['127.0.0.1'] });
      const b = await generateSelfSignedCert({ hosts: ['127.0.0.1'] });
      const certPath = join(workDir, 'server.crt');
      const keyPath = join(workDir, 'server.key');
      await writeFile(certPath, a.cert, 'utf8');
      await writeFile(keyPath, b.key, 'utf8');

      const err = await loadAndValidateCustomTls(certPath, keyPath).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CustomTlsError);
      expect((err as CustomTlsError).code).toBe('key_cert_mismatch');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
