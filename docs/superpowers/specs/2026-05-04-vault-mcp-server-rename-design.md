# Rename to `vault-mcp-server` — Design

**Issue**: [#274](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/274)
**Date**: 2026-05-04
**Status**: Approved (pending file review)

## 1. Goal & Non-goals

### Goal

Complete the rename deferred from #247: change the plugin id, display name,
npm package name, GitHub repo, release zip name, log prefix, and all
docs/test references to the new `vault-mcp-server` branding. Result is a
single coherent name across every surface the user (or a future contributor)
sees, with the MCP server's identity-to-AI-clients (`obsidian-mcp-server`)
intentionally left distinct.

### In scope

- `manifest.json` — `id`, `name`, `description`
- `package.json` — `name`, `description`; regenerate `package-lock.json`
- `src/lang/helpers.ts` log prefix
- ~7 test fixtures referencing the old id
- 3 GitHub workflows (`release.yml`, `release-screenshots.yml`,
  `docs-screenshots.yml`)
- README install path + the typo URL on line 29
- `docs/help/en.md` (5+ hits)
- `docs/screenshots-on-host.md` (3 references)
- `release-please-config.json` sanity check (no change expected)
- GitHub repo rename (out-of-band, before branching)

### Non-goals

- **No migration shim.** The plugin has no real users yet (the maintainer is
  the only installer); they rename their dev install folder manually once.
  Removes the `src/main.ts` change, the test, and the future "drop in
  v4.0.0" cleanup.
- **No CHANGELOG history rewrite.** Historical entries (with the
  `obisdian-plugin-mcp` typo URLs) stay as release-please generated them.
  Only the README install link is fixed. CHANGELOG entries are historical
  artifacts; rewriting them churns the diff and contradicts release-please's
  authority over generated history.
- **No `serverInfo.name` change.** Stays `obsidian-mcp-server` per the
  `{service}-mcp-server` MCP convention. This is the AI-client-facing
  identity, separate from the Obsidian-facing plugin id.
- **No listing PR to `obsidianmd/obsidian-releases`.** Out of scope. No
  follow-up issue will be filed for it now.
- **No `BRAND_*` work.** Stale artifact in the original issue — no such
  constants exist in the codebase.
- **No TLS cert filename rename.** Certs live inside the plugin data folder;
  when the user renames the folder once, certs go with it. No special
  handling needed.

## 2. Naming Inventory

### Identifiers (changing)

| Surface                   | File                                                                                                                                                                       | Old                                                                                                | New                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Plugin id                 | `manifest.json#id`                                                                                                                                                         | `obsidian-mcp`                                                                                     | `vault-mcp-server`                                                                 |
| Display name              | `manifest.json#name`                                                                                                                                                       | `MCP Server`                                                                                       | `Vault MCP Server`                                                                 |
| Manifest description      | `manifest.json#description`                                                                                                                                                | `Runs an MCP server inside Obsidian, exposing vault operations as tools over Streamable HTTP.`     | `Exposes your vault as a Model Context Protocol server for AI assistants.`         |
| npm package name          | `package.json#name`                                                                                                                                                        | `obsidian-mcp`                                                                                     | `vault-mcp-server`                                                                 |
| package.json description  | `package.json#description`                                                                                                                                                 | `Obsidian plugin that runs an MCP server, exposing vault operations as tools over Streamable HTTP` | `Exposes your Obsidian vault as a Model Context Protocol server for AI assistants` |
| Lockfile                  | `package-lock.json`                                                                                                                                                        | (regenerated by `npm install`)                                                                     | (regenerated)                                                                      |
| Log prefix                | `src/lang/helpers.ts:48`                                                                                                                                                   | `[obsidian-mcp]`                                                                                   | `[vault-mcp-server]`                                                               |
| GitHub repo               | n/a                                                                                                                                                                        | `KingOfKalk/obsidian-plugin-mcp`                                                                   | `KingOfKalk/obsidian-plugin-vault-mcp-server`                                      |
| Release zip name          | `.github/workflows/release.yml:74`                                                                                                                                         | `obsidian-mcp-${VERSION}.zip`                                                                      | `vault-mcp-server-${VERSION}.zip`                                                  |
| Workflow `PLUGIN_ID` env  | `.github/workflows/release.yml:56`                                                                                                                                         | `obsidian-mcp`                                                                                     | `vault-mcp-server`                                                                 |
| Workflow CSS comment (×3) | `release.yml:39`, `release-screenshots.yml:40`, `docs-screenshots.yml:47`                                                                                                  | `/* obsidian-mcp-plugin styles */`                                                                 | `/* vault-mcp-server styles */`                                                    |
| README install path       | `README.md`                                                                                                                                                                | `<vault>/.obsidian/plugins/obsidian-mcp/`                                                          | `<vault>/.obsidian/plugins/vault-mcp-server/`                                      |
| README typo URL           | `README.md:29`                                                                                                                                                             | `https://github.com/KingOfKalk/obisdian-plugin-mcp/releases`                                       | `https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server/releases`          |
| User manual references    | `docs/help/en.md` (5+ hits)                                                                                                                                                | `obsidian-mcp`                                                                                     | `vault-mcp-server`                                                                 |
| Screenshot tooling refs   | `docs/screenshots-on-host.md`                                                                                                                                              | `tab_id="obsidian-mcp"`, `obsidian-mcp:start-server`, `app.plugins.plugins['obsidian-mcp']`        | `vault-mcp-server` equivalents                                                     |
| Test fixtures             | `tests/__mocks__/obsidian.ts:101`, `tests/main.test.ts:18`, `tests/settings.test.ts` (5 hits), `tests/utils/debug-info.test.ts` (multiple), `tests/utils/log-file.test.ts` | `obsidian-mcp`                                                                                     | `vault-mcp-server`                                                                 |

### Three distinct identities

This naming choice deliberately keeps three separate identities, each
matching the convention of its audience:

| Audience                                   | Name                               | Convention                                                     |
| ------------------------------------------ | ---------------------------------- | -------------------------------------------------------------- |
| AI clients (MCP `serverInfo`)              | `obsidian-mcp-server`              | MCP `{service}-mcp-server` where `{service}=obsidian`          |
| Obsidian itself + npm + direct-install zip | `vault-mcp-server`                 | Obsidian plugin guidelines (no "obsidian", no "plugin")        |
| GitHub URL                                 | `obsidian-plugin-vault-mcp-server` | Maintainer's existing `obsidian-plugin-*` discovery convention |

### Identifiers (intentionally unchanged)

| Surface                                                              | Value                             | Why                                                                      |
| -------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `serverInfo.name` (`src/server/mcp-server.ts:56`)                    | `obsidian-mcp-server`             | AI-client-facing identity; follows MCP `{service}-mcp-server` convention |
| Author                                                               | `KingOfKalk`                      | n/a                                                                      |
| `minAppVersion`                                                      | `1.5.0`                           | n/a                                                                      |
| Test asserting serverInfo (`tests/server/mcp-server.test.ts:96-103`) | asserts `obsidian-mcp-server`     | This test correctly verifies the unchanged name; do not touch            |
| CHANGELOG historical entries                                         | `obisdian-plugin-mcp` (typo) URLs | Release-please generated; rewriting churns history for no real benefit   |

## 3. Sequencing & Commit Plan

### Pre-flight (out-of-band, before any commits)

1. **Rename the repo on GitHub** (Settings → General → Repository name) from
   `obsidian-plugin-mcp` to `obsidian-plugin-vault-mcp-server`. GitHub
   auto-redirects the old URL.
2. **Update the local remote**:

   ```sh
   git remote set-url origin git@github.com:KingOfKalk/obsidian-plugin-vault-mcp-server.git
   ```

3. **Sync main**: `git fetch && git checkout main && git pull`.
4. **Capture "before" screenshot** of the settings tab (`MCP Server` header)
   per CLAUDE.md rule on UI changes. Show inline; do not commit.
5. **Create branch**: `chore/issue-274-rename-vault-mcp-server` (matches the
   issue's `chore!` prefix and the project's branch-naming rule).

### Commit plan — 3 logical commits

The whole rename merges atomically via the PR; commits split for
reviewability per the project's commit conventions.

#### Commit 1 — the rename itself

```
chore(plugin)!: rename plugin id and package to vault-mcp-server

BREAKING CHANGE: plugin id changed from `obsidian-mcp` to `vault-mcp-server`.
Direct-install users must rename `.obsidian/plugins/obsidian-mcp/` to
`.obsidian/plugins/vault-mcp-server/` once. Display name changes from
`MCP Server` to `Vault MCP Server`. The MCP `serverInfo.name` is unchanged
(`obsidian-mcp-server`) — AI clients see the same server identity.

Refs #274
```

Files:

- `manifest.json` (id, name, description)
- `package.json` (name, description)
- `package-lock.json` (regenerated via `npm install`)
- `src/lang/helpers.ts:48` (log prefix)
- All test fixture updates (mocks + ~7 test files)

All tests pass after this commit alone.

#### Commit 2 — CI workflows

```
ci: rename PLUGIN_ID and zip name in workflows for vault-mcp-server

Refs #274
```

Files:

- `.github/workflows/release.yml` (PLUGIN_ID, zip name, CSS comment)
- `.github/workflows/release-screenshots.yml` (CSS comment)
- `.github/workflows/docs-screenshots.yml` (CSS comment)

No `!` — this commit operationalizes the rename, doesn't add a new breaking
change. release-please picks up the `!` from commit 1 alone.

#### Commit 3 — docs

```
docs(rename): update install paths and references for vault-mcp-server

Refs #274
```

Files:

- `README.md` (install path + typo URL fix)
- `docs/help/en.md`
- `docs/screenshots-on-host.md`

### Post-commit verification (before pushing)

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run docs:check`
- Capture **"after" screenshot** of settings tab (`Vault MCP Server` header)
  under same vault, theme, and viewport as the "before". Show inline
  alongside before for visual diff.

### PR

- Title: `chore!: rename plugin id to vault-mcp-server`
- Body: `Closes #274` + Summary (3 bullets: id+display+repo rename, no
  migration shim, no listing PR) + Test plan (see §4)
