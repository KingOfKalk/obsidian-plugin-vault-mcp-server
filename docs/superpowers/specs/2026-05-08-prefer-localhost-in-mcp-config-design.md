# Prefer `localhost` over `127.0.0.1` in plugin-generated MCP config

**Issue:** [#327](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/327)
**Date:** 2026-05-08
**Status:** Design approved

## Summary

The plugin currently emits `http://127.0.0.1:28741/mcp` everywhere it shows
the user a URL they will paste into an MCP client. Users recognise and
prefer `localhost`. Swap the displayed/copyable URL to `localhost` whenever
the bind address is the default loopback (`127.0.0.1`), and keep the
literal address for any other bind value the user has explicitly chosen
(e.g. `0.0.0.0`, LAN IPs).

This is a presentation-only change. The bound socket, the validator, the
stored `serverAddress` setting, and the DNS-rebind allowlists are all
untouched.

## Goals

- The .mcp.json snippet from "MCP Client Configuration" uses
  `http(s)://localhost:<port>/mcp` when `serverAddress === '127.0.0.1'`.
- The "Server URL" copy field in "Server Settings" uses the same rule.
- The "Server Status" running indicator uses the same rule.
- The user manual leads with `localhost` for endpoint-style references and
  documents `127.0.0.1` as a working alternative.
- Any non-default `serverAddress` (e.g. `0.0.0.0`, `192.168.x.x`) is
  emitted literally — substituting `localhost` there would mislead users
  who set the bind address deliberately for LAN access.

## Non-goals

- No new setting for the displayed hostname.
- No change to the bind address itself, the IPv4 validator, the stored
  `serverAddress` default, or any migration.
- No change to `allowedHosts` / `allowedOrigins` defaults — the server
  still needs to accept both `localhost` and `127.0.0.1`, since clients
  may use either.
- No new locale file; only `docs/help/en.md` exists today.

## Design

### Helper

Add `src/settings/display-host.ts`:

```ts
/**
 * Map a stored bind address to the hostname we show users in
 * client-config snippets and copyable URLs. The default loopback
 * (`127.0.0.1`) becomes `localhost` because that is what users
 * type and recognise. Every other address passes through
 * unchanged — `0.0.0.0` and LAN IPs reflect a deliberate user
 * choice and must not be silently rewritten.
 */
export function displayHost(address: string): string {
  return address === '127.0.0.1' ? 'localhost' : address;
}
```

Plain function. No plugin coupling. Single responsibility.

### Call sites

Three locations consume `serverAddress` to build a user-visible URL.
All three switch to `displayHost(address)`:

1. [`src/settings/mcp-config-section.ts:41`](../../src/settings/mcp-config-section.ts#L41)
   — the .mcp.json snippet emitted by `buildMcpConfigJson`.
2. [`src/settings/server-section.ts:61`](../../src/settings/server-section.ts#L61)
   — the "Server Status" running text (`status_running_one` /
   `status_running_many`).
3. [`src/settings/server-section.ts:174`](../../src/settings/server-section.ts#L174)
   — the "Server URL" `Setting` (description text + clipboard write
   from the copy button).

### Untouched on purpose

- The "Server Address" text input, its placeholder (`127.0.0.1`), the
  warning shown when `serverAddress !== '127.0.0.1'`, and the
  `isValidIPv4` validator
  ([`src/settings/server-section.ts:120-144`](../../src/settings/server-section.ts#L120-L144)).
  These reflect the *stored* value, not a user-facing endpoint.
- `LOOPBACK_HOSTS`, `LOOPBACK_ORIGIN_PREFIXES`, and the allowlist
  defaults — the server still needs to accept both names.
- The IPv4 default in `DEFAULT_SETTINGS` and migrations.

### User manual (`docs/help/en.md`)

Two categories of reference, treated differently:

**Endpoint-style references — switch to `localhost`:**
- Line 25 — "Default endpoint: `http://127.0.0.1:28741/mcp`" → use
  `http://localhost:28741/mcp`. Add a one-sentence note: "If
  `localhost` doesn't resolve in your setup, `http://127.0.0.1:28741/mcp`
  works identically."
- Lines 351–353 — the numbered-list item "**Use plain HTTP on
  `127.0.0.1`** (simplest)" with example URL `http://127.0.0.1:28741/mcp`.
  Update the example URL to `http://localhost:28741/mcp`. The bold
  list-item label stays as "Use plain HTTP on `127.0.0.1`" — it
  describes the bind, not the URL the user pastes.
- Line 401 — "`http://127.0.0.1` and `http://127.0.0.1:28741` are
  different entries" example for the Origin allowlist. Leave as-is —
  this is teaching about exact-match origin rules, where the literal
  `127.0.0.1` form is what an unsophisticated client sends.

**Bind-address references — keep `127.0.0.1`:**
- Line 97 "binding is restricted to `127.0.0.1`".
- Line 148 — "Server Address" table row, default column.
- Lines 162–163 — DNS-rebind explanation ("attacker.com to `127.0.0.1`").
- Lines 170–171 — allowlist defaults (`http://127.0.0.1`, `127.0.0.1`).
- Line 346 — TLS SAN list (`localhost`, `127.0.0.1`, `::1`).
- Line 402 — "you mapped `obsidian.local` to `127.0.0.1`" example.
- Line 463 — "than `127.0.0.1` — read it" referring to the bind address.

The rule of thumb: if the text describes what the server *binds to*,
keep `127.0.0.1`. If the text describes a URL the user will *type or
paste into a client*, lead with `localhost`.

This satisfies project rule 5 (keep `docs/help/en.md` in sync).
[`docs/configuration.md`](../../docs/configuration.md) describes the
stored setting only — no change.

### Tests

**Update `tests/mcp-config-section.test.ts`:**
- Lines 29, 41, 50 — three default-address expectations flip from
  `http(s)://127.0.0.1:28741/mcp` to `http(s)://localhost:28741/mcp`.
- Line 72 — custom-address case (`http://0.0.0.0:9000/mcp`) stays
  unchanged. This case now also documents that non-default addresses
  pass through literally.
- Add a new case asserting that a LAN-style address (e.g.
  `192.168.1.10`) is emitted literally in the snippet.

**Add `tests/settings/display-host.test.ts`:**
- `displayHost('127.0.0.1')` → `'localhost'`.
- `displayHost('0.0.0.0')` → `'0.0.0.0'`.
- `displayHost('192.168.1.10')` → `'192.168.1.10'`.
- `displayHost('localhost')` → `'localhost'` (idempotent).
- `displayHost('')` → `''` (defensive: don't crash on an empty stored
  value mid-edit).

No changes needed to integration / server tests. The bind socket and
the validator behave exactly as before.

## Risks

- **Misleading users with custom hosts files:** A user who has
  `127.0.0.1 obsidian.local` in their hosts file, or who points an MCP
  client at `127.0.0.1` directly, sees `localhost` in the copied
  snippet and may be momentarily confused. Mitigated by the one-line
  note in the manual that `127.0.0.1` works identically.
- **MCP clients that don't resolve `localhost` correctly:** Rare, but
  exists for some sandboxed clients. Same mitigation: the manual notes
  that `127.0.0.1` is a drop-in alternative.
- **Tests in other suites referencing `http://127.0.0.1:28741/mcp`:**
  Server / integration tests set `serverAddress` and check what the
  HTTP server actually binds to. They are not affected because they
  assert socket behaviour, not the displayed URL.

## Acceptance criteria

- `buildMcpConfigJson` emits `http(s)://localhost:<port>/mcp` when
  `serverAddress === '127.0.0.1'`, and `http(s)://<address>:<port>/mcp`
  otherwise.
- The "Server URL" Setting and the "Server Status" text follow the
  same rule.
- `display-host.test.ts` exists and covers the four cases above.
- The .mcp.json snippet copy in `tests/mcp-config-section.test.ts`
  expects `localhost` for the default and `0.0.0.0` for the
  custom-address case.
- `docs/help/en.md` shows `localhost` for endpoint references and
  `127.0.0.1` for bind-address references, with the alternative-host
  note added.
- `npm run lint`, `npm test`, `npm run typecheck` are green.
- No commit modifies images or layout — UI screenshots are not
  required because the change is to existing copy in existing rows.
