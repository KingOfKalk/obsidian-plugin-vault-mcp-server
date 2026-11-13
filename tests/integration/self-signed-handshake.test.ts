import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import https from 'https';
import type { AddressInfo } from 'net';
import { generateSelfSignedCert, type TlsCertificate } from '../../src/server/tls';

/**
 * A real TLS handshake against the generated certificate (#561): Node's TLS
 * stack must accept it as a trust anchor (`ca`) with full verification and
 * match the loopback names in its subjectAltName.
 */

interface Outcome {
  status: number;
  body: string;
}

function get(port: number, ca: string, servername: string | undefined): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        ca,
        rejectUnauthorized: true,
        // Node checks the certificate against `servername` when set, else
        // against `host`. An IP address must not be sent as SNI.
        servername,
        agent: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Integration: TLS handshake with the generated self-signed certificate', () => {
  let pair: TlsCertificate;
  let server: https.Server;
  let port: number;

  beforeAll(async () => {
    pair = await generateSelfSignedCert();
    server = https.createServer({ cert: pair.cert, key: pair.key }, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('verifies for localhost (DNS name)', async () => {
    const res = await get(port, pair.cert, 'localhost');
    expect(res).toEqual({ status: 200, body: 'ok' });
  });

  it('verifies for 127.0.0.1 (IP address)', async () => {
    const res = await get(port, pair.cert, undefined);
    expect(res).toEqual({ status: 200, body: 'ok' });
  });

  it('rejects a host name the certificate does not list', async () => {
    await expect(get(port, pair.cert, 'example.com')).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });

  it('rejects the certificate when another one is trusted', async () => {
    const other = await generateSelfSignedCert();
    await expect(get(port, other.cert, 'localhost')).rejects.toMatchObject({
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  });
});
