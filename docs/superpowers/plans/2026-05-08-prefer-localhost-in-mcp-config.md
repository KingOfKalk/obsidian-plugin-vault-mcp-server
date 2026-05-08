# Prefer `localhost` over `127.0.0.1` in MCP Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the displayed/copyable URL to `http(s)://localhost:<port>/mcp` whenever the bind address is the default loopback (`127.0.0.1`), in the .mcp.json snippet, the "Server URL" copy field, and the "Server Status" text. Keep the literal address for any other bind value. Update the user manual to match. Presentation only — no socket, validator, default, or migration changes.

**Architecture:** A single pure helper `displayHost(address: string): string` returns `'localhost'` when `address === '127.0.0.1'` and the literal `address` otherwise. Three call sites consume it. Two i18n locales? No — `docs/help/en.md` is the only locale today. Tests are TDD where existing assertions exist; a new dedicated unit test covers the helper.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin API, Conventional Commits.

**Spec:** [`docs/superpowers/specs/2026-05-08-prefer-localhost-in-mcp-config-design.md`](../specs/2026-05-08-prefer-localhost-in-mcp-config-design.md)

**Issue:** [#327](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/327)

**Branch:** `feat/issue-327-prefer-localhost-in-mcp-config` (already created and on the spec commit)

---

## Task 1: Baseline check

Confirm the working tree is clean and all checks are green before any code changes. If any of these fail at the baseline, stop and surface it — do NOT proceed with the change on a broken baseline.

**Files:** none.

- [ ] **Step 1.1: Confirm branch and clean working tree**

Run: `git status`
Expected: on branch `feat/issue-327-prefer-localhost-in-mcp-config`, working tree clean.

- [ ] **Step 1.2: Run the test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 1.3: Run the linter**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 1.4: Run the type checker**

Run: `npm run typecheck`
Expected: no errors.

---

## Task 2: Add `displayHost` helper with unit tests (TDD)

**Files:**
- Create: `src/settings/display-host.ts`
- Test: `tests/settings/display-host.test.ts`

- [ ] **Step 2.1: Write the failing test file**

Create `tests/settings/display-host.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { displayHost } from '../../src/settings/display-host';

describe('displayHost', () => {
  it('maps the default loopback to localhost', () => {
    expect(displayHost('127.0.0.1')).toBe('localhost');
  });

  it('passes 0.0.0.0 through unchanged (bind-all is intentional)', () => {
    expect(displayHost('0.0.0.0')).toBe('0.0.0.0');
  });

  it('passes a LAN IP through unchanged', () => {
    expect(displayHost('192.168.1.10')).toBe('192.168.1.10');
  });

  it('is idempotent on localhost', () => {
    expect(displayHost('localhost')).toBe('localhost');
  });

  it('passes an empty string through (defensive: mid-edit input)', () => {
    expect(displayHost('')).toBe('');
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `npx vitest run tests/settings/display-host.test.ts`
Expected: FAIL — module `../../src/settings/display-host` not found.

- [ ] **Step 2.3: Write the minimal implementation**

Create `src/settings/display-host.ts`:

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

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `npx vitest run tests/settings/display-host.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 2.5: Run lint + typecheck on the new files**

Run: `npm run lint`
Expected: no errors.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2.6: Stage and verify**

Run: `git add src/settings/display-host.ts tests/settings/display-host.test.ts`
Run: `git status`
Expected: two new files staged, no other changes.

(Do NOT commit yet — the helper is committed together with its first wired call site in Task 3.)

---

## Task 3: Wire `displayHost` into the .mcp.json snippet (TDD)

**Files:**
- Modify: `src/settings/mcp-config-section.ts:35-57`
- Modify: `tests/mcp-config-section.test.ts:23-74`

- [ ] **Step 3.1: Update existing tests to expect `localhost` for the default address**

Edit `tests/mcp-config-section.test.ts`. Replace the three default-address URL expectations (the cases at lines 23, 35, 44) and add one new pass-through case for a LAN IP. The custom-address case (line 63) stays as-is.

Replace the body of the three default-address cases:

- Line 29: change `'http://127.0.0.1:28741/mcp'` → `'http://localhost:28741/mcp'`.
- Line 41: change `'https://127.0.0.1:28741/mcp'` → `'https://localhost:28741/mcp'`.
- Line 50: change `'http://127.0.0.1:28741/mcp'` → `'http://localhost:28741/mcp'`.

Append a new case after the existing custom-address case:

```ts
  it('passes a LAN-style address through literally', () => {
    const plugin = makePlugin({ serverAddress: '192.168.1.10', accessKey: 'k' });
    const snippet = buildMcpConfigJson(plugin as McpPlugin);
    const parsed = parseSnippet(snippet);

    expect(parsed.obsidian.url).toBe('http://192.168.1.10:28741/mcp');
  });
```

- [ ] **Step 3.2: Run the snippet tests to verify the three default-address tests fail**

Run: `npx vitest run tests/mcp-config-section.test.ts`
Expected: 3 FAIL (the default-address ones, because the snippet still emits `127.0.0.1`); the custom-address case and the new LAN case PASS.

- [ ] **Step 3.3: Wire `displayHost` into `buildMcpConfigJson`**

Edit `src/settings/mcp-config-section.ts`. Add the import and replace the URL construction:

At the top of the file (after the existing imports), add:

```ts
import { displayHost } from './display-host';
```

In `buildMcpConfigJson`, replace:

```ts
  const address = plugin.settings.serverAddress;
  const port = plugin.settings.port;
  const accessKey = plugin.settings.accessKey;
  const authEnabled = plugin.settings.authEnabled;
  const scheme = plugin.settings.httpsEnabled ? 'https' : 'http';
  const url = `${scheme}://${address}:${String(port)}/mcp`;
```

with:

```ts
  const address = plugin.settings.serverAddress;
  const port = plugin.settings.port;
  const accessKey = plugin.settings.accessKey;
  const authEnabled = plugin.settings.authEnabled;
  const scheme = plugin.settings.httpsEnabled ? 'https' : 'http';
  const url = `${scheme}://${displayHost(address)}:${String(port)}/mcp`;
```

- [ ] **Step 3.4: Run the snippet tests to verify they all pass**

Run: `npx vitest run tests/mcp-config-section.test.ts`
Expected: PASS — all cases (the three updated default-address ones, the custom-address one, and the new LAN one).

- [ ] **Step 3.5: Run the helper test together to confirm both pass**

Run: `npx vitest run tests/settings/display-host.test.ts tests/mcp-config-section.test.ts`
Expected: all PASS.

(Do NOT commit yet — Task 4 wires the same helper into the two server-section call sites and they ship in the same logical commit.)

---

## Task 4: Wire `displayHost` into the "Server URL" Setting and "Server Status" text (TDD)

**Files:**
- Modify: `src/settings/server-section.ts:40-66, 174-190`
- Modify: `tests/settings.test.ts:655-669`

- [ ] **Step 4.1: Update the existing "Server URL copy" test to expect `localhost`**

Edit `tests/settings.test.ts:667`. Change:

```ts
      expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:28741/mcp');
```

to:

```ts
      expect(writeText).toHaveBeenCalledWith('http://localhost:28741/mcp');
```

- [ ] **Step 4.2: Run the settings test to verify the URL-copy test fails**

Run: `npx vitest run tests/settings.test.ts -t 'Server URL copy button'`
Expected: FAIL — actual call was `http://127.0.0.1:28741/mcp`.

- [ ] **Step 4.3: Wire `displayHost` into `server-section.ts`**

Edit `src/settings/server-section.ts`. Add the import next to the existing `./validation` and `./https-section` imports:

```ts
import { displayHost } from './display-host';
```

Replace the URL construction in `renderServerStatusSection` (currently around line 60–61):

```ts
  const address = plugin.settings.serverAddress;
  const url = `${scheme(plugin)}://${address}:${String(port)}`;
```

with:

```ts
  const address = plugin.settings.serverAddress;
  const url = `${scheme(plugin)}://${displayHost(address)}:${String(port)}`;
```

Replace the URL construction in `renderServerSettingsSection` (currently around line 174):

```ts
  const serverUrl = `${scheme(plugin)}://${plugin.settings.serverAddress}:${String(plugin.settings.port)}/mcp`;
```

with:

```ts
  const serverUrl = `${scheme(plugin)}://${displayHost(plugin.settings.serverAddress)}:${String(plugin.settings.port)}/mcp`;
```

Leave the rest of the file alone — the placeholder `'127.0.0.1'` on the bind-address text input ([line 126](../../src/settings/server-section.ts#L126)), the warning trigger comparing against `'127.0.0.1'` ([line 139](../../src/settings/server-section.ts#L139)), the loopback constants ([lines 12-20](../../src/settings/server-section.ts#L12-L20)), and the textarea placeholders ([lines 332, 358](../../src/settings/server-section.ts#L332)) all describe the *bind address* and stay as `127.0.0.1`.

- [ ] **Step 4.4: Run the settings test to verify the URL-copy test now passes**

Run: `npx vitest run tests/settings.test.ts -t 'Server URL copy button'`
Expected: PASS.

- [ ] **Step 4.5: Run the full Vitest suite to catch any other affected assertions**

Run: `npm test`
Expected: all PASS. (`tests/lang/helpers.test.ts:113` keeps `http://127.0.0.1:28741` because that test asserts the i18n placeholder substitution, not what URL the caller passes.)

- [ ] **Step 4.6: Run lint + typecheck**

Run: `npm run lint`
Expected: no errors.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4.7: Stage all code changes and commit**

Run: `git add src/settings/display-host.ts src/settings/mcp-config-section.ts src/settings/server-section.ts tests/settings/display-host.test.ts tests/mcp-config-section.test.ts tests/settings.test.ts`

Run: `git status`
Expected: six files staged, no others.

Commit:

```bash
git commit -m "feat(settings): prefer localhost over 127.0.0.1 in displayed URLs

Add a small displayHost helper that maps the default loopback
(127.0.0.1) to localhost while passing every other address
through literally. Wire it into the .mcp.json snippet, the
Server URL copy field, and the Server Status running text.

Bind socket, validator, stored serverAddress default, and
DNS-rebind allowlists are unchanged. Pure presentation.

Refs #327"
```

---

## Task 5: Update the user manual

**Files:**
- Modify: `docs/help/en.md` (specific lines below)

The rule applied: lines describing a URL the user *pastes into a client* switch to `localhost`; lines describing what the server *binds to* keep `127.0.0.1`. See the spec's "User manual" section for the rationale.

- [ ] **Step 5.1: Update the "Default endpoint" line and add the alternative-host note**

Edit `docs/help/en.md:25`. Change:

```markdown
- **Default endpoint**: `http://127.0.0.1:28741/mcp`
```

to:

```markdown
- **Default endpoint**: `http://localhost:28741/mcp` (or `http://127.0.0.1:28741/mcp` if `localhost` doesn't resolve in your setup)
```

- [ ] **Step 5.2: Update the "Use plain HTTP" example URL**

Edit `docs/help/en.md` around lines 351–353. Find the numbered-list item:

```markdown
1. **Use plain HTTP on `127.0.0.1`** (simplest). Localhost traffic never
   leaves your machine, so a TLS layer is not required. Toggle HTTPS
   off and use `http://127.0.0.1:28741/mcp`.
```

Change *only* the example URL on the third line — leave the bold list-item label `**Use plain HTTP on `127.0.0.1`**` exactly as-is (it describes the bind, not the URL):

```markdown
1. **Use plain HTTP on `127.0.0.1`** (simplest). Localhost traffic never
   leaves your machine, so a TLS layer is not required. Toggle HTTPS
   off and use `http://localhost:28741/mcp`.
```

- [ ] **Step 5.3: Verify no other endpoint-style URL references were missed**

Run: `grep -n "http://127.0.0.1:28741\|https://127.0.0.1:28741" docs/help/en.md`

Expected: only line 401 remains (the Origin-allowlist exact-match teaching example), which intentionally keeps `127.0.0.1` because that example demonstrates how exact-match origin rules work for the literal IP form.

If the grep finds any other line not on the keep-list (line 401 only), update *that* example URL too. The keep-list per the spec is: lines 97, 148, 162–163, 170–171, 346, 401, 402, 463 — all describe bind, allowlist, or DNS-rebind concerns, not URLs the user types.

- [ ] **Step 5.4: Render-check the manual diff visually**

Run: `git --no-pager diff docs/help/en.md`
Expected: exactly two changed regions — line 25 and the example URL on line 353. No changes elsewhere.

- [ ] **Step 5.5: Run `docs:check` to confirm no doc tooling complains**

Run: `npm run docs:check`
Expected: PASS. (This change does not touch the tool registry, so `docs/tools.generated.md` does not need regenerating.)

- [ ] **Step 5.6: Commit the manual update**

Run: `git add docs/help/en.md`

Run: `git status`
Expected: only `docs/help/en.md` staged.

Commit:

```bash
git commit -m "docs(help): show localhost as the default MCP endpoint

Lead the default endpoint and the plain-HTTP recipe with
localhost; keep 127.0.0.1 documented as a working alternative.
Bind-address, allowlist, and DNS-rebind references stay at
127.0.0.1 because they describe the literal bound socket.

Refs #327"
```

---

## Task 6: Final verification

**Files:** none.

- [ ] **Step 6.1: Final lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6.2: Final typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6.3: Final test run**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6.4: Verify the commit log**

Run: `git log --oneline -n 3`
Expected output (top to bottom):

```
<sha> docs(help): show localhost as the default MCP endpoint
<sha> feat(settings): prefer localhost over 127.0.0.1 in displayed URLs
<sha> docs(superpowers/specs): prefer localhost over 127.0.0.1 in mcp config
```

- [ ] **Step 6.5: Confirm working tree is clean**

Run: `git status`
Expected: clean, on branch `feat/issue-327-prefer-localhost-in-mcp-config`.

---

## Task 7: Push branch and open the PR

This task talks to the GitHub remote. Execute only after the user confirms they want the PR opened — the brainstorming/design flow ends at "implementation done"; pushing and PR-opening is a deliberate step the user typically gates.

**Files:** none.

- [ ] **Step 7.1: Push the branch with upstream tracking**

Run: `git push -u origin feat/issue-327-prefer-localhost-in-mcp-config`
Expected: branch pushed, tracking set.

- [ ] **Step 7.2: Open the PR via `gh`**

Run:

```bash
gh pr create \
  --title "feat(settings): prefer localhost over 127.0.0.1 in displayed URLs" \
  --body "$(cat <<'EOF'
Closes #327

## Summary

- Swap the displayed/copyable URL to `http(s)://localhost:<port>/mcp`
  whenever the bind address is the default loopback (`127.0.0.1`).
  Applies to the .mcp.json snippet, the "Server URL" copy field,
  and the "Server Status" running text.
- Non-default bind addresses (`0.0.0.0`, LAN IPs) pass through
  literally — substituting `localhost` there would mislead users
  who deliberately exposed the server.
- Update the user manual to lead with `localhost` for endpoint
  references and document `127.0.0.1` as a working alternative.

This is a presentation-only change. The bound socket, the IPv4
validator, the stored `serverAddress` default, and the DNS-rebind
allowlists are untouched.

Spec: `docs/superpowers/specs/2026-05-08-prefer-localhost-in-mcp-config-design.md`

## Test plan

- [x] `npm test` — `tests/settings/display-host.test.ts` covers
      the helper; `tests/mcp-config-section.test.ts` covers the
      snippet for default and non-default addresses;
      `tests/settings.test.ts` covers the Server URL copy button.
- [x] `npm run lint`
- [x] `npm run typecheck`
- [ ] Manual: open Settings → MCP Client Configuration, click the
      copy button on a fresh install, confirm clipboard contains
      `http://localhost:28741/mcp`.
- [ ] Manual: change Server Address to `0.0.0.0`, copy again,
      confirm clipboard contains `http://0.0.0.0:28741/mcp`.
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 7.3: Apply existing labels**

Run: `gh pr view --json labels` to check what labels exist on the PR (none initially).

If an `enhancement` label exists in the repo, attach it (matches issue #327's label):

```bash
gh pr edit --add-label enhancement
```

If the label does not exist in the repo, skip — do not create new labels (project rule 32).

- [ ] **Step 7.4: Hand off**

Tell the user: PR opened, link printed in step 7.2. Wait for CI; the user merges. Do not merge yourself (project rule 7 of the repo CLAUDE.md).

---

## Out of scope (do not do in this plan)

- No change to `serverAddress` default, validator, or migration.
- No change to `allowedHosts` / `allowedOrigins` defaults — the
  server still needs to accept both `localhost` and `127.0.0.1`.
- No new locale; `docs/help/en.md` is the only one today.
- No tool-registry changes; `docs/tools.generated.md` does not
  need regenerating.
- No screenshots — change is to existing copy in existing rows.
  If a reviewer asks, the implementer can manually capture a
  before/after of the snippet copy field, but it is not required
  by the project's screenshot rule (no layout change, no new UI
  surface).
