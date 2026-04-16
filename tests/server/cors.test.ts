import { describe, it, expect, vi } from 'vitest';
import { applyCorsHeaders, handlePreflight, DEFAULT_CORS_OPTIONS } from '../../src/server/cors';
import { IncomingMessage, ServerResponse } from 'http';

interface MockResponseResult {
  res: ServerResponse;
  setHeaderCalls: Array<[string, string]>;
  writeHeadCalls: number[];
  endCallCount: { value: number };
}

function createMockResponse(): MockResponseResult {
  const setHeaderCalls: Array<[string, string]> = [];
  const writeHeadCalls: number[] = [];
  const endCallCount = { value: 0 };

  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      setHeaderCalls.push([name, value]);
    }),
    writeHead: vi.fn((code: number) => {
      writeHeadCalls.push(code);
    }),
    end: vi.fn(() => {
      endCallCount.value++;
    }),
  } as unknown as ServerResponse;

  return { res, setHeaderCalls, writeHeadCalls, endCallCount };
}

function createMockRequest(method: string): IncomingMessage {
  return { method } as unknown as IncomingMessage;
}

describe('applyCorsHeaders', () => {
  it('should set all CORS headers with defaults', () => {
    const { res, setHeaderCalls } = createMockResponse();
    applyCorsHeaders(res);
    const headerMap = new Map(setHeaderCalls);
    expect(headerMap.get('Access-Control-Allow-Origin')).toBe('http://localhost');
    expect(headerMap.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS');
    expect(headerMap.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization, Mcp-Session-Id',
    );
    expect(headerMap.get('Access-Control-Max-Age')).toBe('86400');
    expect(headerMap.get('Access-Control-Expose-Headers')).toBe('Mcp-Session-Id');
  });

  it('should use custom options when provided', () => {
    const { res, setHeaderCalls } = createMockResponse();
    applyCorsHeaders(res, {
      allowOrigin: '*',
      allowMethods: ['POST'],
      allowHeaders: ['Content-Type'],
      maxAge: 3600,
    });
    const headerMap = new Map(setHeaderCalls);
    expect(headerMap.get('Access-Control-Allow-Origin')).toBe('*');
    expect(headerMap.get('Access-Control-Allow-Methods')).toBe('POST');
  });
});

describe('handlePreflight', () => {
  it('should handle OPTIONS requests and return true', () => {
    const req = createMockRequest('OPTIONS');
    const { res, writeHeadCalls, endCallCount } = createMockResponse();
    const result = handlePreflight(req, res, DEFAULT_CORS_OPTIONS);
    expect(result).toBe(true);
    expect(writeHeadCalls).toContain(204);
    expect(endCallCount.value).toBe(1);
  });

  it('should not handle non-OPTIONS requests', () => {
    const req = createMockRequest('POST');
    const { res, writeHeadCalls } = createMockResponse();
    const result = handlePreflight(req, res, DEFAULT_CORS_OPTIONS);
    expect(result).toBe(false);
    expect(writeHeadCalls).toHaveLength(0);
  });

  it('should not handle GET requests', () => {
    const req = createMockRequest('GET');
    const { res } = createMockResponse();
    const result = handlePreflight(req, res, DEFAULT_CORS_OPTIONS);
    expect(result).toBe(false);
  });
});
