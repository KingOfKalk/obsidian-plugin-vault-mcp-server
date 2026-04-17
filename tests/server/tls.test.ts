import { describe, it, expect } from 'vitest';
import { X509Certificate } from 'crypto';
import { generateSelfSignedCert } from '../../src/server/tls';

describe('TLS certificate generation', () => {
  it('returns PEM-encoded cert and private key', async () => {
    const result = await generateSelfSignedCert();
    expect(result.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(result.cert).toContain('-----END CERTIFICATE-----');
    expect(result.key).toContain('-----BEGIN PRIVATE KEY-----');
    expect(result.key).toContain('-----END PRIVATE KEY-----');
  });

  it('produces a parseable X.509 certificate', async () => {
    const { cert } = await generateSelfSignedCert();
    const x509 = new X509Certificate(cert);
    expect(x509.subject).toContain('Obsidian MCP Plugin');
    // self-signed: issuer equals subject
    expect(x509.issuer).toBe(x509.subject);
  });

  it('includes loopback hosts in subjectAltName by default', async () => {
    const { cert } = await generateSelfSignedCert();
    const x509 = new X509Certificate(cert);
    const san = x509.subjectAltName ?? '';
    expect(san).toContain('localhost');
    expect(san).toContain('127.0.0.1');
  });

  it('adds custom hosts to subjectAltName', async () => {
    const { cert } = await generateSelfSignedCert({ hosts: ['192.168.1.42'] });
    const x509 = new X509Certificate(cert);
    const san = x509.subjectAltName ?? '';
    expect(san).toContain('192.168.1.42');
    expect(san).toContain('localhost');
  });

  it('generates unique certs each call', async () => {
    const a = await generateSelfSignedCert();
    const b = await generateSelfSignedCert();
    expect(a.key).not.toBe(b.key);
    expect(a.cert).not.toBe(b.cert);
  });

  it('honors the validity window', async () => {
    const { cert } = await generateSelfSignedCert({ validityDays: 30 });
    const x509 = new X509Certificate(cert);
    const notBefore = new Date(x509.validFrom).getTime();
    const notAfter = new Date(x509.validTo).getTime();
    const span = (notAfter - notBefore) / (1000 * 60 * 60 * 24);
    expect(span).toBeGreaterThan(29);
    expect(span).toBeLessThan(31);
  });
});
