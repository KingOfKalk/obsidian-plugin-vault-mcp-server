import { describe, it, expect, beforeAll } from 'vitest';
import { X509Certificate, generateKeyPairSync, type KeyObject } from 'crypto';
import {
  buildSelfSignedCertificate,
  derBitString,
  derBoolean,
  derDirectoryString,
  derLength,
  derOid,
  derSequence,
  derTime,
  derUnsignedInteger,
  ipAddressBytes,
  toPem,
} from '../../src/server/x509';

const hex = (b: Buffer): string => b.toString('hex');

describe('DER encoding', () => {
  it('encodes short and long-form lengths', () => {
    expect(hex(derLength(0))).toBe('00');
    expect(hex(derLength(0x7f))).toBe('7f');
    expect(hex(derLength(0x80))).toBe('8180');
    expect(hex(derLength(0xff))).toBe('81ff');
    expect(hex(derLength(0x100))).toBe('820100');
    expect(hex(derLength(0x10000))).toBe('83010000');
  });

  it('rejects invalid lengths', () => {
    expect(() => derLength(-1)).toThrow();
    expect(() => derLength(1.5)).toThrow();
  });

  it('wraps content in a SEQUENCE with a long-form length', () => {
    const content = Buffer.alloc(200, 0xab);
    const seq = derSequence(content);
    expect(hex(seq.subarray(0, 3))).toBe('3081c8');
    expect(seq.length).toBe(203);
  });

  it('encodes unsigned integers minimally and keeps them positive', () => {
    expect(hex(derUnsignedInteger(Buffer.from([])))).toBe('020100');
    expect(hex(derUnsignedInteger(Buffer.from([0])))).toBe('020100');
    expect(hex(derUnsignedInteger(Buffer.from([0, 0, 1])))).toBe('020101');
    expect(hex(derUnsignedInteger(Buffer.from([0x7f])))).toBe('02017f');
    // High bit set: a leading zero keeps the value positive.
    expect(hex(derUnsignedInteger(Buffer.from([0x80])))).toBe('02020080');
    expect(hex(derUnsignedInteger(Buffer.from([0, 0x80, 1])))).toBe('0203008001');
    expect(hex(derUnsignedInteger(2))).toBe('020102');
  });

  it('encodes object identifiers', () => {
    expect(hex(derOid('2.5.4.3'))).toBe('0603550403');
    expect(hex(derOid('1.2.840.113549.1.1.11'))).toBe('06092a864886f70d01010b');
    expect(hex(derOid('1.3.6.1.5.5.7.3.1'))).toBe('06082b06010505070301');
    expect(hex(derOid('2.5.29.17'))).toBe('0603551d11');
  });

  it('rejects malformed object identifiers', () => {
    expect(() => derOid('1')).toThrow();
    expect(() => derOid('3.1')).toThrow();
    expect(() => derOid('1.40')).toThrow();
    expect(() => derOid('1.2.x')).toThrow();
  });

  it('encodes booleans as DER (0xff for true)', () => {
    expect(hex(derBoolean(true))).toBe('0101ff');
    expect(hex(derBoolean(false))).toBe('010100');
  });

  it('encodes bit strings with their unused-bit count', () => {
    // keyUsage digitalSignature + keyEncipherment
    expect(hex(derBitString(Buffer.from([0xa0]), 5))).toBe('030205a0');
    expect(hex(derBitString(Buffer.from([1, 2])))).toBe('0303000102');
    expect(() => derBitString(Buffer.from([1]), 8)).toThrow();
  });

  it('uses PrintableString when possible and UTF8String otherwise', () => {
    const printable = derDirectoryString('Vault MCP Server (localhost)');
    expect(printable[0]).toBe(0x13);
    expect(printable.subarray(2).toString('latin1')).toBe('Vault MCP Server (localhost)');
    const utf8 = derDirectoryString('Tresor_ü');
    expect(utf8[0]).toBe(0x0c);
    expect(utf8.subarray(2).toString('utf8')).toBe('Tresor_ü');
  });

  it('encodes times as UTCTime before 2050 and GeneralizedTime from 2050', () => {
    const utc = derTime(new Date('2026-11-13T17:40:17.987Z'));
    expect(utc[0]).toBe(0x17);
    expect(utc.subarray(2).toString('latin1')).toBe('261113174017Z');
    const last = derTime(new Date('2049-12-31T23:59:59Z'));
    expect(last.subarray(2).toString('latin1')).toBe('491231235959Z');
    const gen = derTime(new Date('2050-01-01T00:00:00Z'));
    expect(gen[0]).toBe(0x18);
    expect(gen.subarray(2).toString('latin1')).toBe('20500101000000Z');
    expect(() => derTime(new Date('1949-12-31T23:59:59Z'))).toThrow();
    expect(() => derTime(new Date(NaN))).toThrow();
  });
});

