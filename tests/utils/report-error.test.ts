import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as obsidian from 'obsidian';
import { Logger } from '../../src/utils/logger';
import { reportError } from '../../src/utils/report-error';

describe('reportError', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.restoreAllMocks();
    logger = new Logger('test', { debugMode: true, accessKey: '' });
  });

  it('returns a function that logs at error level with the scope prefix', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const handler = reportError('start server', logger);
    const err = new Error('EADDRINUSE');

    handler(err);

    expect(errorSpy).toHaveBeenCalledWith('start server: EADDRINUSE', err);
  });

  it('surfaces a Notice on rejection', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const noticeSpy = vi.spyOn(obsidian, 'Notice');

    const handler = reportError('copy access key', logger);
    handler(new Error('clipboard denied'));

    expect(noticeSpy).toHaveBeenCalledWith(
      'Obsidian MCP: copy access key failed — see console',
    );
  });

  it('coerces non-Error values to a string message', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const handler = reportError('save settings', logger);

    handler('oops');

    expect(errorSpy).toHaveBeenCalledWith('save settings: oops', 'oops');
  });

  it('can be attached as .catch on a real rejected promise chain', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const noticeSpy = vi.spyOn(obsidian, 'Notice');
    const handler = reportError('demo', logger);

    await Promise.reject(new Error('boom')).catch(handler);

    expect(errorSpy).toHaveBeenCalledWith('demo: boom', expect.any(Error));
    expect(noticeSpy).toHaveBeenCalledTimes(1);
  });
});
