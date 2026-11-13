import { describe, it, expect, beforeAll } from 'vitest';
import { X509Certificate } from 'crypto';
import {
  CERT_RENEWAL_THRESHOLD_DAYS,
  checkCertificateExpiry,
  generateSelfSignedCert,
  needsRenewal,
} from '../../src/server/tls';

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
    expect(x509.subject).toContain('Vault MCP Server');
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

describe('checkCertificateExpiry', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let cert: string;
  let notAfter: number;

  beforeAll(async () => {
    ({ cert } = await generateSelfSignedCert({ validityDays: 365 }));
    notAfter = new Date(new X509Certificate(cert).validTo).getTime();
  });

  it('uses a 30-day renewal threshold', () => {
    expect(CERT_RENEWAL_THRESHOLD_DAYS).toBe(30);
  });

  it('reports a fresh certificate as valid', () => {
    const result = checkCertificateExpiry(cert);
    expect(result.state).toBe('valid');
    expect(result.notAfter?.getTime()).toBe(notAfter);
    expect(result.daysLeft).toBeGreaterThanOrEqual(364);
  });

  it('reports a certificate that expires within the threshold as expiring', () => {
    const now = new Date(notAfter - 10 * DAY_MS);
    const result = checkCertificateExpiry(cert, now);
    expect(result.state).toBe('expiring');
    expect(result.daysLeft).toBe(10);
  });

  it('counts exactly the threshold as expiring and one day more as valid', () => {
    expect(
      checkCertificateExpiry(cert, new Date(notAfter - CERT_RENEWAL_THRESHOLD_DAYS * DAY_MS))
        .state,
    ).toBe('expiring');
    expect(
      checkCertificateExpiry(
        cert,
        new Date(notAfter - (CERT_RENEWAL_THRESHOLD_DAYS + 1) * DAY_MS),
      ).state,
    ).toBe('valid');
  });

  it('reports a certificate past its expiry as expired', () => {
    expect(checkCertificateExpiry(cert, new Date(notAfter)).state).toBe('expired');
    const result = checkCertificateExpiry(cert, new Date(notAfter + 5 * DAY_MS));
    expect(result.state).toBe('expired');
    expect(result.daysLeft).toBeLessThan(0);
  });

  it('reports a certificate that does not parse as unparsable', () => {
    expect(checkCertificateExpiry('NOT A PEM').state).toBe('unparsable');
    expect(checkCertificateExpiry('').state).toBe('unparsable');
  });

  it('flags every state except valid for renewal', () => {
    expect(needsRenewal(checkCertificateExpiry(cert))).toBe(false);
    expect(needsRenewal(checkCertificateExpiry(cert, new Date(notAfter - DAY_MS)))).toBe(true);
    expect(needsRenewal(checkCertificateExpiry(cert, new Date(notAfter + DAY_MS)))).toBe(true);
    expect(needsRenewal(checkCertificateExpiry('NOT A PEM'))).toBe(true);
  });
});
