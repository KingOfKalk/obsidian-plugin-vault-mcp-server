import { describe, it, expect } from 'vitest';
import { authenticateRequest } from '../../src/server/auth';
import { IncomingMessage } from 'http';

function createMockRequest(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('authenticateRequest', () => {
  const accessKey = 'test-key-12345';

  describe('with auth enabled', () => {
    it('should authenticate with a valid bearer token', () => {
      const req = createMockRequest({ authorization: `Bearer ${accessKey}` });
      const result = authenticateRequest(req, accessKey, true);
      expect(result.authenticated).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject when no Authorization header is present', () => {
      const req = createMockRequest({});
      const result = authenticateRequest(req, accessKey, true);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Missing Authorization');
    });

    it('should reject when Authorization header format is invalid', () => {
      const req = createMockRequest({ authorization: 'Basic abc123' });
      const result = authenticateRequest(req, accessKey, true);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Invalid Authorization');
    });

    it('should reject when the token does not match', () => {
      const req = createMockRequest({ authorization: 'Bearer wrong-key' });
      const result = authenticateRequest(req, accessKey, true);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Invalid access key');
    });

    it('authenticates with equal tokens of equal length (timing-safe path)', () => {
      const key = 'a'.repeat(32);
      const req = createMockRequest({ authorization: `Bearer ${key}` });
      const result = authenticateRequest(req, key, true);
      expect(result.authenticated).toBe(true);
    });

    it('rejects unequal tokens of equal length (timing-safe path)', () => {
      const key = 'a'.repeat(32);
      const wrong = 'b'.repeat(32);
      const req = createMockRequest({ authorization: `Bearer ${wrong}` });
      const result = authenticateRequest(req, key, true);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Invalid access key');
    });

    it('rejects tokens of different length without leaking via short-circuit', () => {
      const key = 'a'.repeat(32);
      const shorter = 'a'.repeat(16);
      const longer = 'a'.repeat(48);
      expect(
        authenticateRequest(
          createMockRequest({ authorization: `Bearer ${shorter}` }),
          key,
          true,
        ).authenticated,
      ).toBe(false);
      expect(
        authenticateRequest(
          createMockRequest({ authorization: `Bearer ${longer}` }),
          key,
          true,
        ).authenticated,
      ).toBe(false);
    });

    it('should reject when access key is empty', () => {
      const req = createMockRequest({ authorization: 'Bearer something' });
      const result = authenticateRequest(req, '', true);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should reject token with extra spaces', () => {
      const req = createMockRequest({ authorization: `Bearer  ${accessKey}` });
      const result = authenticateRequest(req, accessKey, true);
      expect(result.authenticated).toBe(false);
    });
  });

  describe('with auth disabled', () => {
    it('authenticates a request with no Authorization header', () => {
      const req = createMockRequest({});
      const result = authenticateRequest(req, accessKey, false);
      expect(result.authenticated).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('authenticates even when the access key is empty', () => {
      const req = createMockRequest({});
      const result = authenticateRequest(req, '', false);
      expect(result.authenticated).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('authenticates regardless of an invalid Bearer token', () => {
      const req = createMockRequest({ authorization: 'Bearer wrong-key' });
      const result = authenticateRequest(req, accessKey, false);
      expect(result.authenticated).toBe(true);
    });

    it('authenticates regardless of a malformed Authorization header', () => {
      const req = createMockRequest({ authorization: 'Basic nope' });
      const result = authenticateRequest(req, accessKey, false);
      expect(result.authenticated).toBe(true);
    });
  });
});
