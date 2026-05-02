/**
 * Per-IP failure rate limiter for bearer-auth attempts.
 *
 * Tracks consecutive failed authentications per remote address. After
 * `maxFailures` failures inside a `windowMs` rolling window, the IP is
 * blocked for `blockMs` milliseconds. A successful authentication clears
 * the IP's record.
 *
 * The internal table is bounded by `maxEntries`; once full, the
 * insertion-oldest entry is evicted to keep memory usage bounded under a
 * flood of unique source IPs.
 */

export interface FailureRateLimiterOptions {
  /** Maximum failures within `windowMs` before the IP is blocked. */
  maxFailures?: number;
  /** Sliding window for counting failures, in milliseconds. */
  windowMs?: number;
  /** How long to block an IP after the threshold trips, in milliseconds. */
  blockMs?: number;
  /** Maximum number of IP entries to retain; oldest are evicted past this. */
  maxEntries?: number;
  /** Clock function; defaults to `Date.now`. Injectable for tests. */
  clock?: () => number;
}

export interface CheckResult {
  blocked: boolean;
  /** Milliseconds until the block expires, only set when `blocked` is true. */
  retryAfterMs?: number;
}

interface Entry {
  /** Failure timestamps inside the rolling window. */
  failures: number[];
  /** Absolute timestamp at which the block lifts; 0 when not blocked. */
  blockedUntil: number;
}

const DEFAULTS = {
  maxFailures: 5,
  windowMs: 60_000,
  blockMs: 30_000,
  maxEntries: 1000,
} as const;

export class FailureRateLimiter {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly blockMs: number;
  private readonly maxEntries: number;
  private readonly clock: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: FailureRateLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? DEFAULTS.maxFailures;
    this.windowMs = options.windowMs ?? DEFAULTS.windowMs;
    this.blockMs = options.blockMs ?? DEFAULTS.blockMs;
    this.maxEntries = options.maxEntries ?? DEFAULTS.maxEntries;
    this.clock = options.clock ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  has(ip: string): boolean {
    return this.entries.has(ip);
  }

  check(ip: string): CheckResult {
    const entry = this.entries.get(ip);
    if (!entry) {
      return { blocked: false };
    }
    const now = this.clock();
    if (entry.blockedUntil > now) {
      return { blocked: true, retryAfterMs: entry.blockedUntil - now };
    }
    return { blocked: false };
  }

  recordFailure(ip: string): void {
    const now = this.clock();
    let entry = this.entries.get(ip);
    if (!entry) {
      this.evictIfNeeded();
      entry = { failures: [], blockedUntil: 0 };
      this.entries.set(ip, entry);
    }

    // Drop failures that fell out of the rolling window.
    const cutoff = now - this.windowMs;
    while (entry.failures.length > 0 && entry.failures[0] <= cutoff) {
      entry.failures.shift();
    }

    entry.failures.push(now);

    if (entry.failures.length >= this.maxFailures) {
      entry.blockedUntil = now + this.blockMs;
    }
  }

  recordSuccess(ip: string): void {
    this.entries.delete(ip);
  }

  private evictIfNeeded(): void {
    if (this.entries.size < this.maxEntries) {
      return;
    }
    // Map preserves insertion order; the first key is the oldest entry.
    const oldest = this.entries.keys().next();
    if (!oldest.done) {
      this.entries.delete(oldest.value);
    }
  }
}

/**
 * Normalize a peer-socket remote address so the limiter treats logical
 * IPs as a single key. Strips the IPv6-mapped-IPv4 prefix `::ffff:` and
 * falls back to a stable `"unknown"` token when the address is missing.
 */
export function normalizeIp(addr: string | undefined): string {
  if (!addr) {
    return 'unknown';
  }
  if (addr.startsWith('::ffff:')) {
    return addr.slice('::ffff:'.length);
  }
  return addr;
}
