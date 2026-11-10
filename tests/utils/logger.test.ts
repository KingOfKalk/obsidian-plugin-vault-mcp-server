import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger, createLogger, LogEntry } from '../../src/utils/logger';

describe('Logger', () => {
  let logger: Logger;
  const accessKey = 'secret-key-12345';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('with debug mode enabled', () => {
    beforeEach(() => {
      logger = createLogger('test-module', { debugMode: true, accessKey });
    });

    it('should log debug messages when debug mode is on', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.debug('test debug message');
      expect(spy).toHaveBeenCalledTimes(1);
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.level).toBe('debug');
      expect(entry.module).toBe('test-module');
      expect(entry.message).toBe('test debug message');
    });

    it('should log info messages', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('test info');
      expect(spy).toHaveBeenCalledTimes(1);
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.level).toBe('info');
    });

    it('should log warn messages', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('test warning');
      expect(spy).toHaveBeenCalledTimes(1);
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.level).toBe('warn');
    });

    it('should log error messages', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('test error');
      expect(spy).toHaveBeenCalledTimes(1);
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.level).toBe('error');
    });

    it('should include a timestamp in ISO format', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('timestamp test');
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(() => new Date(entry.timestamp)).not.toThrow();
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include optional data when provided', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('with data', { foo: 'bar' });
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.data).toEqual({ foo: 'bar' });
    });

    it('should not include data key when data is not provided', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('no data');
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry).not.toHaveProperty('data');
    });
  });

  describe('with debug mode disabled', () => {
    beforeEach(() => {
      logger = createLogger('test-module', { debugMode: false, accessKey });
    });

    it('should suppress debug messages', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.debug('this should not appear');
      expect(spy).not.toHaveBeenCalled();
    });

    it('should still log info messages', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('this should appear');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should still log warn messages', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('this should appear');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should still log error messages', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('this should appear');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('stdio transport compatibility', () => {
    it('routes debug and info to console.error, never console.log', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const l = createLogger('m', { debugMode: true, accessKey: '' });
      l.debug('d');
      l.info('i');
      l.warn('w');
      l.error('e');

      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledTimes(3); // debug + info + error
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('access key redaction', () => {
    beforeEach(() => {
      logger = createLogger('test-module', { debugMode: true, accessKey });
    });

    it('should redact access key in message strings', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info(`Authorization header: Bearer ${accessKey}`);
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.message).not.toContain(accessKey);
      expect(entry.message).toContain('[REDACTED]');
    });

    it('should redact access key in data strings', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('request', { header: `Bearer ${accessKey}` });
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      const data = entry.data as Record<string, string>;
      expect(data.header).not.toContain(accessKey);
      expect(data.header).toContain('[REDACTED]');
    });

    it('should redact access key in nested data objects', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('nested', { req: { auth: accessKey } });
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      const data = entry.data as Record<string, Record<string, string>>;
      expect(data.req.auth).toBe('[REDACTED]');
    });

    it('should redact access key in arrays', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('array', [accessKey, 'safe']);
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      const data = entry.data as string[];
      expect(data[0]).toBe('[REDACTED]');
      expect(data[1]).toBe('safe');
    });

    it('should not redact when access key is empty', () => {
      const emptyLogger = createLogger('test', { debugMode: true, accessKey: '' });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      emptyLogger.info('no redaction needed');
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.message).toBe('no redaction needed');
    });

    it('should handle non-string, non-object data without redaction', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.info('number data', 42);
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.data).toBe(42);
    });
  });

  describe('Error data (#542)', () => {
    function logData(data: unknown, key = accessKey): unknown {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      createLogger('m', { debugMode: true, accessKey: key }).error('failed', data);
      const line = spy.mock.calls[spy.mock.calls.length - 1][0] as string;
      const entry = JSON.parse(line) as LogEntry;
      return entry.data;
    }

    it('keeps name, message and stack of a raw Error', () => {
      const err = new TypeError('boom');
      expect(logData(err)).toEqual({
        name: 'TypeError',
        message: 'boom',
        stack: err.stack,
      });
    });

    it('keeps enumerable own props such as code', () => {
      const err = Object.assign(new Error('in use'), { code: 'EADDRINUSE', port: 28741 });
      expect(logData(err)).toMatchObject({
        name: 'Error',
        message: 'in use',
        code: 'EADDRINUSE',
        port: 28741,
      });
    });

    it('includes a nested cause chain', () => {
      const root = new RangeError('root');
      const mid = new Error('mid', { cause: root });
      const top = new Error('top', { cause: mid });
      const data = logData(top) as Record<string, Record<string, Record<string, unknown>>>;
      expect(data.message).toBe('top');
      expect(data.cause.message).toBe('mid');
      expect(data.cause.cause).toEqual({
        name: 'RangeError',
        message: 'root',
        stack: root.stack,
      });
    });

    it('serialises a non-Error cause through the normal path', () => {
      const err = new Error('top', { cause: { reason: 'timeout' } });
      expect(logData(err)).toMatchObject({ cause: { reason: 'timeout' } });
    });

    it('serialises an Error nested inside a data object', () => {
      const err = new Error('inner');
      expect(logData({ error: err, attempt: 2 })).toEqual({
        error: { name: 'Error', message: 'inner', stack: err.stack },
        attempt: 2,
      });
    });

    it('redacts the access key in message, stack and props', () => {
      const err = Object.assign(new Error(`bad key ${accessKey}`), {
        header: `Bearer ${accessKey}`,
      });
      const data = logData(err) as Record<string, string>;
      expect(JSON.stringify(data)).not.toContain(accessKey);
      expect(data.message).toBe('bad key [REDACTED]');
      expect(data.stack).toContain('bad key [REDACTED]');
      expect(data.header).toBe('Bearer [REDACTED]');
    });

    it('redacts the access key in the sink line too', () => {
      const sink = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      createLogger('m', { debugMode: false, accessKey: 'sekrit', sink }).error(
        'failed',
        new Error('sekrit leaked', { cause: new Error('again sekrit') }),
      );
      const line = sink.mock.calls[0][0] as string;
      expect(line).not.toContain('sekrit');
      expect(line).toContain('[REDACTED] leaked');
    });

    it('does not hang or throw on a circular cause', () => {
      const a = new Error('a');
      const b = new Error('b', { cause: a });
      Object.defineProperty(a, 'cause', { value: b, enumerable: false });
      const data = logData(a) as Record<string, Record<string, unknown>>;
      expect(data.message).toBe('a');
      expect(data.cause.message).toBe('b');
      expect(data.cause.cause).toBe('[Circular]');
    });

    it('does not throw on an Error that references itself via a prop', () => {
      const err = new Error('self') as Error & { self?: unknown };
      err.self = err;
      const data = logData(err) as Record<string, unknown>;
      expect(data.message).toBe('self');
      expect(data.self).toBe('[Circular]');
    });

    it('caps a very deep cause chain', () => {
      let err = new Error('e0');
      for (let i = 1; i <= 50; i++) err = new Error(`e${String(i)}`, { cause: err });
      let node = logData(err) as Record<string, unknown> | string;
      let depth = 0;
      while (typeof node === 'object' && 'cause' in node) {
        node = node.cause as Record<string, unknown> | string;
        depth++;
      }
      expect(depth).toBeLessThan(50);
      expect(node).toBe('[Truncated]');
    });

    it('serialises non-Error data exactly as before', () => {
      const shared = { k: 'v' };
      const data = {
        s: `x ${accessKey}`,
        n: 1,
        b: true,
        nil: null,
        arr: [shared, shared, [accessKey]],
        nested: { a: { b: shared } },
      };
      expect(logData(data)).toEqual({
        s: 'x [REDACTED]',
        n: 1,
        b: true,
        nil: null,
        arr: [{ k: 'v' }, { k: 'v' }, ['[REDACTED]']],
        nested: { a: { b: { k: 'v' } } },
      });
      expect(logData('plain string')).toBe('plain string');
      expect(logData(42)).toBe(42);
    });
  });

  describe('updateOptions', () => {
    it('should update debug mode dynamically', () => {
      logger = createLogger('test', { debugMode: false, accessKey: '' });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.debug('suppressed');
      expect(spy).not.toHaveBeenCalled();

      logger.updateOptions({ debugMode: true });
      logger.debug('visible');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('sink', () => {
    it('invokes the sink once per emitted line at info level', () => {
      const sink = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = createLogger('m', { debugMode: false, accessKey: '', sink });
      l.info('first');
      l.info('second');
      expect(sink).toHaveBeenCalledTimes(2);
    });

    it('invokes the sink for warn and error too', () => {
      const sink = vi.fn();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = createLogger('m', { debugMode: false, accessKey: '', sink });
      l.warn('w');
      l.error('e');
      expect(sink).toHaveBeenCalledTimes(2);
    });

    it('does not invoke the sink for messages filtered by level', () => {
      const sink = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = createLogger('m', { debugMode: false, accessKey: '', sink });
      l.debug('suppressed');
      expect(sink).not.toHaveBeenCalled();
    });

    it('formats sink lines as human-readable plain text', () => {
      const sink = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = createLogger('http-server', {
        debugMode: false,
        accessKey: '',
        sink,
      });
      l.info('listening', { port: 28741 });
      const line = sink.mock.calls[0][0] as string;
      expect(line).toMatch(
        /^\d{4}-\d{2}-\d{2}T[^\s]+Z\s+INFO\s+\[http-server\] listening \{"port":28741\}$/,
      );
    });

    it('redacts the access key in sink output', () => {
      const sink = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = createLogger('m', {
        debugMode: false,
        accessKey: 'sekrit',
        sink,
      });
      l.info('Bearer sekrit');
      const line = sink.mock.calls[0][0] as string;
      expect(line).not.toContain('sekrit');
      expect(line).toContain('[REDACTED]');
    });

    it('swallows sink errors so logging never throws', () => {
      const sink = vi.fn(() => {
        throw new Error('disk full');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const l = createLogger('m', { debugMode: false, accessKey: '', sink });
      expect(() => l.info('x')).not.toThrow();
    });
  });
});
