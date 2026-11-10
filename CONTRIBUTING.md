# Contributing

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Start dev build: `npm run dev`
4. Copy the built files to your vault's plugin folder for testing

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

- **Requirements:** Linux with Xvfb and the Electron libraries. On Debian trixie or Ubuntu 24.04+ run `bash scripts/install-e2e-deps.sh` (uses `sudo` unless you are root). Node.js 22.23.4 or newer (WebdriverIO 10).
- **Run:** `npm run test:e2e`. It builds the plugin, then runs `xvfb-run -a wdio run ./wdio.conf.mts`. One spec file: `npm run build && xvfb-run -a npx wdio run ./wdio.conf.mts --spec ./e2e/specs/smoke.e2e.ts`. It is not part of `npm test`.
- **What happens:** the service downloads Obsidian into `.obsidian-cache/` (not committed; the first run takes a while) and opens a temporary copy of `tests/vault/` with this checkout as the plugin. Dataview (pinned in `wdio.conf.mts`) is installed from GitHub but starts disabled; `e2e/specs/plugin-tools.e2e.ts` switches it on and off. Each spec file starts from a fresh vault, so a spec that uses editor, workspace or ui tools switches those modules on first with `enableModules` (they are off in a new install). Each spec sets the plugin's settings with `browser.executeObsidian` (`127.0.0.1`, port 28749, Bearer auth with a test key), starts the server, and calls tools with the MCP SDK client over HTTP. Set `E2E_MCP_PORT` if 28749 is taken. Helpers are in `e2e/helpers.ts`.
- **Obsidian version:** pinned so results do not change with an Obsidian update. The default is 1.5.3, the oldest public release at or above the manifest's `minAppVersion` (1.5.0 to 1.5.2 were Insider builds). Pick another one with `OBSIDIAN_VERSION=1.15.0 OBSIDIAN_INSTALLER=1.15.0 npm run test:e2e`. CI runs the default and a pinned current release (the `e2e` job matrix in `.github/workflows/ci.yml`). To change a pinned version, edit `wdio.conf.mts` or the matrix; the CI cache key follows automatically.
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
