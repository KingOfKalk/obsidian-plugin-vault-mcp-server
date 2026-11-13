import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { AVAILABILITY_POLL_MS, startAvailabilityPolling } from '../../src/registry/availability';
import { Logger } from '../../src/utils/logger';

class QuietLogger extends Logger {
  override debug(): void {}
  override info(): void {}
}

/**
 * Fake timers on a stubbed `window`: the polling uses the window's timers
 * in Obsidian (#557), and Vitest does not fake the `node:timers` fallback.
 */
function useFakeWindowTimers(): void {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('startAvailabilityPolling (#469)', () => {
  it('checks once right away and then every interval until stopped', () => {
    useFakeWindowTimers();
    const registry = new ModuleRegistry(new QuietLogger('test', { debugMode: false, accessKey: '' }));
    const refresh = vi.spyOn(registry, 'refreshAvailability');

    const stop = startAvailabilityPolling(registry, 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('defaults to a few seconds', () => {
    useFakeWindowTimers();
    const registry = new ModuleRegistry(new QuietLogger('test', { debugMode: false, accessKey: '' }));
    const refresh = vi.spyOn(registry, 'refreshAvailability');
    const stop = startAvailabilityPolling(registry);
    vi.advanceTimersByTime(AVAILABILITY_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(AVAILABILITY_POLL_MS).toBeLessThanOrEqual(10_000);
    stop();
  });
});
