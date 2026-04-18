import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSelfSignedCert } from '../../src/server/tls';
import {
  CustomTlsError,
  loadAndValidateCustomTls,
} from '../../src/server/custom-tls';

describe('loadAndValidateCustomTls', () => {
  let workDir: string;
  let pairA: { cert: string; key: string };
  let pairB: { cert: string; key: string };

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'custom-tls-'));
    pairA = await generateSelfSignedCert({ hosts: ['localhost'] });
    pairB = await generateSelfSignedCert({ hosts: ['localhost'] });
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function writePair(
    prefix: string,
    cert: string,
    key: string,
  ): Promise<{ certPath: string; keyPath: string }> {
    const certPath = join(workDir, `${prefix}.crt`);
    const keyPath = join(workDir, `${prefix}.key`);
    await writeFile(certPath, cert, 'utf8');
    await writeFile(keyPath, key, 'utf8');
    return { certPath, keyPath };
  }

  it('returns the PEM contents when cert and key match', async () => {
    const paths = await writePair('happy', pairA.cert, pairA.key);
    const loaded = await loadAndValidateCustomTls(paths.certPath, paths.keyPath);
    expect(loaded.cert).toBe(pairA.cert);
    expect(loaded.key).toBe(pairA.key);
  });

  it('throws cert_not_readable when the cert file is missing', async () => {
    const paths = await writePair('missing-cert', pairA.cert, pairA.key);
    const err = await loadAndValidateCustomTls(
      join(workDir, 'does-not-exist.crt'),
      paths.keyPath,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CustomTlsError);
    expect((err as CustomTlsError).code).toBe('cert_not_readable');
  });

  it('throws key_not_readable when the key file is missing', async () => {
    const paths = await writePair('missing-key', pairA.cert, pairA.key);
    const err = await loadAndValidateCustomTls(
      paths.certPath,
      join(workDir, 'does-not-exist.key'),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CustomTlsError);
    expect((err as CustomTlsError).code).toBe('key_not_readable');
  });

  it('throws invalid_cert when the cert PEM is garbage', async () => {
    const paths = await writePair('bad-cert', 'NOT A PEM', pairA.key);
    const err = await loadAndValidateCustomTls(paths.certPath, paths.keyPath).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CustomTlsError);
    expect((err as CustomTlsError).code).toBe('invalid_cert');
  });

  it('throws invalid_key when the key PEM is garbage', async () => {
    const paths = await writePair('bad-key', pairA.cert, 'NOT A PEM');
    const err = await loadAndValidateCustomTls(paths.certPath, paths.keyPath).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CustomTlsError);
    expect((err as CustomTlsError).code).toBe('invalid_key');
  });

  it('throws key_cert_mismatch when key belongs to a different cert', async () => {
    const paths = await writePair('mismatch', pairA.cert, pairB.key);
    const err = await loadAndValidateCustomTls(paths.certPath, paths.keyPath).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CustomTlsError);
    expect((err as CustomTlsError).code).toBe('key_cert_mismatch');
  });

  it('throws cert_expired when the certificate is past its validTo', async () => {
    const expiredPair = await generateSelfSignedCert({
      hosts: ['localhost'],
      // Passing 0 days produces a cert whose notAfter is now or in the past.
      validityDays: 0,
    });
    const paths = await writePair('expired', expiredPair.cert, expiredPair.key);
    // Wait a tick to make sure "now" is strictly past notAfter.
    await new Promise((r) => setTimeout(r, 20));
    const err = await loadAndValidateCustomTls(paths.certPath, paths.keyPath).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CustomTlsError);
    expect((err as CustomTlsError).code).toBe('cert_expired');
  });
});
