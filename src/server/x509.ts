import { sign, type KeyObject } from 'crypto';
import { isIPv4, isIPv6 } from 'net';

/**
 * Minimal DER encoder and X.509 v3 builder for the plugin's self-signed
 * server certificate (#561). It writes exactly the structures that
 * certificate needs (RFC 5280, X.690 DER) and nothing else; key generation
 * and signing come from `node:crypto`.
 */

const TAG_BOOLEAN = 0x01;
const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OCTET_STRING = 0x04;
const TAG_NULL = 0x05;
const TAG_OID = 0x06;
const TAG_UTF8_STRING = 0x0c;
const TAG_PRINTABLE_STRING = 0x13;
const TAG_UTC_TIME = 0x17;
const TAG_GENERALIZED_TIME = 0x18;
const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;

const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const OID_COMMON_NAME = '2.5.4.3';
const OID_KEY_USAGE = '2.5.29.15';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

/** Length octets: short form below 128, long form otherwise. */
export function derLength(length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Invalid DER length: ${String(length)}`);
  }
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** A tag-length-value element with the given tag byte. */
export function derTlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

export function derSequence(...items: Buffer[]): Buffer {
  return derTlv(TAG_SEQUENCE, ...items);
}

export function derSet(...items: Buffer[]): Buffer {
  return derTlv(TAG_SET, ...items);
}

/**
 * INTEGER from a non-negative value: a number, or the big-endian magnitude.
 * Redundant leading zero bytes are dropped and one is added when the high
 * bit is set, so the value stays positive and the encoding minimal.
 */
export function derUnsignedInteger(value: Buffer | number): Buffer {
  let bytes: Buffer;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid DER integer: ${String(value)}`);
    }
    const digits: number[] = [];
    for (let n = value; n > 0; n = Math.floor(n / 256)) digits.unshift(n % 256);
    bytes = Buffer.from(digits);
  } else {
    bytes = value;
  }
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start++;
  const magnitude = bytes.subarray(start);
  if (magnitude.length === 0) return derTlv(TAG_INTEGER, Buffer.from([0]));
  if (magnitude[0] & 0x80) return derTlv(TAG_INTEGER, Buffer.from([0]), magnitude);
  return derTlv(TAG_INTEGER, magnitude);
}

/** OBJECT IDENTIFIER from its dotted form, e.g. `2.5.4.3`. */
export function derOid(oid: string): Buffer {
  const parts = oid.split('.');
  if (parts.length < 2 || !parts.every((p) => /^\d+$/.test(p))) {
    throw new Error(`Invalid OID: ${oid}`);
  }
  const arcs = parts.map(Number);
  if (!arcs.every(Number.isSafeInteger)) throw new Error(`Invalid OID: ${oid}`);
  const [first, second] = arcs;
  if (first > 2 || (first < 2 && second > 39)) throw new Error(`Invalid OID: ${oid}`);
  const out: number[] = [];
  for (const arc of [first * 40 + second, ...arcs.slice(2)]) {
    // Base 128, most significant group first, continuation bit on all but
    // the last group.
    const groups = [arc % 128];
    for (let n = Math.floor(arc / 128); n > 0; n = Math.floor(n / 128)) {
      groups.unshift(0x80 | (n % 128));
    }
    out.push(...groups);
  }
  return derTlv(TAG_OID, Buffer.from(out));
}

export function derNull(): Buffer {
  return Buffer.from([TAG_NULL, 0]);
}

export function derBoolean(value: boolean): Buffer {
  return Buffer.from([TAG_BOOLEAN, 1, value ? 0xff : 0x00]);
}

export function derBitString(bytes: Buffer, unusedBits = 0): Buffer {
  if (!Number.isInteger(unusedBits) || unusedBits < 0 || unusedBits > 7) {
    throw new Error(`Invalid unused bit count: ${String(unusedBits)}`);
  }
  return derTlv(TAG_BIT_STRING, Buffer.from([unusedBits]), bytes);
}

export function derOctetString(bytes: Buffer): Buffer {
  return derTlv(TAG_OCTET_STRING, bytes);
}

