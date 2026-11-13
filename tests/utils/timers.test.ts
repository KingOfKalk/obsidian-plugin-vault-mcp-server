import { describe, it, expect, vi, afterEach } from 'vitest';
import { sleep, startInterval } from '../../src/utils/timers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('timers (#557)', () => {
  describe('in Obsidian (a window exists)', () => {
    it('startInterval uses window.setInterval and stops with window.clearInterval', () => {
      const setInterval = vi.fn(() => 42);
      const clearInterval = vi.fn();
      vi.stubGlobal('window', { setInterval, clearInterval });
      const callback = vi.fn();

      const stop = startInterval(callback, 250);
      expect(setInterval).toHaveBeenCalledWith(callback, 250);
      expect(clearInterval).not.toHaveBeenCalled();

      stop();
      expect(clearInterval).toHaveBeenCalledWith(42);
    });

    it('sleep uses window.setTimeout', async () => {
      const setTimeout = vi.fn((resolve: () => void) => {
        resolve();
        return 1;
      });
      vi.stubGlobal('window', { setTimeout });

      await sleep(100);
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 100);
    });

    it('works with fake timers through a stubbed window', () => {
      vi.useFakeTimers();
      vi.stubGlobal('window', globalThis);
      const callback = vi.fn();

      const stop = startInterval(callback, 1000);
      vi.advanceTimersByTime(3000);
      expect(callback).toHaveBeenCalledTimes(3);

      stop();
      vi.advanceTimersByTime(3000);
      expect(callback).toHaveBeenCalledTimes(3);
    });
  });

  describe('outside Obsidian (no window)', () => {
    it('has no window in the unit tests', () => {
      expect(typeof window).toBe('undefined');
    });

    it('startInterval falls back to Node timers and stops', async () => {
      const callback = vi.fn();
      const stop = startInterval(callback, 5);
      await sleep(40);
      stop();
      const calls = callback.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      await sleep(30);
      expect(callback).toHaveBeenCalledTimes(calls);
    });

    it('startInterval with unref does not keep the process alive but still fires', async () => {
      const callback = vi.fn();
      const stop = startInterval(callback, 5, { unref: true });
      await sleep(40);
      stop();
      expect(callback).toHaveBeenCalled();
    });

    it('sleep resolves after the delay', async () => {
      const start = Date.now();
      await sleep(20);
      expect(Date.now() - start).toBeGreaterThanOrEqual(15);
    });
  });
});
