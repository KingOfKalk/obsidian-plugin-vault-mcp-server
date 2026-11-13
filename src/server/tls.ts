import { X509Certificate } from 'node:crypto';
import { generate } from 'selfsigned';

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

export async function generateSelfSignedCert(
  options: GenerateOptions = {},
): Promise<TlsCertificate> {
  const hosts = Array.from(new Set([...DEFAULT_HOSTS, ...(options.hosts ?? [])]));
  const validityDays = options.validityDays ?? 365;

  const now = new Date();
  const notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const pems = await generate(
    [{ name: 'commonName', value: 'Vault MCP Server (localhost)' }],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: now,
      notAfterDate: notAfter,
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true,
          critical: true,
        },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: hosts.map((host) =>
            isIpAddress(host)
              ? { type: 7, ip: host }
              : { type: 2, value: host },
          ),
        },
      ],
    },
  );

  return { cert: pems.cert, key: pems.private };
}

function isIpAddress(value: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return true;
  if (value.includes(':')) return true;
  return false;
}

/**
 * A certificate that expires within this many days counts as expiring:
 * the self-signed certificate is renewed at the next server start, your
 * own certificate gets a warning.
 */
export const CERT_RENEWAL_THRESHOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

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
