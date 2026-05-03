import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { Logger, LogLevel } from '../utils/logger';

export type SdkExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type McpLogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

export interface ToolContext {
  /** Aborted if the client cancelled or the transport closed. */
  signal: AbortSignal;
  /** Present iff the caller passed _meta.progressToken. */
  progressToken: string | number | undefined;
  /** No-op when progressToken is undefined. */
  reportProgress(
    progress: number,
    total?: number,
    message?: string,
  ): Promise<void>;
  /** Fan-out: project Logger AND notifications/message. */
  log(level: McpLogLevel, message: string, data?: unknown): Promise<void>;
}

const MCP_TO_PROJECT_LEVEL: Record<McpLogLevel, LogLevel> = {
  debug: 'debug',
  info: 'info',
  notice: 'info',
  warning: 'warn',
  error: 'error',
  critical: 'error',
  alert: 'error',
  emergency: 'error',
};

export function createToolContext(
  extra: SdkExtra,
  toolName: string,
  logger: Logger,
): ToolContext {
  const progressToken = extra._meta?.progressToken;

  return {
    signal: extra.signal,
    progressToken,

    async reportProgress(
      progress: number,
      total?: number,
      message?: string,
    ): Promise<void> {
      if (progressToken === undefined) return;
      try {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress, total, message },
        });
      } catch (err) {
        logger.warn('reportProgress failed', err);
      }
    },

    async log(
      level: McpLogLevel,
      message: string,
      data?: unknown,
    ): Promise<void> {
      const projectLevel = MCP_TO_PROJECT_LEVEL[level];
      logger[projectLevel](message, data);

      const payload =
        data === undefined ? { msg: message } : { msg: message, data };
      try {
        await extra.sendNotification({
          method: 'notifications/message',
          params: { level, logger: toolName, data: payload },
        });
      } catch (err) {
        logger.warn('ctx.log sendNotification failed', err);
      }
    },
  };
}
