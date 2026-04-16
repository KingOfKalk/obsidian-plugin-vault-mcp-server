import { describe, it, expect } from 'vitest';
import { generateSelfSignedCert } from '../../src/server/tls';

describe('TLS certificate generation', () => {
  it('should generate a cert and key pair', () => {
    const result = generateSelfSignedCert();
    expect(result.cert).toBeDefined();
    expect(result.key).toBeDefined();
  });

  it('should generate PEM-formatted key', () => {
    const result = generateSelfSignedCert();
    expect(result.key).toContain('-----BEGIN PRIVATE KEY-----');
    expect(result.key).toContain('-----END PRIVATE KEY-----');
  });

  it('should generate PEM-formatted cert', () => {
    const result = generateSelfSignedCert();
    expect(result.cert).toContain('-----BEGIN PUBLIC KEY-----');
    expect(result.cert).toContain('-----END PUBLIC KEY-----');
  });

  it('should generate unique certs each time', () => {
    const cert1 = generateSelfSignedCert();
    const cert2 = generateSelfSignedCert();
    expect(cert1.key).not.toBe(cert2.key);
  });
});
