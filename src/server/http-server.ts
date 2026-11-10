import { createServer as createHttpServer, IncomingMessage, Server, ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { randomUUID } from 'crypto';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer, isInitializeRequest } from '@modelcontextprotocol/server';
import { Logger } from '../utils/logger';
import { authenticateRequest, sendAuthError, sendRateLimitError } from './auth';
import { applyCorsHeaders, handlePreflight, CorsOptions, DEFAULT_CORS_OPTIONS } from './cors';
import { FailureRateLimiter, normalizeIp } from './rate-limiter';
import { validateOriginHost, type OriginHostOptions } from './origin-host';
import { MCP_ENDPOINT_PATH } from '../constants';
import { sendJson } from './send-json';
import { DEFAULT_ALLOWED_HOSTS, DEFAULT_ALLOWED_ORIGINS } from '../types';

export interface HttpServerOptions {
  host: string;
  port: number;
  /** When false, the server skips Bearer token validation entirely. */
  authEnabled: boolean;
  accessKey: string;
  corsOptions?: CorsOptions;
  /** When provided, the server uses HTTPS with these PEM-encoded credentials. */
  tls?: { cert: string; key: string };
  /**
   * How long an MCP session may be idle before the periodic sweep closes it.
   * Defaults to 10 minutes. Set to 0 to disable the idle timeout.
   */
  sessionIdleTimeoutMs?: number;
  /**
   * How often the idle-session sweep runs. Defaults to 60 seconds. Set to 0
   * to disable the sweep entirely.
   */
  sessionSweepIntervalMs?: number;
  /**
   * DNS-rebind protection. When omitted, defaults to loopback-only Origin
   * and Host allowlists; pass an explicit object to widen.
   */
  originHost?: OriginHostOptions;
  /**
   * Maximum number of concurrent MCP sessions. When a new session would
   * exceed it, the least recently active session is closed. Defaults to
   * {@link DEFAULT_MAX_SESSIONS}. Set to 0 to disable the cap.
   */
  maxSessions?: number;
  /**
   * How long `start()` keeps retrying when the port is in use (#518). A
   * plugin update unloads the old instance without waiting for its server
   * to stop, so the new instance can try to bind a moment too early.
   * Defaults to {@link DEFAULT_BIND_RETRY_TIMEOUT_MS}. Set to 0 to fail on
   * the first EADDRINUSE.
   */
  bindRetryTimeoutMs?: number;
  /** Pause between bind attempts. Defaults to {@link DEFAULT_BIND_RETRY_DELAY_MS}. */
  bindRetryDelayMs?: number;
}

const DEFAULT_ORIGIN_HOST_OPTIONS: OriginHostOptions = {
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
  allowedHosts: [...DEFAULT_ALLOWED_HOSTS],
  allowNullOrigin: false,
  requireOrigin: false,
};

export type McpServerFactory = () => McpServer;

interface Session {
  transport: NodeStreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_SWEEP_INTERVAL_MS = 60 * 1000;
export const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_BIND_RETRY_TIMEOUT_MS = 5000;
const DEFAULT_BIND_RETRY_DELAY_MS = 250;

function requestPath(url: string | undefined): string {
  const raw = url ?? '/';
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}

/** The request's `Origin`, if it is a real origin (not absent or `null`). */
function requestOrigin(req: IncomingMessage): string | undefined {
  const header = req.headers.origin;
  const origin = typeof header === 'string' ? header : undefined;
  return origin !== undefined && origin.length > 0 && origin !== 'null' ? origin : undefined;
}

export class HttpMcpServer {
  private httpServer: Server | null = null;
  private logger: Logger;
  private serverFactory: McpServerFactory;
  private options: HttpServerOptions;
  private _connectedClients = 0;
  private sessions = new Map<string, Session>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private clock: () => number;
  private rateLimiter: FailureRateLimiter;
  private stopping: Promise<void> | null = null;

