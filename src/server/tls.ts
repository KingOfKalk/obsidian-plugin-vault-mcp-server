import { generateKeyPair, randomBytes, type KeyObject } from 'crypto';
import { buildSelfSignedCertificate, toPem } from './x509';

export interface TlsCertificate {
  cert: string;
  key: string;
}

export interface GenerateOptions {
  /** Hostnames/IPs to include in subjectAltName. Defaults cover loopback. */
  hosts?: string[];
  /** Validity in days. Defaults to 365. */
  validityDays?: number;
}

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '::1'];
const COMMON_NAME = 'Vault MCP Server (localhost)';
const DAY_MS = 24 * 60 * 60 * 1000;

function generateRsaKeyPair(): Promise<{ publicKey: KeyObject; privateKey: KeyObject }> {
  return new Promise((resolve, reject) => {
    generateKeyPair('rsa', { modulusLength: 2048 }, (err, publicKey, privateKey) => {
      if (err) reject(err);
      else resolve({ publicKey, privateKey });
    });
  });
}

/**
 * A new RSA-2048 key and a self-signed X.509 v3 server certificate for it,
 * both PEM (key as PKCS#8). Built with `node:crypto` and `./x509` only
 * (#561). The certificate is valid from now (to the second) for
 * `validityDays` and lists the loopback names plus `hosts`.
 */
export async function generateSelfSignedCert(
  options: GenerateOptions = {},
): Promise<TlsCertificate> {
  const hosts = Array.from(new Set([...DEFAULT_HOSTS, ...(options.hosts ?? [])]));
  const validityDays = options.validityDays ?? 365;

  const notBefore = new Date(Math.floor(Date.now() / 1000) * 1000);
  const notAfter = new Date(notBefore.getTime() + validityDays * DAY_MS);

  // 16 random bytes; the top bit cleared keeps the serial positive, the next
  // one set keeps it at exactly 16 bytes (RFC 5280: positive, at most 20).
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x40;

  const { publicKey, privateKey } = await generateRsaKeyPair();
  const der = buildSelfSignedCertificate({
    serial,
    commonName: COMMON_NAME,
    notBefore,
    notAfter,
    hosts,
    publicKey,
    privateKey,
  });

  return {
    cert: toPem('CERTIFICATE', der),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
