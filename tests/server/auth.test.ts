import { describe, it, expect } from 'vitest';
import { authenticateRequest } from '../../src/server/auth';
import { IncomingMessage } from 'http';

function createMockRequest(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('authenticateRequest', () => {
  const accessKey = 'test-key-12345';

  it('should authenticate with a valid bearer token', () => {
    const req = createMockRequest({ authorization: `Bearer ${accessKey}` });
    const result = authenticateRequest(req, accessKey);
    expect(result.authenticated).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject when no Authorization header is present', () => {
    const req = createMockRequest({});
    const result = authenticateRequest(req, accessKey);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Missing Authorization');
  });

  it('should reject when Authorization header format is invalid', () => {
    const req = createMockRequest({ authorization: 'Basic abc123' });
    const result = authenticateRequest(req, accessKey);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Invalid Authorization');
  });

  it('should reject when the token does not match', () => {
    const req = createMockRequest({ authorization: 'Bearer wrong-key' });
    const result = authenticateRequest(req, accessKey);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Invalid access key');
  });

  it('should reject when access key is empty', () => {
    const req = createMockRequest({ authorization: 'Bearer something' });
    const result = authenticateRequest(req, '');
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('should reject token with extra spaces', () => {
    const req = createMockRequest({ authorization: `Bearer  ${accessKey}` });
    const result = authenticateRequest(req, accessKey);
    expect(result.authenticated).toBe(false);
  });
});
