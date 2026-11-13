# Contributing

## Development Setup

1. Clone the repository
2. Use **Node.js 24.22.1**. CI, the release workflow (both through `.github/actions/setup`) and the devcontainer (`mcr.microsoft.com/devcontainers/typescript-node:5.2.5-24-trixie`) all use this version. `package.json` `engines` allows `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1`, the range WebdriverIO 10 needs; older versions print `EBADENGINE` warnings. To change the version, update the devcontainer image, the `node-version` default in `.github/actions/setup/action.yml`, `engines` and this line together.
3. Install dependencies: `npm install`
4. Start dev build: `npm run dev`
5. Copy the built files to your vault's plugin folder for testing

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Watch mode build |
| `npm run build` | Production build |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:e2e` | Build, then run the E2E tests in headless Obsidian (see [E2E tests](#e2e-tests-headless-obsidian)) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format with Prettier |
| `npm run typecheck` | TypeScript type checking (`src/`, `tests/`, `scripts/`, `evals/`, then `e2e/` with `e2e/tsconfig.json`) |
| `npm run docs:tools` | Regenerate the tool reference (`docs/tools.generated.md`, `docs/tools/`) after changing the tool registry |
| `npm run surface:measure` | Print the size of the agent-facing surface (instructions, `tools/list`, `prompts/list`) per part, module and tool (see [Tool surface budget](#tool-surface-budget)) |
| `npm run surface:update` | Measure and rewrite the committed baseline `docs/surface-baseline.json` |
| `npm run eval` | LLM evaluation of the MCP tools against Anthropic or any OpenAI-compatible API such as Mistral (needs a key, usually in `.env`, costs money; see [`evals/README.md`](evals/README.md)) |

## E2E tests (headless Obsidian)

Unit tests run against `MockObsidianAdapter`. Behaviour that only real Obsidian has (link rewriting on rename, the "Deleted files" setting, the metadata cache) is covered by E2E specs in `e2e/specs/*.e2e.ts`. They use WebdriverIO with [`wdio-obsidian-service`](https://github.com/jesse-r-s-hines/wdio-obsidian-service), configured in `wdio.conf.mts`.

- **Requirements:** Linux with Xvfb and the Electron libraries. On Debian trixie or Ubuntu 24.04+ run `bash scripts/install-e2e-deps.sh` (uses `sudo` unless you are root); the devcontainer runs it in `postCreateCommand`. Node.js as in [Development Setup](#development-setup).
- **Run:** `npm run test:e2e`. It builds the plugin, then runs `xvfb-run -a wdio run ./wdio.conf.mts`. One spec file: `npm run build && xvfb-run -a npx wdio run ./wdio.conf.mts --spec ./e2e/specs/smoke.e2e.ts`. It is not part of `npm test`.
- **What happens:** the service downloads Obsidian into `.obsidian-cache/` (not committed; the first run takes a while) and opens a temporary copy of `tests/vault/` with this checkout as the plugin. Dataview (pinned in `wdio.conf.mts`) is installed from GitHub but starts disabled; `e2e/specs/plugin-tools.e2e.ts` switches it on and off. Each spec file starts from a fresh vault, so a spec that uses editor, workspace or ui tools switches those modules on first with `enableModules` (they are off in a new install). Each spec sets the plugin's settings with `browser.executeObsidian` (`127.0.0.1`, port 28749, Bearer auth with a test key), starts the server, and calls tools with the MCP SDK client over HTTP. Set `E2E_MCP_PORT` if 28749 is taken. Helpers are in `e2e/helpers.ts`.
- **Obsidian version:** pinned so results do not change with an Obsidian update. The default is the manifest's `minAppVersion`, 1.15.0. Pick another one with `OBSIDIAN_VERSION=1.15.1 OBSIDIAN_INSTALLER=1.15.1 npm run test:e2e`. CI runs the default and a pinned current release (the `e2e` job matrix in `.github/workflows/ci.yml`). To change a pinned version, edit `wdio.conf.mts` or the matrix; the CI cache key follows automatically.
- **Known bugs:** a spec for a bug that is not fixed yet stays in the suite as `it.skip` with a comment naming the issue.
- **Worktrees:** each checkout has its own `.obsidian-cache/`; symlink it to another checkout's to skip the download.
- **Download errors:** GitHub sometimes answers with 504 or drops the connection; run it again.

## Architecture

```
src/
  main.ts              Plugin entry point (onload/onunload)
  settings.ts          Settings tab UI
  types.ts             Shared types and defaults
  server/              HTTP server, auth, CORS, MCP transport
  registry/            Module registration system
  obsidian/            Obsidian API abstraction layer
  tools/               Feature modules (vault, search, editor, etc.)
  utils/               Logger, path guard, validation
```

### Key Design Decisions

- **Module self-registration**: Each tool module implements `ToolModule` and self-registers with the `ModuleRegistry`. Adding a new module requires zero changes to core code.
- **Obsidian abstraction**: All Obsidian API access goes through `ObsidianAdapter`, enabling full testability via `MockObsidianAdapter`.
- **Path traversal protection**: All file operations validate paths through `validateVaultPath()`.
- **Timers**: code that runs in Obsidian uses the window's timers (`window.setInterval`, …), as the plugin guidelines ask. The server code also runs without a window (unit tests, `evals/`, `scripts/`), so it uses `startInterval()` and `sleep()` from `src/utils/timers.ts`, which fall back to `node:timers`. Vitest's fake timers do not replace `node:timers`; a test that uses them stubs the window with `vi.stubGlobal('window', globalThis)`.
- **Console**: the `Logger` prints only `warn` and `error` unless Debug Mode is on (`debug` and `info` then go to `console.debug`); `info` and above always go to `debug.log`.

### Linting and the community review

`npm run lint` runs `eslint-plugin-obsidianmd`'s `recommended` config, the checks of the community directory's automated review, plus the rules the review's scanner reports as errors (`eslint.config.mjs`). Its rules for code that runs in Obsidian apply to `src/`. `tests/`, `scripts/`, `evals/` and `e2e/` run in Node: they keep Node's timers, `fetch`, the npm `moment` and their own `eslint-disable` comments. In `src/`, every `eslint-disable` comment needs a `-- reason`, and rules such as `no-console`, `@typescript-eslint/no-explicit-any` and the `obsidianmd/*` rules cannot be disabled at all. Warnings we keep on purpose:

- `@typescript-eslint/no-restricted-imports` for `moment` (3): the source imports the npm package so tests and scripts run outside Obsidian; the build replaces it with Obsidian's own instance (`scripts/esbuild/obsidian-moment.mjs`).
- `obsidianmd/hardcoded-config-path` (2): texts for the AI client that say the config folder is usually `.obsidian`; the check itself uses `vault.configDir`.
- `obsidianmd/settings-tab/prefer-setting-definitions`, `obsidianmd/settings-tab/prefer-update-over-display` and `@typescript-eslint/no-deprecated` for `display()` (3, `src/settings/tab.ts`): the settings tab still renders imperatively with `display()`; `update()` only refreshes the declarative `getSettingDefinitions()` (Obsidian 1.13+), which the tab does not have yet.

### Obsidian internals we rely on

No public API lists plugins, runs a command by id or reads the core plugins' options and some vault settings, so a few reads use Obsidian internals. They are typed narrowly in `src/obsidian/adapter.ts` (`AppInternals`, `LeafInternals`, no `any`), every field is optional and checked, nothing is written through them, and each has a fallback. Check this table when raising `minAppVersion` or the pinned Obsidian versions of the E2E jobs.

| Internal | Where | Used for | Guard | Fallback |
| --- | --- | --- | --- | --- |
| `app.plugins.manifests`, `app.plugins.enabledPlugins` | `getInstalledPlugins`, `isPluginEnabled` | `plugin_list`, `plugin_check`, whether `plugin_dataview_query` is listed | `?.`, `!!` | empty list / `false`; the Dataview tool is then not listed |
| `app.plugins.plugins.dataview.api.queryMarkdown` | `getDataviewApi` | `plugin_dataview_query` (DQL only, `allowHtml: false`) | `?.`, `typeof === 'function'` | `null`: "Plugin API unavailable for dataview" |
| `app.commands.executeCommandById` | `executeCommand` | `plugin_execute_command` (allowlisted ids only) | `?.` on the object and the method | `false`: "Command not found" |
| `app.internalPlugins.plugins['daily-notes']` (`enabled`, `instance.options`) | `getDailyNotesSettings` | `vault_daily_note`, the daily-note prompt | `?.`, `enabled === true`, `typeof` per field | `null`: "core plugin is disabled"; missing fields get Obsidian's defaults |
| `app.internalPlugins.plugins.templates.instance.options.folder` | `getTemplatesFolder` | template tools and prompts | `?.`, `typeof === 'string'` | `null`: folder `templates` |
| `app.vault.getConfig('alwaysUpdateLinks' \| 'trashOption')` | `getAutoUpdateLinks`, `getTrashDestination` | renames with or without link updates; where a delete went | type guard `hasGetConfig`, `try`/`catch` | `null` / `unknown`: rename without link updates (no prompt) |
| `WorkspaceLeaf.id` | `getActiveLeafInfo`, `getOpenFiles`, `setActiveLeaf` | leaf ids of the workspace tools | `typeof === 'string'` | id `unknown`; `workspace_set_active_leaf` finds nothing |
| Markdown view state `{ mode, source }` | `openFile` | `workspace_open_file`'s `mode` | none needed | Obsidian ignores an unknown state; the file still opens |
| `window.require('electron').remote.dialog` or `@electron/remote` | `src/utils/file-picker.ts` | "Browse…" for a custom TLS certificate and key | `typeof window`, `typeof require`, `try`/`catch`, `?.` | `null`: the dialog does not open |

Public API used instead of internals since #557: `workspace.getActiveViewOfType(View)` and `FileView.file` (not `workspace.activeLeaf` or `view.file` on any view), `TFile.stat` (not `vault.adapter.stat`), `FileSystemAdapter.getBasePath()` (not `adapter.basePath`), `apiVersion` (not `app.appVersion`), `getLanguage()` (not `localStorage.language`), `fileManager.trashFile()` without the `vault.trash` fallback, `Vault.process` for `vault_update`, and `normalizePath()` on every path the adapter passes to the Vault API.

## Adding a New Tool Module

1. Create a new directory under `src/tools/<module-name>/`
2. Create `index.ts` exporting a factory function that returns a `ToolModule`
3. Define Zod schemas for tool parameters
4. Implement handlers using the `ObsidianAdapter`
5. Write tests using `MockObsidianAdapter`
6. Register the module in `src/main.ts` during `onload()`

See existing modules (e.g., `src/tools/vault/`) for examples.

When you change tool names, descriptions, parameters or error messages, consider running the LLM evaluation in [`evals/`](evals/README.md). It checks that a model can still use the tools to answer questions about a fixture vault. It runs locally only, never in CI (CI only checks the answer key). Compare the score with the last baseline in [`evals/README.md`](evals/README.md#baseline-score), and add a new row when your change is meant to move it.

## Tool surface budget

Every client sends the server instructions and the tool list to the model, so each character of a tool description, parameter description or schema costs tokens in every session. `docs/surface-baseline.json` records how big that surface is, and a test keeps it there.

- **Measure:** `npm run surface:measure` connects a real MCP client to the seeded test server (the same one the tool reference uses) and prints characters and ~tokens (chars / 4) for the server instructions, `tools/list` and `prompts/list`, per part, per module and per tool. "Model view" counts only name, description and input schema per tool, the shape the Anthropic Messages API passes to the model; other clients may pass more. The numbers are for every module enabled (extras included), plus the totals for a fresh install's defaults. The server reports a fixed version, so a release does not change them.
- **Budget:** `tests/scripts/surface/surface-budget.test.ts` (part of `npm test`) compares the measurement with the baseline. Each total and each tool's size may differ from the baseline by 1 % or 40 characters, whichever is larger. The test fails when something grew by more (over budget), when something shrank by more (so the saving is locked in and cannot grow back unnoticed), and when a tool was added or removed.
- **Update the baseline:** when you change tool texts, schemas or the instructions on purpose, run `npm run surface:update` and commit `docs/surface-baseline.json` with the change. After merging `main` into your branch, run it again if the test fails; the file is generated, so take the regenerated version instead of resolving conflicts by hand.
- **Review:** the `test` job summary shows the numbers next to the baseline on `main` and lists the tools that changed size, so reviewers see what a PR adds or saves.

## UI Requirements

### MCP Client Configuration Display

The MCP Client Configuration section in the settings tab must:

- Display the generated JSON configuration in an **editable textarea** (not a read-only `<pre><code>` block)
- Allow users to select, copy, and interact with the configuration text directly
- Provide a **Copy** button to copy the configuration to the clipboard
- Provide a **Regenerate** button to rebuild the configuration from current settings (port, access key)
- Use clean, professional alignment consistent with Obsidian's native settings UI

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `chore:` — Build, CI, dependencies
- `docs:` — Documentation
- `test:` — Tests
- `refactor:` — Code refactoring
- `ci:` — CI/CD changes

## Pull Request Process

1. Create a feature branch from `main`
2. Implement with tests
3. Ensure `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass; run `npm run test:e2e` when the change touches Obsidian behaviour (CI runs it too)
4. Create a PR with a conventional commit title
5. PR is squash-merged to `main`

### CI results

The `CI` workflow runs `lint` first, then `test` and `e2e` in parallel, then `build` once `test` and both `e2e` jobs have passed. A failed job skips the jobs after it. Open a run (the **Details** link of a check on the PR) and look at its **Summary** page:

- **lint** lists every ESLint finding, type error and out-of-date generated doc file. ESLint and `tsc` findings also show up as annotations on the affected lines in the PR's **Files changed** tab.
- **test** shows Vitest's results and a coverage table with the thresholds from `vitest.config.ts`, then the size of the agent-facing surface compared with `docs/surface-baseline.json` on `main` (see [Tool surface budget](#tool-surface-budget)).
- **e2e** runs `npm run test:e2e` in headless Obsidian, once per pinned Obsidian version (`e2e (minimum)`, `e2e (current)`). The two jobs are not required checks themselves, but `build` waits for them, so a failing e2e job skips `build` and blocks the merge.
- **build** runs only after `test` and both `e2e` jobs passed. It shows the size of `main.js` (raw and gzipped) compared with the latest `main` build, and links the artifact `vault-mcp-server-<short-sha>`. It holds `main.js`, `manifest.json` and `styles.css` for 14 days. To try the PR in Obsidian, copy the three files into `<vault>/.obsidian/plugins/vault-mcp-server/` of a test vault and reload the plugin.

The summaries are written by `scripts/ci-summary.ts`. You can run it locally with `npx tsx scripts/ci-summary.ts <command> …`; it prints the Markdown to stdout when `GITHUB_STEP_SUMMARY` is not set.

### Release workflow

`release.yml` runs on every push to `main`, one run at a time (`concurrency`). Its workflow default is `contents: read`; each job asks for what it needs:

- `release-please`: maintains the release PR and, once it is merged, creates the tag and release. Writes with the App token (below); its `GITHUB_TOKEN` has no permissions.
- `build`: only when a release was created. Read-only token, checkout with `persist-credentials: false`, `npm ci` and the build through `.github/actions/setup`, then uploads `main.js`, `manifest.json`, `styles.css`, `versions.json` and `vault-mcp-server-<version>.zip` as the artifact `release-assets` (7 days).
- `publish`: downloads that artifact and attaches the files to the release with `gh release upload --clobber` (`contents: write`). No checkout and no npm, so no dependency code runs with the write token.
- `versions-json`: when the release PR changed, adds its version to `versions.json` on the release branch (App token; no `GITHUB_TOKEN` permissions).

Actions in `release.yml`, `dependabot-auto-merge.yml` and `.github/actions/setup` are pinned by full commit SHA with a `# vX.Y.Z` comment; Dependabot updates the pins.

### Release App token

GitHub starts no workflows for events created with `GITHUB_TOKEN`. So that the release PR gets its required checks and Dependabot auto-merges start the workflows on `main`, these steps use a short-lived installation token of the private GitHub App `KingOfKalk-Release-Bot` (slug `kingofkalk-release-bot`, installed on this repository via [github.com/settings/installations](https://github.com/settings/installations)):

- `release.yml`: release-please (`contents`, `pull-requests` write) and the `versions-json` commit, pushed as `kingofkalk-release-bot[bot]` (`contents` write). `build` (read-only) and `publish` (`contents` write) keep `GITHUB_TOKEN`.
- `dependabot-auto-merge.yml`: `gh pr merge --auto` (`contents`, `pull-requests`, `workflows` write), only for updates that get auto-merged. The metadata lookup and the approval keep `GITHUB_TOKEN` (`contents` read, `pull-requests` write).
- The token comes from `actions/create-github-app-token` with the repository secrets `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`. They exist twice, as Actions and as Dependabot secrets, because Dependabot runs see only Dependabot secrets.
