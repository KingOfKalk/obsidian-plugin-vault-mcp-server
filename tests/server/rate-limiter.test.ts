import { describe, it, expect } from 'vitest';
import { FailureRateLimiter, normalizeIp } from '../../src/server/rate-limiter';

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

describe('normalizeIp', (): void => {
  it('strips IPv6-mapped IPv4 prefix', (): void => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
  });

  it('passes through plain IPv4 unchanged', (): void => {
    expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1');
  });

  it('passes through plain IPv6 unchanged', (): void => {
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp('fe80::1')).toBe('fe80::1');
  });

  it('falls back to "unknown" for undefined', (): void => {
    expect(normalizeIp(undefined)).toBe('unknown');
  });
});

describe('FailureRateLimiter', (): void => {
  it('does not block when under the failure threshold', (): void => {
    const clock = makeClock();
    const limiter = new FailureRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      blockMs: 30_000,
      maxEntries: 1000,
      clock: clock.now,
    });

    for (let i = 0; i < 4; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    expect(limiter.check('1.1.1.1').blocked).toBe(false);
  });

  it('blocks after 5 failures within the window', (): void => {
    const clock = makeClock();
    const limiter = new FailureRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      blockMs: 30_000,
      maxEntries: 1000,
      clock: clock.now,
    });

    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    const result = limiter.check('1.1.1.1');
    expect(result.blocked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(30_000);
  });

  it('unblocks once the block window expires', (): void => {
    const clock = makeClock();
    const limiter = new FailureRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      blockMs: 30_000,
      maxEntries: 1000,
      clock: clock.now,
    });

    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    expect(limiter.check('1.1.1.1').blocked).toBe(true);

    clock.advance(30_001);
    expect(limiter.check('1.1.1.1').blocked).toBe(false);
  });

  it('resets the counter on success', (): void => {
    const clock = makeClock();
    const limiter = new FailureRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      blockMs: 30_000,
      maxEntries: 1000,
      clock: clock.now,
    });

    for (let i = 0; i < 4; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    limiter.recordSuccess('1.1.1.1');
    // After reset, the next 4 failures should NOT trip the block.
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    expect(limiter.check('1.1.1.1').blocked).toBe(false);
  });

  it('forgets failures older than windowMs (rolling window)', (): void => {
    const clock = makeClock();
    const limiter = new FailureRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      blockMs: 30_000,
      maxEntries: 1000,
      clock: clock.now,
    });

    // 4 failures, then wait past window, then 1 more failure: should NOT block.
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    clock.advance(60_001);
    limiter.recordFailure('1.1.1.1');
    expect(limiter.check('1.1.1.1').blocked).toBe(false);
  });

  it('rate-limits per IP independently', (): void => {
    const clock = makeClock();
    const limiter = new FailureRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      blockMs: 30_000,
      maxEntries: 1000,
      clock: clock.now,
    });

    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    expect(limiter.check('1.1.1.1').blocked).toBe(true);
    expect(limiter.check('2.2.2.2').blocked).toBe(false);
  });

  it('evicts the oldest entry once maxEntries is exceeded', (): void => {
    const clock = makeClock();
    const limiter = new FailureRateLimiter({
      maxFailures: 5,
      windowMs: 60_000,
      blockMs: 30_000,
      maxEntries: 3,
      clock: clock.now,
    });

    limiter.recordFailure('a');
    limiter.recordFailure('b');
    limiter.recordFailure('c');
    expect(limiter.size).toBe(3);

    // Adding a 4th unique IP must evict the oldest ('a').
    limiter.recordFailure('d');
    expect(limiter.size).toBe(3);
    expect(limiter.has('a')).toBe(false);
    expect(limiter.has('b')).toBe(true);
    expect(limiter.has('c')).toBe(true);
    expect(limiter.has('d')).toBe(true);
  });

  it('uses sensible defaults when no config is supplied', (): void => {
    const limiter = new FailureRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.1.1.1');
    }
    expect(limiter.check('1.1.1.1').blocked).toBe(true);
  });
});
