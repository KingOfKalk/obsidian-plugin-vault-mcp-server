import { createServer as createHttpServer, IncomingMessage, Server, ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../utils/logger';
import { authenticateRequest, sendAuthError, sendRateLimitError } from './auth';
import { applyCorsHeaders, handlePreflight, CorsOptions, DEFAULT_CORS_OPTIONS } from './cors';
import { FailureRateLimiter, normalizeIp } from './rate-limiter';

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
}

export type McpServerFactory = () => McpServer;

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

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

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${String(this.options.port)} is already in use. Choose a different port in settings.`));
        } else {
          reject(error);
        }
      });

      this.httpServer!.listen(this.options.port, this.options.host, () => {
        this.logger.info(
          `MCP server listening on ${this.scheme}://${this.options.host}:${String(this.options.port)}`,
        );
        resolve();
      });
    });

    this.startIdleSweep();
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
    if (handlePreflight(req, res, corsOptions)) {
      return;
    }

    applyCorsHeaders(res, corsOptions);

    const clientIp = normalizeIp(req.socket.remoteAddress);

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
      this.logger.error(`Error handling MCP request: ${message}`);
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
  }

  private async createSession(): Promise<Session> {
    const server = this.serverFactory();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: (): string => randomUUID(),
      onsessioninitialized: (id: string): void => {
        this.sessions.set(id, {
          transport,
          server,
          lastActivity: this.clock(),
        });
        this.logger.debug(`MCP session initialized: ${id} (active: ${String(this.sessions.size)})`);
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

  private removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    this.sessions.delete(id);
    this.logger.debug(`MCP session closed: ${id} (active: ${String(this.sessions.size)})`);
    session.server.close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error closing MCP server for session ${id}: ${message}`,
        error,
      );
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    this.logger.info('Stopping MCP server...');

    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    const sessionsToClose = Array.from(this.sessions.entries());
    this.sessions.clear();
    await Promise.all(
      sessionsToClose.map(async ([id, { transport, server }]) => {
        try {
          await transport.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Error closing transport for session ${id}: ${message}`,
            error,
          );
        }
        try {
          await server.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Error closing MCP server for session ${id}: ${message}`,
            error,
          );
        }
      }),
    );

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    this.httpServer = null;
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
  res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
  );
}
