import { readFile } from 'node:fs/promises';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';

export type CustomTlsErrorCode =
  | 'cert_not_readable'
  | 'key_not_readable'
  | 'invalid_cert'
  | 'invalid_key'
  | 'key_cert_mismatch'
  | 'cert_expired';

export class CustomTlsError extends Error {
  readonly code: CustomTlsErrorCode;
  readonly path?: string;

  constructor(code: CustomTlsErrorCode, path?: string) {
    super(path ? `${code}: ${path}` : code);
    this.name = 'CustomTlsError';
    this.code = code;
    this.path = path;
  }
}

export interface LoadedCustomTls {
  cert: string;
  key: string;
}

export async function loadAndValidateCustomTls(
  certPath: string,
  keyPath: string,
): Promise<LoadedCustomTls> {
  const certPem = await readPem(certPath, 'cert_not_readable');
  const keyPem = await readPem(keyPath, 'key_not_readable');

  let keyObj: ReturnType<typeof createPrivateKey>;
  try {
    keyObj = createPrivateKey(keyPem);
  } catch {
    throw new CustomTlsError('invalid_key', keyPath);
  }

  let certObj: X509Certificate;
  try {
    certObj = new X509Certificate(certPem);
  } catch {
    throw new CustomTlsError('invalid_cert', certPath);
  }

  const keySpki = createPublicKey(keyObj)
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const certSpki = certObj.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  if (keySpki !== certSpki) {
    throw new CustomTlsError('key_cert_mismatch');
  }

  if (new Date(certObj.validTo).getTime() <= Date.now()) {
    throw new CustomTlsError('cert_expired', certPath);
  }

  return { cert: certPem, key: keyPem };
}

async function readPem(
  path: string,
  notReadableCode: Extract<
    CustomTlsErrorCode,
    'cert_not_readable' | 'key_not_readable'
  >,
): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new CustomTlsError(notReadableCode, path);
  }
}
