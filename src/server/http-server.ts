import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Logger } from '../utils/logger';
import { authenticateRequest, sendAuthError } from './auth';
import { applyCorsHeaders, handlePreflight, CorsOptions, DEFAULT_CORS_OPTIONS } from './cors';

export interface HttpServerOptions {
  port: number;
  accessKey: string;
  corsOptions?: CorsOptions;
}

export class HttpMcpServer {
  private httpServer: Server | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private logger: Logger;
  private mcpServer: McpServer;
  private options: HttpServerOptions;
  private _connectedClients = 0;

  constructor(mcpServer: McpServer, logger: Logger, options: HttpServerOptions) {
    this.mcpServer = mcpServer;
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

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Server is already running');
      return;
    }

    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await this.mcpServer.connect(this.transport);

    const corsOptions = this.options.corsOptions ?? DEFAULT_CORS_OPTIONS;

    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse): void => {
      // CORS preflight
      if (handlePreflight(req, res, corsOptions)) {
        return;
      }

      // Apply CORS headers to all responses
      applyCorsHeaders(res, corsOptions);

      // Authenticate
      const authResult = authenticateRequest(req, this.options.accessKey);
      if (!authResult.authenticated) {
        this.logger.warn('Authentication failed', { error: authResult.error });
        sendAuthError(res, authResult.error ?? 'Authentication failed');
        return;
      }

      // Log request in debug mode
      this.logger.debug(`${req.method ?? 'UNKNOWN'} ${req.url ?? '/'}`);

      // Delegate to MCP transport
      void this.transport!.handleRequest(req, res);
    });

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

      this.httpServer!.listen(this.options.port, '127.0.0.1', () => {
        this.logger.info(`MCP server listening on http://127.0.0.1:${String(this.options.port)}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    this.logger.info('Stopping MCP server...');

    await this.mcpServer.close();

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
    this.transport = null;
    this._connectedClients = 0;
    this.logger.info('MCP server stopped');
  }

  updateOptions(options: Partial<HttpServerOptions>): void {
    this.options = { ...this.options, ...options };
  }
}
