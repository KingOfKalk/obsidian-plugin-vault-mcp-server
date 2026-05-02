# Plan: timing-safe bearer compare + rate-limit failures (Issue #245)

## Goal

Eliminate the timing-attack surface in `authenticateRequest` and stop
brute-force attempts on the bearer token by adding a per-IP failure
rate limiter.

## Approach

### 1. Constant-time token comparison (`src/server/auth.ts`)

- Replace `token !== accessKey` with a constant-time compare.
- Algorithm:
  1. Allocate two equal-length buffers (length = `max(token.length, accessKey.length)`)
     filled from the UTF-8 bytes of each input (zero-padded).
  2. Always run `crypto.timingSafeEqual` on those buffers — never
     short-circuit on length mismatch, because branching on length
     leaks information.
  3. AND the `timingSafeEqual` result with `token.length === accessKey.length`.
- This means the costly compare runs whether or not the lengths match,
  so an attacker cannot distinguish "wrong length" from "wrong content"
  by timing.

### 2. Per-IP failure rate limiter (new `src/server/rate-limiter.ts`)

- New class `FailureRateLimiter` with config:
  - `maxFailures` (default 5)
  - `windowMs` (default 60_000)
  - `blockMs` (default 30_000)
  - `maxEntries` (default 1000) — bound table size
  - `clock` — injectable `() => number`, defaults to `Date.now`
- Methods:
  - `check(ip)` → `{ blocked: boolean; retryAfterMs?: number }`
    - If currently in block window for this IP → blocked.
    - Otherwise → not blocked.
  - `recordFailure(ip)` → updates the rolling failure window.
    - When failure count within window reaches `maxFailures`, set
      `blockedUntil = now + blockMs`.
    - Drops failures older than `windowMs` so the counter is rolling.
  - `recordSuccess(ip)` → deletes the entry entirely. (Per issue:
    "Reset the counter on first successful auth from that IP.")
- Eviction: when adding a brand-new IP entry would push the table over
  `maxEntries`, evict the oldest entry (insertion-order via `Map`).
  Insertion-order Map iteration in JS preserves insertion order, so
  `map.keys().next().value` gives the oldest. Re-insert on update to
  refresh order? — No: keep oldest = "first added" so a flood of new
  IPs doesn't push out an active attacker. Evict the **first** entry.

### 3. IP normalization

- `req.socket.remoteAddress` may yield `::ffff:127.0.0.1` for IPv4 over
  IPv6 sockets. Strip the `::ffff:` prefix so the limiter has a single
  key per logical IP. Implement as `normalizeIp(addr)` helper in
  `rate-limiter.ts` (exported for tests).
- If `remoteAddress` is undefined, treat as `unknown` — still rate-limit
  under that synthetic key.

### 4. Wiring (`src/server/http-server.ts`)

- Add `rateLimiter` field to `HttpMcpServer`, instantiated in the
  constructor with the same `clock` so tests can advance time.
- In `handleRequest`, before `authenticateRequest`:
  - If `authEnabled` is true, derive `clientIp` and call
    `rateLimiter.check(clientIp)`.
  - If blocked → respond 429 with `Retry-After` header (seconds,
    rounded up) and a JSON body `{ error: "Too many failed attempts" }`.
- After `authenticateRequest`:
  - If `!authResult.authenticated` and `authEnabled` → `recordFailure(ip)`.
  - If `authResult.authenticated` and `authEnabled` → `recordSuccess(ip)`.
- The bypass when `authEnabled` is false stays as-is (no rate
  limiting needed — auth is intentionally off).

### 5. AuthResult shape

- Don't change `AuthResult` — it stays `{ authenticated, error }`.
- 429 vs 401 is decided in `http-server.ts` (the limiter says "blocked");
  `authenticateRequest` itself never returns 429 because it doesn't know
  about IPs. This is the cleanest split.

### 6. Logging

- Confirm no token is logged. Current `this.logger.warn('Authentication failed', { error: authResult.error })` only emits the generic error string, which never contains the token. Keep that.
- For 429: log a single warn line with the IP (truncated/redacted? No — same logging behaviour as the existing 401 path; IPs aren't secret).

## Files touched

- `src/server/auth.ts` — constant-time compare.
- `src/server/rate-limiter.ts` — new file.
- `src/server/http-server.ts` — wire limiter, send 429.
- `tests/server/auth.test.ts` — add timing-safe cases.
- `tests/server/rate-limiter.test.ts` — new file, unit tests.
- `tests/server/dispatcher.test.ts` — no change; rate limiter not wired through dispatcher.
- `docs/superpowers/plans/245-timing-safe-bearer-compare.md` — this plan.

## Test list

### `tests/server/auth.test.ts`

1. equal tokens of equal length → authenticated (already covered, keep).
2. unequal tokens of equal length → rejected.
3. unequal tokens of different length → rejected.
4. (existing) reject empty token.

### `tests/server/rate-limiter.test.ts`

1. allows requests under threshold.
2. blocks after 5 failures within 60s.
3. unblocks after 30s block window.
4. resets counter on success.
5. failures older than `windowMs` are forgotten (rolling window).
6. blocks per IP independently — failures on one IP don't block another.
7. evicts oldest entry at `maxEntries`.
8. `normalizeIp` strips `::ffff:` prefix.
9. `check` returns `retryAfterMs` while blocked.

### Integration sanity

- The dispatcher / HTTP layer test would require spinning a real
  socket; existing tests don't do that. We'll rely on a focused
  limiter+wiring test rather than introducing a new HTTP harness.
- (Optional) Extend `auth.test.ts` to cover that the function itself
  is unaware of rate limiting — already implicit; not adding.

## Risks

- **Breaking constant-time semantics**: easy to accidentally
  short-circuit. Mitigation: write the compare as buffer-fill +
  unconditional `timingSafeEqual` + final AND.
- **OOM via unique-IP flood**: mitigated by `maxEntries` cap with
  oldest-eviction.
- **IP spoofing through proxies**: out of scope — we use the socket
  peer address, not `X-Forwarded-For`. Matches issue scope.
- **Rate-limiting localhost during dev**: a local user fat-fingering
  the token 5 times gets a 30s lockout. Acceptable for security
  posture; documented in PR body.

## Verification

- `npm run lint`
- `npx vitest run`
- `npm run typecheck`

## Out of scope

- Replacing `console.log`-style debug instrumentation; logger is
  already structured.
- Per-token (vs per-IP) limiting; issue explicitly asks per-IP.
- Trusting `X-Forwarded-For` — would need explicit proxy config.
