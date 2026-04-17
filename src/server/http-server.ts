import { createServer as createHttpServer, IncomingMessage, Server, ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../utils/logger';
import { authenticateRequest, sendAuthError } from './auth';
import { applyCorsHeaders, handlePreflight, CorsOptions, DEFAULT_CORS_OPTIONS } from './cors';

export interface HttpServerOptions {
  host: string;
  port: number;
  accessKey: string;
  corsOptions?: CorsOptions;
  /** When provided, the server uses HTTPS with these PEM-encoded credentials. */
  tls?: { cert: string; key: string };
}

export type McpServerFactory = () => McpServer;

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export class HttpMcpServer {
  private httpServer: Server | null = null;
  private logger: Logger;
  private serverFactory: McpServerFactory;
  private options: HttpServerOptions;
  private _connectedClients = 0;
  private sessions = new Map<string, Session>();

  constructor(serverFactory: McpServerFactory, logger: Logger, options: HttpServerOptions) {
    this.serverFactory = serverFactory;
    this.logger = logger;
    this.options = options;
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
      void this.handleRequest(req, res, corsOptions);
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

    const authResult = authenticateRequest(req, this.options.accessKey);
    if (!authResult.authenticated) {
      this.logger.warn('Authentication failed', { error: authResult.error });
      sendAuthError(res, authResult.error ?? 'Authentication failed');
      return;
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
        this.sessions.set(id, { transport, server });
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
    return { transport, server };
  }

  private removeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    this.sessions.delete(id);
    this.logger.debug(`MCP session closed: ${id} (active: ${String(this.sessions.size)})`);
    void session.server.close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error closing MCP server for session ${id}: ${message}`);
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    this.logger.info('Stopping MCP server...');

    const sessionsToClose = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.all(
      sessionsToClose.map(async ({ transport, server }) => {
        try {
          await transport.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Error closing transport: ${message}`);
        }
        try {
          await server.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Error closing MCP server: ${message}`);
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