describe('ipAddressBytes', () => {
  it('returns 4 bytes for IPv4', () => {
    expect(hex(ipAddressBytes('127.0.0.1') ?? Buffer.alloc(0))).toBe('7f000001');
    expect(hex(ipAddressBytes('192.168.1.42') ?? Buffer.alloc(0))).toBe('c0a8012a');
  });

  it('returns 16 bytes for IPv6, including :: and an embedded IPv4 tail', () => {
    expect(hex(ipAddressBytes('::1') ?? Buffer.alloc(0))).toBe('00000000000000000000000000000001');
    expect(hex(ipAddressBytes('::') ?? Buffer.alloc(0))).toBe('00000000000000000000000000000000');
    expect(hex(ipAddressBytes('2001:db8::8a2e:370:7334') ?? Buffer.alloc(0))).toBe(
      '20010db80000000000008a2e03707334',
    );
    expect(hex(ipAddressBytes('fe80::') ?? Buffer.alloc(0))).toBe(
      'fe800000000000000000000000000000',
    );
    expect(hex(ipAddressBytes('::ffff:192.0.2.1') ?? Buffer.alloc(0))).toBe(
      '00000000000000000000ffffc0000201',
    );
    expect(hex(ipAddressBytes('1:2:3:4:5:6:7:8') ?? Buffer.alloc(0))).toBe(
      '00010002000300040005000600070008',
    );
  });

  it('returns null for names and invalid addresses', () => {
    expect(ipAddressBytes('localhost')).toBeNull();
    expect(ipAddressBytes('1.2.3.999')).toBeNull();
    expect(ipAddressBytes('1::2::3')).toBeNull();
  });
});

describe('toPem', () => {
  it('wraps base64 at 64 characters between the labels', () => {
    const der = Buffer.alloc(100, 0x41);
    const pem = toPem('CERTIFICATE', der);
    const lines = pem.trimEnd().split('\n');
    expect(lines[0]).toBe('-----BEGIN CERTIFICATE-----');
    expect(lines[lines.length - 1]).toBe('-----END CERTIFICATE-----');
    expect(lines[1]).toHaveLength(64);
    expect(Buffer.from(lines.slice(1, -1).join(''), 'base64').equals(der)).toBe(true);
    expect(pem.endsWith('\n')).toBe(true);
  });
});

describe('buildSelfSignedCertificate', () => {
  let publicKey: KeyObject;
  let privateKey: KeyObject;

  beforeAll(() => {
    ({ publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }));
  });

  function build(
    overrides: Partial<Parameters<typeof buildSelfSignedCertificate>[0]> = {},
  ): X509Certificate {
    const der = buildSelfSignedCertificate({
      serial: Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
      commonName: 'Vault MCP Server (localhost)',
      notBefore: new Date('2026-01-02T03:04:05Z'),
      notAfter: new Date('2027-01-02T03:04:05Z'),
      hosts: ['localhost', '127.0.0.1', '::1'],
      publicKey,
      privateKey,
      ...overrides,
    });
    return new X509Certificate(der);
  }

  it('produces a certificate Node parses with the given fields', () => {
    const x509 = build();
    expect(x509.subject).toBe('CN=Vault MCP Server (localhost)');
    expect(x509.issuer).toBe('CN=Vault MCP Server (localhost)');
    expect(x509.serialNumber).toBe('0123456789ABCDEF0123456789ABCDEF');
    expect(new Date(x509.validFrom).toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(new Date(x509.validTo).toISOString()).toBe('2027-01-02T03:04:05.000Z');
    expect(x509.subjectAltName).toBe(
      'DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1',
    );
    expect(x509.ca).toBe(false);
    expect(x509.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']);
    expect(x509.publicKey.equals(publicKey)).toBe(true);
  });

  it('is signed by the given private key', () => {
    const x509 = build();
    expect(x509.verify(publicKey)).toBe(true);
    expect(x509.checkPrivateKey(privateKey)).toBe(true);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(x509.verify(other.publicKey)).toBe(false);
  });

  it('accepts a notAfter from 2050 on (GeneralizedTime)', () => {
    const x509 = build({ notAfter: new Date('2051-06-07T08:09:10Z') });
    expect(new Date(x509.validTo).toISOString()).toBe('2051-06-07T08:09:10.000Z');
  });

  it('keeps a serial with the high bit set positive', () => {
    const x509 = build({ serial: Buffer.from('ff00', 'hex') });
    expect(x509.serialNumber).toMatch(/^0*FF00$/);
  });

  it('rejects a non-RSA key', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => build({ publicKey: ec.publicKey, privateKey: ec.privateKey })).toThrow(/RSA/);
  });

  it('rejects a host that is neither an IP address nor a DNS name', () => {
    expect(() => build({ hosts: ['bad host'] })).toThrow(/host/);
    expect(() => build({ hosts: [''] })).toThrow(/host/);
  });
});
