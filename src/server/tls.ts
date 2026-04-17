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
    [{ name: 'commonName', value: 'Obsidian MCP Plugin (localhost)' }],
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
