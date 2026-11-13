import { browser, expect } from '@wdio/globals';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { ACCESS_KEY, MCP_PORT, PLUGIN_ID, startMcpServer } from '../helpers';

/**
 * #561: the self-signed certificate is built with `node:crypto` only. Obsidian
 * runs it in Electron (BoringSSL, not Node's OpenSSL), so generate it there
 * through the plugin's own start path and complete a verified TLS handshake
 * against it from Node.
 */

interface HttpsPluginHandle {
  settings: {
    httpsEnabled: boolean;
    useCustomTls: boolean;
    tlsCertificate: { cert: string; key: string } | null;
  };
  saveSettings(): Promise<void>;
  restartServer(): Promise<void>;
  lastStartError: { message: string } | null;
}

function postInitialize(ca: string, servername: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vault-mcp-e2e-https', version: '1.0.0' },
      },
    });
    const req = https.request(
      {
        host: '127.0.0.1',
        port: MCP_PORT,
        path: '/mcp',
        method: 'POST',
        ca,
        rejectUnauthorized: true,
        servername,
        agent: false,
        headers: {
          Authorization: `Bearer ${ACCESS_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('HTTPS with the generated certificate (#561)', function () {
  let cert = '';

  before(async function () {
    // Plain HTTP setup first (address, port, key), then switch to HTTPS with
    // no cached certificate, so the plugin generates one on start.
    await startMcpServer();
    const result = await browser.executeObsidian(async ({ app }, pluginId) => {
      const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins[pluginId] as HttpsPluginHandle;
      Object.assign(plugin.settings, {
        httpsEnabled: true,
        useCustomTls: false,
        tlsCertificate: null,
      });
      await plugin.saveSettings();
      await plugin.restartServer();
      return {
        error: plugin.lastStartError?.message ?? null,
        cert: plugin.settings.tlsCertificate?.cert ?? null,
      };
    }, PLUGIN_ID);
    if (result.error !== null) throw new Error(`HTTPS server did not start: ${result.error}`);
    if (result.cert === null) throw new Error('no certificate was generated');
    cert = result.cert;
  });

  after(async function () {
    await browser.executeObsidian(async ({ app }, pluginId) => {
      const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
        .plugins[pluginId] as HttpsPluginHandle;
      plugin.settings.httpsEnabled = false;
      await plugin.saveSettings();
      await plugin.restartServer();
    }, PLUGIN_ID);
  });

  it('generates a parseable self-signed certificate for the loopback names', function () {
    const x509 = new X509Certificate(cert);
    expect(x509.subject).toBe('CN=Vault MCP Server (localhost)');
    expect(x509.issuer).toBe(x509.subject);
    expect(x509.verify(x509.publicKey)).toBe(true);
    expect(x509.subjectAltName).toBe(
      'DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1',
    );
  });

  it('completes a verified handshake for 127.0.0.1', async function () {
    expect(await postInitialize(cert, undefined)).toBe(200);
  });

  it('completes a verified handshake for localhost', async function () {
    expect(await postInitialize(cert, 'localhost')).toBe(200);
  });
});
