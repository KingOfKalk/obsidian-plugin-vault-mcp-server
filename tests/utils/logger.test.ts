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
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.debug('test debug message');
      expect(spy).toHaveBeenCalledTimes(1);
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.level).toBe('debug');
      expect(entry.module).toBe('test-module');
      expect(entry.message).toBe('test debug message');
    });

    it('should log info messages', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('timestamp test');
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(() => new Date(entry.timestamp)).not.toThrow();
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include optional data when provided', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('with data', { foo: 'bar' });
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.data).toEqual({ foo: 'bar' });
    });

    it('should not include data key when data is not provided', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.debug('this should not appear');
      expect(spy).not.toHaveBeenCalled();
    });

    it('should still log info messages', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
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

  describe('access key redaction', () => {
    beforeEach(() => {
      logger = createLogger('test-module', { debugMode: true, accessKey });
    });

    it('should redact access key in message strings', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info(`Authorization header: Bearer ${accessKey}`);
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.message).not.toContain(accessKey);
      expect(entry.message).toContain('[REDACTED]');
    });

    it('should redact access key in data strings', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('request', { header: `Bearer ${accessKey}` });
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      const data = entry.data as Record<string, string>;
      expect(data.header).not.toContain(accessKey);
      expect(data.header).toContain('[REDACTED]');
    });

    it('should redact access key in nested data objects', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('nested', { req: { auth: accessKey } });
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      const data = entry.data as Record<string, Record<string, string>>;
      expect(data.req.auth).toBe('[REDACTED]');
    });

    it('should redact access key in arrays', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('array', [accessKey, 'safe']);
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      const data = entry.data as string[];
      expect(data[0]).toBe('[REDACTED]');
      expect(data[1]).toBe('safe');
    });

    it('should not redact when access key is empty', () => {
      const emptyLogger = createLogger('test', { debugMode: true, accessKey: '' });
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      emptyLogger.info('no redaction needed');
      const entry: LogEntry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.message).toBe('no redaction needed');
    });

    it('should handle non-string, non-object data without redaction', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.info('number data', 42);
      const entry = JSON.parse(spy.mock.calls[0][0] as string) as LogEntry;
      expect(entry.data).toBe(42);
    });
  });

  describe('updateOptions', () => {
    it('should update debug mode dynamically', () => {
      logger = createLogger('test', { debugMode: false, accessKey: '' });
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.debug('suppressed');
      expect(spy).not.toHaveBeenCalled();

      logger.updateOptions({ debugMode: true });
      logger.debug('visible');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
