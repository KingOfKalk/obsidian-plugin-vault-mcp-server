import { describe, it, expect } from 'vitest';
import type { IncomingMessage, IncomingHttpHeaders } from 'http';
import {
  validateOriginHost,
  type OriginHostOptions,
} from '../../src/server/origin-host';

function makeReq(headers: IncomingHttpHeaders): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

const DEFAULTS: OriginHostOptions = {
  allowedOrigins: [
    'http://127.0.0.1',
    'http://localhost',
    'https://127.0.0.1',
    'https://localhost',
  ],
  allowedHosts: ['127.0.0.1', 'localhost'],
  allowNullOrigin: false,
  requireOrigin: false,
};

describe('validateOriginHost', (): void => {
  it('accepts a same-origin POST with loopback Host', (): void => {
    const req = makeReq({
      origin: 'http://127.0.0.1',
      host: '127.0.0.1:28741',
    });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(true);
  });

  it('accepts the explicit-port origin when included in the allowlist', (): void => {
    const req = makeReq({
      origin: 'http://127.0.0.1:28741',
      host: '127.0.0.1:28741',
    });
    const result = validateOriginHost(req, {
      ...DEFAULTS,
      allowedOrigins: ['http://127.0.0.1:28741'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an origin with a port not present in the allowlist (exact match)', (): void => {
    const req = makeReq({
      origin: 'http://127.0.0.1:9999',
      host: '127.0.0.1:28741',
    });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(false);
  });

  it('rejects a cross-origin POST', (): void => {
    const req = makeReq({
      origin: 'http://attacker.com',
      host: '127.0.0.1:28741',
    });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.origin).toBe('http://attacker.com');
    }
  });

  it('rejects Origin: null by default', (): void => {
    const req = makeReq({
      origin: 'null',
      host: '127.0.0.1:28741',
    });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(false);
  });

  it('accepts Origin: null when allowNullOrigin is true', (): void => {
    const req = makeReq({
      origin: 'null',
      host: '127.0.0.1:28741',
    });
    const result = validateOriginHost(req, {
      ...DEFAULTS,
      allowNullOrigin: true,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a missing Origin by default', (): void => {
    const req = makeReq({ host: '127.0.0.1:28741' });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(true);
  });

  it('rejects a missing Origin when requireOrigin is true', (): void => {
    const req = makeReq({ host: '127.0.0.1:28741' });
    const result = validateOriginHost(req, {
      ...DEFAULTS,
      requireOrigin: true,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a hostile Host header', (): void => {
    const req = makeReq({
      origin: 'http://127.0.0.1',
      host: 'attacker.com',
    });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.host).toBe('attacker.com');
    }
  });

  it('accepts an allowlisted Host with a port suffix', (): void => {
    const req = makeReq({
      origin: 'http://localhost',
      host: 'localhost:27123',
    });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(true);
  });

  it('rejects a missing Host header', (): void => {
    const req = makeReq({ origin: 'http://127.0.0.1' });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty-string Host', (): void => {
    const req = makeReq({ host: '', origin: 'http://127.0.0.1' });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(false);
  });

  it('compares hosts case-insensitively', (): void => {
    const req = makeReq({ origin: 'http://localhost', host: 'LocalHost:28741' });
    const result = validateOriginHost(req, DEFAULTS);
    expect(result.ok).toBe(true);
  });

  it('rejects everything when allowedHosts is empty', (): void => {
    const req = makeReq({ origin: 'http://127.0.0.1', host: '127.0.0.1' });
    const result = validateOriginHost(req, {
      ...DEFAULTS,
      allowedHosts: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown origins when allowedOrigins is empty', (): void => {
    const req = makeReq({ origin: 'http://127.0.0.1', host: '127.0.0.1' });
    const result = validateOriginHost(req, {
      ...DEFAULTS,
      allowedOrigins: [],
    });
    expect(result.ok).toBe(false);
  });

  it('handles IPv6 Host with brackets and port', (): void => {
    const req = makeReq({
      origin: 'http://localhost',
      host: '[::1]:28741',
    });
    const result = validateOriginHost(req, {
      ...DEFAULTS,
      allowedHosts: ['::1'],
    });
    expect(result.ok).toBe(true);
  });
});
