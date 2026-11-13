import { X509Certificate, generateKeyPair, randomBytes, type KeyObject } from 'crypto';
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

/**
 * A certificate that expires within this many days counts as expiring:
 * the self-signed certificate is renewed at the next server start, your
 * own certificate gets a warning.
 */
export const CERT_RENEWAL_THRESHOLD_DAYS = 30;

type CertificateExpiryState = 'valid' | 'expiring' | 'expired' | 'unparsable';

export interface CertificateExpiry {
  state: CertificateExpiryState;
  /** The certificate's `notAfter`, or null when it does not parse. */
  notAfter: Date | null;
  /** Whole days until `notAfter` (negative once expired), or null. */
  daysLeft: number | null;
}

/**
 * Reads the expiry of a PEM certificate. A certificate that does not parse
 * is reported as `unparsable` instead of throwing, so the caller can treat
 * it like an expired one.
 */
export function checkCertificateExpiry(
  certPem: string,
  now: Date = new Date(),
  thresholdDays: number = CERT_RENEWAL_THRESHOLD_DAYS,
): CertificateExpiry {
  let notAfter: Date;
  try {
    notAfter = new Date(new X509Certificate(certPem).validTo);
  } catch {
    return { state: 'unparsable', notAfter: null, daysLeft: null };
  }
  const remainingMs = notAfter.getTime() - now.getTime();
  if (Number.isNaN(remainingMs)) {
    return { state: 'unparsable', notAfter: null, daysLeft: null };
  }
  const daysLeft = Math.floor(remainingMs / DAY_MS);
  let state: CertificateExpiryState = 'valid';
  if (remainingMs <= 0) state = 'expired';
  else if (remainingMs <= thresholdDays * DAY_MS) state = 'expiring';
  return { state, notAfter, daysLeft };
}

/** True when a certificate is expiring, expired or does not parse. */
export function needsRenewal(expiry: CertificateExpiry): boolean {
  return expiry.state !== 'valid';
}
