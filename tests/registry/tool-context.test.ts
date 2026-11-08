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

interface FakeExtraOptions {
  signal?: AbortSignal;
  _meta?: { progressToken?: string | number };
  notify?: ReturnType<typeof vi.fn>;
}

interface FakeExtra {
  extra: SdkExtra;
  notify: ReturnType<typeof vi.fn>;
}

function makeExtra(overrides: FakeExtraOptions = {}): FakeExtra {
  const notify = overrides.notify ?? vi.fn().mockResolvedValue(undefined);
  const fake = {
    mcpReq: {
      id: 1,
      method: 'tools/call',
      signal: overrides.signal ?? new AbortController().signal,
      _meta: overrides._meta,
      notify,
      send: vi.fn(),
    },
  };
  // vi.fn()'s default loose signature does not structurally satisfy
  // ServerContext's typed send/notify members.
  return { extra: fake as unknown as SdkExtra, notify };
}

describe('createToolContext', () => {
  it('surfaces signal verbatim from extra', () => {
    const ac = new AbortController();
    const { logger } = makeLogger();
    const ctx = createToolContext(makeExtra({ signal: ac.signal }).extra, 'tool_x', logger);
    expect(ctx.signal).toBe(ac.signal);
  });

  it('lifts progressToken from extra._meta', () => {
    const { logger } = makeLogger();
    const ctx = createToolContext(
      makeExtra({ _meta: { progressToken: 'tok-42' } }).extra,
      'tool_x',
      logger,
    );
    expect(ctx.progressToken).toBe('tok-42');
  });

  it('progressToken is undefined when _meta is absent', () => {
    const { logger } = makeLogger();
    const ctx = createToolContext(makeExtra().extra, 'tool_x', logger);
    expect(ctx.progressToken).toBeUndefined();
  });

  describe('reportProgress', () => {
    it('is a no-op when progressToken is undefined', async () => {
      const { extra, notify } = makeExtra();
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.reportProgress(5, 10, 'halfway');

      expect(notify).not.toHaveBeenCalled();
    });

    it('emits notifications/progress with the correct params shape when progressToken is set', async () => {
      const { extra, notify } = makeExtra({ _meta: { progressToken: 7 } });
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.reportProgress(3, 9, 'step 3');

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith({
        method: 'notifications/progress',
        params: { progressToken: 7, progress: 3, total: 9, message: 'step 3' },
      });
    });

    it('swallows notify errors and warns via logger', async () => {
      const failingNotify = vi.fn().mockRejectedValue(new Error('socket gone'));
      const { extra } = makeExtra({
        _meta: { progressToken: 1 },
        notify: failingNotify,
      });
      const { logger, warn } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await expect(ctx.reportProgress(1, 1)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('log', () => {
    it('fans out to logger.info AND notify with notifications/message', async () => {
      const { extra, notify } = makeExtra();
      const { logger, info } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.log('info', 'hello', { count: 1 });

      expect(info).toHaveBeenCalledWith('hello', { count: 1 });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'tool_x',
          data: { msg: 'hello', data: { count: 1 } },
        },
      });
    });

    it('omits the data field in the notification payload when handler did not pass data', async () => {
      const { extra, notify } = makeExtra();
      const { logger } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await ctx.log('info', 'hello');

      expect(notify).toHaveBeenCalledWith({
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
        const { extra } = makeExtra();
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

    it('swallows notify errors and warns via logger', async () => {
      const failingNotify = vi.fn().mockRejectedValue(new Error('socket gone'));
      const { extra } = makeExtra({ notify: failingNotify });
      const { logger, warn } = makeLogger();
      const ctx = createToolContext(extra, 'tool_x', logger);

      await expect(ctx.log('info', 'hello')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
