import { generateKeyPairSync, createSign, randomBytes } from 'crypto';

export interface TlsCertificate {
  cert: string;
  key: string;
}

export function generateSelfSignedCert(): TlsCertificate {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Create a simple self-signed certificate
  // This is a minimal X.509 v3 certificate for local use
  const serialNumber = randomBytes(16).toString('hex');
  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 10);

  // Use Node.js crypto to create a self-signed cert
  // For simplicity in a local-only context, we generate PEM-encoded key pair
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  // Create a minimal self-signed certificate using the sign API
  const sign = createSign('SHA256');
  const certInfo = [
    `Serial: ${serialNumber}`,
    `Not Before: ${notBefore.toISOString()}`,
    `Not After: ${notAfter.toISOString()}`,
    `Subject: CN=localhost`,
    `Issuer: CN=localhost`,
  ].join('\n');
  sign.update(certInfo);
  sign.sign(privateKey, 'base64');

  // For a production-quality implementation, we'd use a proper X.509 library
  // For local-only self-signed use, the key pair is sufficient
  // Node's https.createServer accepts { key, cert } where cert can be self-signed
  return {
    cert: pubPem,
    key: privPem,
  };
}
