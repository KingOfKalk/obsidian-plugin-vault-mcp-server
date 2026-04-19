import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpMcpServer, HttpServerOptions } from '../../src/server/http-server';
import { Logger } from '../../src/utils/logger';

interface FakeServer {
  close: () => Promise<void>;
}
interface FakeTransport {
  close: () => Promise<void>;
}
interface InternalSession {
  transport: FakeTransport;
  server: FakeServer;
  lastActivity: number;
}

interface InternalHttpMcpServer {
  sessions: Map<string, InternalSession>;
}

function makeServer(
  opts: Partial<HttpServerOptions> = {},
  clock: () => number = () => 0,
): { server: HttpMcpServer; logger: Logger } {
  const logger = new Logger('test', { debugMode: false, accessKey: '' });
  const server = new HttpMcpServer(
    () => ({}) as never,
    logger,
    {
      host: '127.0.0.1',
      port: 0,
      authEnabled: false,
      accessKey: '',
      ...opts,
    },
    clock,
  );
  return { server, logger };
}

function injectSession(
  server: HttpMcpServer,
  id: string,
  lastActivity: number,
): { serverCloseSpy: ReturnType<typeof vi.fn> } {
  const serverCloseSpy = vi.fn().mockResolvedValue(undefined);
  const transportCloseSpy = vi.fn().mockResolvedValue(undefined);
  const session: InternalSession = {
    transport: { close: transportCloseSpy },
    server: { close: serverCloseSpy },
    lastActivity,
  };
  (server as unknown as InternalHttpMcpServer).sessions.set(id, session);
  return { serverCloseSpy };
}

describe('HttpMcpServer idle session sweep', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('closes sessions idle beyond the configured timeout', () => {
    let now = 0;
    const { server } = makeServer(
      { sessionIdleTimeoutMs: 10_000, sessionSweepIntervalMs: 1_000 },
      () => now,
    );
    const { serverCloseSpy } = injectSession(server, 'old', 0);

    now = 11_000;
    server.runIdleSweepNow();

    expect(server.activeSessions).toBe(0);
    expect(serverCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps sessions that are still within the timeout', () => {
    let now = 0;
    const { server } = makeServer(
      { sessionIdleTimeoutMs: 10_000 },
      () => now,
    );
    const { serverCloseSpy } = injectSession(server, 'active', 0);

    now = 5_000;
    server.runIdleSweepNow();

    expect(server.activeSessions).toBe(1);
    expect(serverCloseSpy).not.toHaveBeenCalled();
  });

  it('keeps fresh sessions while closing only the stale ones', () => {
    let now = 0;
    const { server } = makeServer(
      { sessionIdleTimeoutMs: 10_000 },
      () => now,
    );
    const { serverCloseSpy: staleClose } = injectSession(server, 'stale', 0);
    const { serverCloseSpy: freshClose } = injectSession(
      server,
      'fresh',
      8_000,
    );

    now = 12_000;
    server.runIdleSweepNow();

    expect(server.activeSessions).toBe(1);
    expect(staleClose).toHaveBeenCalledTimes(1);
    expect(freshClose).not.toHaveBeenCalled();
  });

  it('does nothing when the timeout is disabled (0)', () => {
    let now = 0;
    const { server } = makeServer(
      { sessionIdleTimeoutMs: 0 },
      () => now,
    );
    const { serverCloseSpy } = injectSession(server, 'whatever', 0);

    now = 1_000_000;
    server.runIdleSweepNow();

    expect(server.activeSessions).toBe(1);
    expect(serverCloseSpy).not.toHaveBeenCalled();
  });

  it('logs close failures at error level with the session id', async () => {
    let now = 0;
    const { server, logger } = makeServer(
      { sessionIdleTimeoutMs: 10_000 },
      () => now,
    );
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const serverCloseSpy = vi
      .fn()
      .mockRejectedValue(new Error('boom'));
    const session: InternalSession = {
      transport: { close: vi.fn().mockResolvedValue(undefined) },
      server: { close: serverCloseSpy },
      lastActivity: 0,
    };
    (server as unknown as InternalHttpMcpServer).sessions.set(
      'broken',
      session,
    );

    now = 20_000;
    server.runIdleSweepNow();

    // Let the rejected close() propagate to the .catch handler.
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
    const call = errorSpy.mock.calls.find((c) =>
      String(c[0]).includes('broken'),
    );
    expect(call).toBeDefined();
    expect(String(call?.[0])).toContain('broken');
    expect(String(call?.[0])).toContain('boom');
  });
});