  constructor(
    serverFactory: McpServerFactory,
    logger: Logger,
    options: HttpServerOptions,
    clock: () => number = Date.now,
  ) {
    this.serverFactory = serverFactory;
    this.logger = logger;
    this.options = options;
    this.clock = clock;
    this.rateLimiter = new FailureRateLimiter({ clock });
  }

  get connectedClients(): number {
    return this._connectedClients;
  }

  get isRunning(): boolean {
    return this.httpServer !== null && this.httpServer.listening;
  }

  get port(): number {
    return this.options.port;
  }

  get activeSessions(): number {
    return this.sessions.size;
  }

  get scheme(): 'http' | 'https' {
    return this.options.tls ? 'https' : 'http';
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Server is already running');
      return;
    }

    const corsOptions = this.options.corsOptions ?? DEFAULT_CORS_OPTIONS;

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      // Request handler: log unhandled rejections but don't fire a Notice per
      // request — that would spam users under failure conditions.
      this.handleRequest(req, res, corsOptions).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Unhandled request error: ${message}`, error);
      });
    };

    this.httpServer = this.options.tls
      ? createHttpsServer(
          { cert: this.options.tls.cert, key: this.options.tls.key },
          handler,
        )
      : createHttpServer(handler);

    this.httpServer.on('connection', () => {
      this._connectedClients++;
    });

    this.httpServer.on('close', () => {
      this._connectedClients = 0;
    });

    // Bind errors are handled by listenWithRetry(); this keeps a later
    // server error from being thrown as an unhandled 'error' event.
    const server = this.httpServer;
    server.on('error', (error: Error) => {
      if (server.listening) {
        this.logger.error(`MCP server error: ${error.message}`, error);
      }
    });

    try {
      await this.listenWithRetry(this.httpServer);
    } catch (error) {
      this.httpServer = null;
      this._connectedClients = 0;
      throw error;
    }

    this.startIdleSweep();
  }

  /**
   * Bind the port, retrying for a short while on EADDRINUSE. After a plugin
   * update the old instance may still hold the port for a moment (#518);
   * failing at once would leave the server down until a manual restart.
   */
  private async listenWithRetry(server: Server): Promise<void> {
    const timeout = this.options.bindRetryTimeoutMs ?? DEFAULT_BIND_RETRY_TIMEOUT_MS;
    const delay = this.options.bindRetryDelayMs ?? DEFAULT_BIND_RETRY_DELAY_MS;
    const deadline = this.clock() + timeout;
    let warned = false;
    for (;;) {
      try {
        await this.listenOnce(server);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE') {
          throw error;
        }
        if (this.clock() + delay > deadline) {
          throw new Error(
            `Port ${String(this.options.port)} is already in use. Choose a different port in settings.`,
          );
        }
        if (!warned) {
          warned = true;
          this.logger.warn(
            `Port ${String(this.options.port)} is in use, retrying for up to ${String(timeout)}ms`,
          );
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private listenOnce(server: Server): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        this.logger.info(
          `MCP server listening on ${this.scheme}://${this.options.host}:${String(this.options.port)}`,
        );
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.options.port, this.options.host);
    });
  }

  private startIdleSweep(): void {
    const interval =
      this.options.sessionSweepIntervalMs ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS;
    if (interval <= 0) {
      return;
    }
    this.sweepTimer = setInterval(() => {
      this.sweepIdleSessions();
    }, interval);
    if (typeof this.sweepTimer.unref === 'function') {
      this.sweepTimer.unref();
    }
  }

  /**
   * Runs the idle-session sweep immediately. Exposed for unit tests — normal
   * operation relies on the periodic timer kicked off by `start()`.
   * @internal
   */
  runIdleSweepNow(): void {
    this.sweepIdleSessions();
  }

  private sweepIdleSessions(): void {
    const timeout =
      this.options.sessionIdleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS;
    if (timeout <= 0) {
      return;
    }
    const now = this.clock();
    for (const [id, session] of this.sessions) {
      const idleMs = now - session.lastActivity;
      if (idleMs > timeout) {
        this.logger.info(
          `Closing idle MCP session: ${id} (idle ${String(idleMs)}ms, timeout ${String(timeout)}ms)`,
        );
        this.removeSession(id);
      }
    }
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    corsOptions: CorsOptions,
  ): Promise<void> {
    const clientIp = normalizeIp(req.socket.remoteAddress);

    // DNS-rebind protection: validate Origin and Host before anything
    // else, including the CORS preflight. The rejection still carries
    // CORS headers so the browser can surface a clearer failure message.
    const originHostOpts = this.options.originHost ?? DEFAULT_ORIGIN_HOST_OPTIONS;
    const originHostResult = validateOriginHost(req, originHostOpts);
    if (!originHostResult.ok) {
      this.logger.warn('Request rejected: origin/host validation failed', {
        ip: clientIp,
        method: req.method ?? 'UNKNOWN',
        path: req.url ?? '/',
        origin: originHostResult.origin,
        host: originHostResult.host,
        reason: originHostResult.reason,
      });
      applyCorsHeaders(res, corsOptions);
      if (!res.headersSent) {
        sendJson(res, 403, { error: originHostResult.reason });
      }
      return;
    }

    // The Origin passed the allowlist above, so it may be echoed back.
    const allowedOrigin = requestOrigin(req);

    const path = requestPath(req.url);
    if (path !== MCP_ENDPOINT_PATH) {
      this.logger.debug(`Request to unknown path rejected: ${req.method ?? 'UNKNOWN'} ${path}`);
      applyCorsHeaders(res, corsOptions, allowedOrigin);
      sendJson(res, 404, { error: `Not found. The MCP endpoint is ${MCP_ENDPOINT_PATH}` });
      return;
    }

    if (handlePreflight(req, res, corsOptions, allowedOrigin)) {
      return;
    }

    applyCorsHeaders(res, corsOptions, allowedOrigin);

    if (this.options.authEnabled) {
      const limit = this.rateLimiter.check(clientIp);
      if (limit.blocked) {
        this.logger.warn('Authentication rate-limited', {
          ip: clientIp,
          retryAfterMs: limit.retryAfterMs,
        });
        sendRateLimitError(res, limit.retryAfterMs ?? 1000);
        return;
      }
    }

    const authResult = authenticateRequest(
      req,
      this.options.accessKey,
      this.options.authEnabled,
    );
    if (!authResult.authenticated) {
      if (this.options.authEnabled) {
        this.rateLimiter.recordFailure(clientIp);
      }
      this.logger.warn('Authentication failed', { error: authResult.error });
      sendAuthError(res, authResult.error ?? 'Authentication failed');
      return;
    }

    if (this.options.authEnabled) {
      this.rateLimiter.recordSuccess(clientIp);
    }

    this.logger.debug(`${req.method ?? 'UNKNOWN'} ${req.url ?? '/'}`);

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    const method = req.method ?? 'GET';

    try {
      if (method === 'POST') {
        await this.handlePost(req, res, sessionId);
        return;
      }

      if (sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.lastActivity = this.clock();
          await session.transport.handleRequest(req, res);
          return;
        }
      }

      sendJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error handling MCP request: ${message}`, error);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, 'Internal server error');
      }
    }
  }

  private async handlePost(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string | undefined,
  ): Promise<void> {
    let parsedBody: unknown;
    try {
      parsedBody = await readJsonBody(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJsonRpcError(res, 400, -32700, `Parse error: ${message}`);
      return;
    }

    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        sendJsonRpcError(res, 404, -32001, 'Session not found');
        return;
      }
      session.lastActivity = this.clock();
      await session.transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (!isInitializeRequest(parsedBody)) {
      sendJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided');
      return;
    }

    const session = await this.createSession();
    await session.transport.handleRequest(req, res, parsedBody);
    if (session.transport.sessionId === undefined) {
      // The initialize request was rejected (e.g. an unsupported protocol
      // version), so no session exists that could ever close this server.
      // Close it now: it holds a registry subscription (#448).
      await session.server.close();
    }
  }

  private async createSession(): Promise<Session> {
    const server = this.serverFactory();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: (): string => randomUUID(),
      onsessioninitialized: (id: string): void => {
        this.sessions.set(id, {
          transport,
          server,
          lastActivity: this.clock(),
        });
        this.logger.debug(`MCP session initialized: ${id} (active: ${String(this.sessions.size)})`);
        this.enforceSessionCap(id);
      },
      onsessionclosed: (id: string): void => {
        this.removeSession(id);
      },
    });

    transport.onclose = (): void => {
      if (transport.sessionId) {
        this.removeSession(transport.sessionId);
      }
    };

    await server.connect(transport);
    return { transport, server, lastActivity: this.clock() };
  }

  /**
   * Keep at most `maxSessions` sessions. Over the cap, close the least
   * recently active sessions (never `keepId`, the one just created). The
   * evicted client gets 404 "Session not found" on its next request, which
   * tells a spec-compliant client to initialize a new session.
   */
  private enforceSessionCap(keepId: string): void {
    const max = this.options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (max <= 0) {
      return;
    }
    while (this.sessions.size > max) {
      let oldestId: string | undefined;
      let oldestActivity = Infinity;
      for (const [id, session] of this.sessions) {
        if (id !== keepId && session.lastActivity < oldestActivity) {
          oldestId = id;
          oldestActivity = session.lastActivity;
        }
      }
      if (oldestId === undefined) {
        return;
      }
      this.logger.info(
        `Closing MCP session ${oldestId}: session limit of ${String(max)} reached`,
      );
      this.removeSession(oldestId);
    }
  }

  private removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    this.sessions.delete(id);
    this.logger.debug(`MCP session closed: ${id} (active: ${String(this.sessions.size)})`);
    void this.closeLogged('MCP server', id, () => session.server.close());
  }

  /** Run `close`; a failure is logged, never thrown. */
  private async closeLogged(
    what: string,
    id: string,
    close: () => Promise<void>,
  ): Promise<void> {
    try {
      await close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error closing ${what} for session ${id}: ${message}`, error);
    }
  }

  /**
   * Stop the server: free the port at once, close every MCP session, then
   * drop any connection still open (SSE streams, keep-alive sockets,
   * requests in flight) so the returned promise always settles. Obsidian
   * does not await `onunload`, so the port must be free before the first
   * await (#518). Concurrent calls share one stop.
   */
  stop(): Promise<void> {
    if (this.stopping) {
      return this.stopping;
    }
    if (!this.httpServer) {
      return Promise.resolve();
    }
    this.stopping = this.doStop(this.httpServer).finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  private async doStop(httpServer: Server): Promise<void> {
    this.logger.info('Stopping MCP server...');

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    // Stop listening first, synchronously: this frees the port for a new
    // plugin instance before anything below yields. The callback fires once
    // every open connection has ended.
    const closed = new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    const sessionsToClose = Array.from(this.sessions.entries());
    this.sessions.clear();
    await Promise.all(
      sessionsToClose.map(async ([id, { transport, server }]) => {
        await this.closeLogged('transport', id, () => transport.close());
        await this.closeLogged('MCP server', id, () => server.close());
      }),
    );

    // close() only ends idle connections; a stalled request or an open
    // stream would keep the promise above pending forever.
    httpServer.closeAllConnections();
    await closed;

    if (this.httpServer === httpServer) {
      this.httpServer = null;
    }
    this._connectedClients = 0;
    this.logger.info('MCP server stopped');
  }

  updateOptions(options: Partial<HttpServerOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on('error', reject);
  });
}

function sendJsonRpcError(
  res: ServerResponse,
  httpStatus: number,
  code: number,
  message: string,
): void {
  if (res.headersSent) {
    return;
  }
  sendJson(res, httpStatus, { jsonrpc: '2.0', error: { code, message }, id: null });
}
