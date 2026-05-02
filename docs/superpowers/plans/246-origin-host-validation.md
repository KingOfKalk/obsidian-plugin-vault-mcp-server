# Plan: Origin/Host validation for DNS-rebind protection (Issue #246)

## Goal

Reject inbound HTTP requests whose `Origin` or `Host` header points at
something other than localhost, so a hostile webpage cannot reach the
loopback MCP port via DNS rebinding.

## Approach

### 1. Settings (`src/types.ts` + `src/settings/migrations.ts`)

- Add four fields to `McpPluginSettings`:
  - `allowedOrigins: string[]` — default
    `['http://127.0.0.1', 'http://localhost', 'https://127.0.0.1', 'https://localhost']`.
  - `allowedHosts: string[]` — default `['127.0.0.1', 'localhost']`.
  - `allowNullOrigin: boolean` — default `false`.
  - `requireOrigin: boolean` — default `false`.
- Bump `CURRENT_SCHEMA_VERSION` from 8 to 9 and add `migrateV8ToV9` that
  fills in the defaults when missing.

### 2. Validator (`src/server/origin-host.ts`, new file)

Pure function `validateOriginHost(req, opts)` returning a discriminated
union:

```ts
type OriginHostResult =
  | { ok: true }
  | { ok: false; reason: string; origin: string | undefined; host: string | undefined };
```

- Read `Origin` and `Host` from `req.headers`. Both can be `string | string[] | undefined`.
- `Host` rules:
  - Missing/empty → reject `"Missing Host header"`.
  - Strip `:port` suffix (last `:` for plain hosts; bracket-aware for IPv6
    just in case — `localhost`/`127.0.0.1` are the realistic cases, but
    handle `[::1]:port` defensively).
  - Compare host portion against `allowedHosts` (case-insensitive).
  - Not in allowlist → reject `"Host not allowlisted"`.
- `Origin` rules:
  - Absent and `requireOrigin` → reject `"Missing Origin header"`.
  - Absent and not required → allow.
  - `"null"` literal: allow only when `allowNullOrigin`.
  - Otherwise: exact-match against `allowedOrigins` (case-insensitive on
    scheme+host portion; ports if present must match verbatim per the
    issue — "scheme + host + port-stripped — match the origin header
    value verbatim against the allowlist"). Implementation: strip a
    trailing `/`, then compare lowercase to lowercase allowlist entries
    (also stripped of trailing `/`).
- Settings/empty values: an empty `allowedOrigins` / `allowedHosts` list
  rejects everything except the trivial bypasses described above.

### 3. Wire into `handleRequest` (`src/server/http-server.ts`)

- Run `validateOriginHost` at the **very top** of `handleRequest`,
  before `handlePreflight`. This is the only behavioural change to the
  existing pipeline; preflight, CORS headers, rate limiter, and auth
  stay in place after the check.
- On rejection:
  1. Apply CORS headers (so the browser surfaces a clearer failure).
  2. `res.writeHead(403, { 'Content-Type': 'application/json' })`.
  3. Body: `{ "error": "<reason>" }`.
  4. `this.logger.warn('Request rejected: origin/host validation', { ip, method, url, origin, host, reason })`.
  5. Do **not** touch the rate limiter (per issue: rejection is pre-auth
     and must not consume the failure budget).
  6. Return — never dispatch to JSON-RPC.

### 4. Settings UI (`src/settings/server-section.ts`)

- New "DNS Rebind Protection" subgroup beneath Auto-start.
- Two textareas:
  - `Allowed Origins` (one per line).
  - `Allowed Hosts` (one per line).
- Two toggles:
  - `Allow Origin: null` (default off).
  - `Require Origin header` (default off).
- For each list, after the user changes the value, parse non-loopback
  entries and surface a warning string under the textarea (similar to
  the existing `warning_non_localhost` for `serverAddress`). Loopback
  entries: `127.0.0.1`, `localhost`, `[::1]`, `::1`, plus the
  `http(s)://` variants for origins.

### 5. Translation strings (`src/lang/locale/en.ts`, `src/lang/locale/de.ts`)

- Add new keys: section heading, four setting names + descriptions, the
  loopback-only warnings. German translations alongside.

### 6. User manual (`docs/help/en.md`)

- Add new rows to the Server Settings table for the four new settings.
- Add a brief "DNS Rebind Protection" subsection documenting why it
  exists, what gets rejected, and how to widen it (with the warning).
- Add an FAQ entry for "I'm getting 403 from a real client" pointing at
  the new settings.

### 7. Tests

#### `tests/server/origin-host.test.ts` (new)

Pure unit tests of `validateOriginHost`:

- same-origin allowed (`Origin: http://127.0.0.1:28741`, allowlist
  contains `http://127.0.0.1:28741`).
- exact match required — different port rejected.
- cross-origin rejected (`Origin: http://attacker.com`).
- `Origin: null` rejected by default.
- `Origin: null` allowed when `allowNullOrigin: true`.
- missing `Origin` allowed by default.
- missing `Origin` rejected when `requireOrigin: true`.
- hostile `Host` rejected (`Host: attacker.com`).
- allowed `Host` with port (`Host: 127.0.0.1:27123`).
- empty/missing `Host` rejected.
- case-insensitive host compare (`Host: LocalHost`).
- empty allowedHosts/allowedOrigins → reject everything.

#### `tests/server/http-server.test.ts` (new)

Integration via real loopback HTTP server (cheap — `node:http` already
in use) to assert full pipeline behaviour:

- 403 returned for rejected request with JSON body.
- rejected request does NOT trigger the rate limiter (record nothing —
  inspect by issuing many rejections then a valid request and asserting
  the auth path runs normally).
- rejected request does NOT dispatch to JSON-RPC (we observe by ensuring
  the server factory is never invoked).
- preflight from disallowed origin still returns 403.
- legit `127.0.0.1` POST passes the check (then fails for a different
  reason — invalid JSON body or missing session — but the test only
  asserts the validator did not 403 it).

Approach: subclass-free harness that constructs `HttpMcpServer` with a
spy `serverFactory` and calls `start()` on a random port (port 0). Use
`node:http` to make assertions, then `stop()`.

#### `tests/server/migrations.test.ts`

If the file exists, add coverage for the v8→v9 hop. Otherwise skip — the
migration is trivial and exercised by the integration path.

## Verification

- `npm run lint`
- `npm test`
- `npm run typecheck`

## Out of scope

- TLS / cert pinning.
- CSRF tokens.
- Settings UI tests (the project doesn't appear to test rendered
  Setting widgets; following existing conventions).

## Commit plan

Single PR, three commits:

1. `docs(plans/246): plan for Origin/Host validation`.
2. `feat(server/http): validate Origin and Host for DNS-rebind protection`
   — types, validator, wiring, settings UI, translations, tests.
3. `docs(help/en): document DNS rebind protection settings`
   — manual updates.

(Or fold 3 into 2 if it stays small — decided at commit time.)