/** DirectoryString: PrintableString when the value allows it, else UTF8String. */
export function derDirectoryString(value: string): Buffer {
  if (/^[A-Za-z0-9 '()+,\-./:=?]*$/.test(value)) {
    return derTlv(TAG_PRINTABLE_STRING, Buffer.from(value, 'latin1'));
  }
  return derTlv(TAG_UTF8_STRING, Buffer.from(value, 'utf8'));
}

/**
 * Validity time per RFC 5280 4.1.2.5: UTCTime (`YYMMDDHHMMSSZ`) for 1950 to
 * 2049, GeneralizedTime (`YYYYMMDDHHMMSSZ`) from 2050. Milliseconds are
 * dropped.
 */
export function derTime(date: Date): Buffer {
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < 1950 || year > 9999) {
    throw new Error(`Date out of range for a certificate: ${String(date)}`);
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  const rest =
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  if (year < 2050) {
    return derTlv(TAG_UTC_TIME, Buffer.from(pad(year % 100) + rest, 'latin1'));
  }
  return derTlv(TAG_GENERALIZED_TIME, Buffer.from(String(year) + rest, 'latin1'));
}

/** Context-specific tag `[n]`, constructed or primitive. */
function contextTag(n: number, constructed: boolean): number {
  return 0x80 | (constructed ? 0x20 : 0) | n;
}

/**
 * The 4 (IPv4) or 16 (IPv6) address bytes of an IP literal, or `null` when
 * `address` is not one. An IPv6 zone (`%eth0`) is not part of the address.
 */
export function ipAddressBytes(address: string): Buffer | null {
  if (isIPv4(address)) {
    return Buffer.from(address.split('.').map(Number));
  }
  if (!isIPv6(address)) return null;
  let ip = address.split('%')[0];
  const tail: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const last = ip.slice(lastColon + 1);
  if (isIPv4(last)) {
    tail.push(...last.split('.').map(Number));
    ip = ip.slice(0, lastColon + 1) + '0:0';
  }
  const [head, rest] = ip.split('::') as [string, string | undefined];
  const groups = (s: string): number[] =>
    s === '' ? [] : s.split(':').map((g) => parseInt(g, 16));
  const left = groups(head);
  const right = rest === undefined ? [] : groups(rest);
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const words = [...left, ...new Array<number>(fill).fill(0), ...right];
  if (words.length !== 8) return null;
  const out = Buffer.alloc(16);
  words.forEach((w, i) => out.writeUInt16BE(w, i * 2));
  if (tail.length === 4) Buffer.from(tail).copy(out, 12);
  return out;
}

/** GeneralName for subjectAltName: iPAddress `[7]` or dNSName `[2]`. */
function generalName(host: string): Buffer {
  const ip = ipAddressBytes(host);
  if (ip) return derTlv(contextTag(7, false), ip);
  // dNSName is an IA5String; accept printable ASCII without spaces.
  if (!/^[\x21-\x7e]+$/.test(host)) {
    throw new Error(`Invalid host for a certificate: ${JSON.stringify(host)}`);
  }
  return derTlv(contextTag(2, false), Buffer.from(host, 'latin1'));
}

function extension(oid: string, critical: boolean, value: Buffer): Buffer {
  return derSequence(
    derOid(oid),
    // critical is DEFAULT FALSE, so DER leaves it out when false.
    ...(critical ? [derBoolean(true)] : []),
    derOctetString(value),
  );
}

/** PEM: base64 in 64-character lines between BEGIN/END labels. */
export function toPem(label: string, der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export interface SelfSignedCertificateFields {
  /** Serial number, big-endian magnitude (encoded as a positive INTEGER). */
  serial: Buffer;
  /** Subject and issuer common name. */
  commonName: string;
  notBefore: Date;
  notAfter: Date;
  /** DNS names and IP addresses for subjectAltName, in this order. */
  hosts: string[];
  /** RSA key pair; the certificate is signed with SHA-256. */
  publicKey: KeyObject;
  privateKey: KeyObject;
}

/**
 * DER of an X.509 v3 end-entity certificate for a TLS server, signed by its
 * own key: subject = issuer = `CN=<commonName>`, basicConstraints CA:FALSE
 * (critical), keyUsage digitalSignature + keyEncipherment (critical),
 * extKeyUsage serverAuth, subjectAltName = `hosts`.
 */
export function buildSelfSignedCertificate(fields: SelfSignedCertificateFields): Buffer {
  if (
    fields.privateKey.asymmetricKeyType !== 'rsa' ||
    fields.publicKey.asymmetricKeyType !== 'rsa'
  ) {
    throw new Error('Only RSA keys are supported for the self-signed certificate');
  }
  const signatureAlgorithm = derSequence(derOid(OID_SHA256_WITH_RSA), derNull());
  const name = derSequence(
    derSet(derSequence(derOid(OID_COMMON_NAME), derDirectoryString(fields.commonName))),
  );
  const extensions = derSequence(
    // BasicConstraints ::= SEQUENCE { cA BOOLEAN DEFAULT FALSE, ... }
    extension(OID_BASIC_CONSTRAINTS, true, derSequence()),
    // KeyUsage bits 0 (digitalSignature) and 2 (keyEncipherment): 101xxxxx,
    // 5 unused bits.
    extension(OID_KEY_USAGE, true, derBitString(Buffer.from([0xa0]), 5)),
    extension(OID_EXT_KEY_USAGE, false, derSequence(derOid(OID_SERVER_AUTH))),
    extension(OID_SUBJECT_ALT_NAME, false, derSequence(...fields.hosts.map(generalName))),
  );
  const spki = fields.publicKey.export({ type: 'spki', format: 'der' });

  const tbsCertificate = derSequence(
    derTlv(contextTag(0, true), derUnsignedInteger(2)), // version v3
    derUnsignedInteger(fields.serial),
    signatureAlgorithm,
    name, // issuer
    derSequence(derTime(fields.notBefore), derTime(fields.notAfter)),
    name, // subject
    spki,
    derTlv(contextTag(3, true), extensions),
  );
  // RSA keys sign with PKCS#1 v1.5 by default, as sha256WithRSAEncryption
  // requires.
  const signature = sign('sha256', tbsCertificate, fields.privateKey);
  return derSequence(tbsCertificate, signatureAlgorithm, derBitString(signature));
}
