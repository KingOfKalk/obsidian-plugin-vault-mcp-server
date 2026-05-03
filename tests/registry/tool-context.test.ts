import { describe, it, expect, vi } from 'vitest';
import { Logger } from '../../src/utils/logger';
import { createToolContext, type SdkExtra } from '../../src/registry/tool-context';

function makeLogger(): {
  logger: Logger;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const logger = new Logger('test', { debugMode: true, accessKey: '' });
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  logger.debug = debug;
  logger.info = info;
  logger.warn = warn;
  logger.error = error;
  return { logger, debug, info, warn, error };
}

function makeExtra(overrides: Partial<SdkExtra> = {}): SdkExtra {
  const sendNotification = vi.fn().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification,
    sendRequest: vi.fn(),
    ...overrides,
  } as unknown as SdkExtra;
}

describe('createToolContext', () => {
  it('surfaces signal verbatim from extra', () => {
    const ac = new AbortController();
    const { logger } = makeLogger();
    const ctx = createToolContext(makeExtra({ signal: ac.signal }), 'tool_x', logger);
    expect(ctx.signal).toBe(ac.signal);
  });

  it('lifts progressToken from extra._meta', () => {
    const { logger } = makeLogger();
    const ctx = createToolContext(
      makeExtra({ _meta: { progressToken: 'tok-42' } }),
      'tool_x',
      logger,
    );
    expect(ctx.progressToken).toBe('tok-42');
  });

  it('progressToken is undefined when _meta is absent', () => {
    const { logger } = makeLogger();
    const ctx = createToolContext(makeExtra(), 'tool_x', logger);
    expect(ctx.progressToken).toBeUndefined();
  });

  describe('reportProgress', () => {
    it('is a no-op when progressToken is undefined', async () => {
      const extra = makeExtra();
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.reportProgress(5, 10, 'halfway');

      expect(extra.sendNotification).not.toHaveBeenCalled();
    });

    it('emits notifications/progress with the correct params shape when progressToken is set', async () => {
      const extra = makeExtra({ _meta: { progressToken: 7 } });
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.reportProgress(3, 9, 'step 3');

      expect(extra.sendNotification).toHaveBeenCalledTimes(1);
      expect(extra.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: { progressToken: 7, progress: 3, total: 9, message: 'step 3' },
      });
    });

    it('swallows sendNotification errors and warns via logger', async () => {
      const sendNotification = vi.fn().mockRejectedValue(new Error('socket gone'));
      const extra = makeExtra({
        _meta: { progressToken: 1 },
        sendNotification,
      });
      const { logger, warn } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await expect(ctx.reportProgress(1, 1)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('log', () => {
    it('fans out to logger.info AND sendNotification with notifications/message', async () => {
      const extra = makeExtra();
      const { logger, info } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.log('info', 'hello', { count: 1 });

      expect(info).toHaveBeenCalledWith('hello', { count: 1 });
      expect(extra.sendNotification).toHaveBeenCalledTimes(1);
      expect(extra.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'tool_x',
          data: { msg: 'hello', data: { count: 1 } },
        },
      });
    });

    it('omits the data field in the notification payload when handler did not pass data', async () => {
      const extra = makeExtra();
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.log('info', 'hello');

      expect(extra.sendNotification).toHaveBeenCalledWith({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'tool_x',
          data: { msg: 'hello' },
        },
      });
    });

    it('maps the 8 MCP levels to the 4 project levels', async () => {
      const cases: Array<{
        mcp:
          | 'debug'
          | 'info'
          | 'notice'
          | 'warning'
          | 'error'
          | 'critical'
          | 'alert'
          | 'emergency';
        project: 'debug' | 'info' | 'warn' | 'error';
      }> = [
        { mcp: 'debug', project: 'debug' },
        { mcp: 'info', project: 'info' },
        { mcp: 'notice', project: 'info' },
        { mcp: 'warning', project: 'warn' },
        { mcp: 'error', project: 'error' },
        { mcp: 'critical', project: 'error' },
        { mcp: 'alert', project: 'error' },
        { mcp: 'emergency', project: 'error' },
      ];

      for (const { mcp, project } of cases) {
        const extra = makeExtra();
        const { logger, debug, info, warn, error } = makeLogger();
        const ctx = createToolContext(extra, 'tool_x', logger);

        await ctx.log(mcp, 'msg');

        const callMap = { debug, info, warn, error };
        expect(callMap[project]).toHaveBeenCalledTimes(1);
        for (const other of ['debug', 'info', 'warn', 'error'] as const) {
          if (other !== project) {
            expect(callMap[other]).not.toHaveBeenCalled();
          }
        }
      }
    });

    it('swallows sendNotification errors and warns via logger', async () => {
      const sendNotification = vi.fn().mockRejectedValue(new Error('socket gone'));
      const extra = makeExtra({ sendNotification });
      const { logger, warn } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await expect(ctx.log('info', 'hello')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