- Attach before/after screenshots to PR (not to git, per project rule)
- Wait for CI green
- User merges
- release-please picks up the `!` and proposes v3.0.0 with auto-generated
  CHANGELOG (no manual CHANGELOG edit needed)

### `release-please-config.json` sanity check

The config points at `package.json` for the version source and uses
release-type `node`. Renaming `package.json#name` does not affect
release-please (it keys on the version, not the name). The `extra-files`
entry still correctly bumps `manifest.json#version`. **No config change
needed.**

## 4. Verification

### Acceptance criteria

#### File-level (assert exact values)

- `manifest.json#id === "vault-mcp-server"`
- `manifest.json#name === "Vault MCP Server"`
- `manifest.json#description === "Exposes your vault as a Model Context Protocol server for AI assistants."`
- `package.json#name === "vault-mcp-server"`
- `package.json#description === "Exposes your Obsidian vault as a Model Context Protocol server for AI assistants"`
- `npm install` completes cleanly and regenerates `package-lock.json` with
  the new name
- `src/server/mcp-server.ts:56` still has `name: 'obsidian-mcp-server'`
  (intentionally unchanged — it's the AI-client-facing identity)

#### Grep assertions (no stale references)

`obsidian-mcp` is a substring of `obsidian-mcp-server` (which we keep). The
verifying grep must exclude the `-server` suffix:

```sh
# Should return zero matches:
grep -rEn 'obsidian-mcp([^-]|$)' src/ tests/ docs/ .github/ README.md \
  | grep -v 'obsidian-mcp-server'
```

- Zero whole-token `obsidian-mcp` (i.e., not `obsidian-mcp-server`) in
  `src/`, `tests/`, `docs/`, `.github/`, `README.md`
- Zero `obsidian-plugin-mcp` in any of the above (the typo
  `obisdian-plugin-mcp` in `CHANGELOG.md` history is allowed)
- The single allowed `obsidian-mcp-server` reference in
  `src/server/mcp-server.ts:56` is preserved
- The matching test assertion at `tests/server/mcp-server.test.ts:96-103` is
  preserved

#### Commands all green

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run docs:check` (no tool registry change expected → no `docs:tools`
  regeneration needed; but the check still runs)

#### UI verification

- Before/after screenshots of the settings tab attached to the PR (per
  project UI rule). Captured under same vault, theme, and viewport. Shown
  inline before commit.
- Settings header changes from `MCP Server` to `Vault MCP Server`.

#### Repo-level

- GitHub repo renamed; the old URL
  `https://github.com/KingOfKalk/obsidian-plugin-mcp` redirects to
  `https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server`
- Local clone's `origin` points at the new URL

#### Post-merge (out of this PR's control, but expected)

- release-please opens a v3.0.0 release PR (the `!` in commit 1 triggers a
  major bump from current 2.7.1)
- Generated CHANGELOG entry contains the `BREAKING CHANGE:` footer text
  from commit 1
- After v3.0.0 release tag, CI builds and uploads
  `vault-mcp-server-3.0.0.zip` as a release asset

### Test plan (for the PR body)

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` produces `main.js`
- [ ] `npm run docs:check` passes
- [ ] Manually load the built plugin in Obsidian via
      `.obsidian/plugins/vault-mcp-server/` and verify it appears as
      `Vault MCP Server` in the plugin list
- [ ] Settings tab opens, shows `Vault MCP Server` heading, server can be
      started
- [ ] Connect Claude Desktop / MCP inspector to the running server, confirm
      `serverInfo.name` returns `obsidian-mcp-server` (unchanged)

## 5. Out-of-scope follow-ups

### Single deferred follow-up

**Listing PR to `obsidianmd/obsidian-releases`** — open a PR adding this
plugin to `community-plugins.json` so it appears in Obsidian's in-app
community plugin browser.

- Trigger: after v3.0.0 release tag exists (release-please will cut it
  post-merge)
- Owner: separate workflow, not part of #274
- Risk: Obsidian's reviewers might push back on the id `vault-mcp-server`.
  If they do, a follow-up rename to one of the backups (`vault-mcp`,
  `mcp-bridge`, `local-mcp` — all currently free) would itself become its
  own issue.
- **No follow-up GitHub issue will be filed now.** The maintainer chose to
  leave it for later.

### Things that turned out NOT to need follow-ups

| Originally listed                | Status   | Why                                                                                    |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Migration shim removal in v4.0.0 | Dropped  | No shim being added                                                                    |
| CHANGELOG history rewrite        | Rejected | Would churn release-please-generated history                                           |
| `BRAND_*` strings audit          | Dropped  | No such constants exist in the codebase                                                |
| `serverInfo.name` rename         | Rejected | AI-client identity is intentionally distinct from plugin id                            |
| TLS cert filename rename         | Dropped  | Lives inside the plugin data folder; user renames the folder once and certs go with it |

## Decision log

| #   | Question                | Decision                                                                                                                                                        |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Migration shim lifespan | MOOT — no shim being added (see Q5)                                                                                                                             |
| 2   | Repo rename timing      | A — rename on GitHub before branching, update local remote upfront                                                                                              |
| 3   | Plugin id               | `vault-mcp-server` (not `mcp-server` from the original issue); display name `Vault MCP Server`; repo `obsidian-plugin-vault-mcp-server`; npm `vault-mcp-server` |
| 3b  | `serverInfo.name`       | Unchanged (`obsidian-mcp-server`); separate audience from plugin id                                                                                             |
| 4   | Typo links cleanup      | A — fix README:29 only; leave CHANGELOG history alone                                                                                                           |
| 5   | Migration shim          | A — drop entirely; only the maintainer is affected                                                                                                              |
| 6   | `BRAND_*` audit         | A — stale artifact, drop from spec                                                                                                                              |
| 7   | CSS workflow comment    | A — update for consistency                                                                                                                                      |
