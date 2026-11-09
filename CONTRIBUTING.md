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
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format with Prettier |
| `npm run typecheck` | TypeScript type checking |
| `npm run eval` | LLM evaluation of the MCP tools (needs `ANTHROPIC_API_KEY`, costs money; see [`evals/README.md`](evals/README.md)) |

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

When you change tool names, descriptions, parameters or error messages, consider running the LLM evaluation in [`evals/`](evals/README.md). It checks that a model can still use the tools to answer questions about a fixture vault.

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
3. Ensure `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass
4. Create a PR with a conventional commit title
5. PR is squash-merged to `main`

### CI results

The `CI` workflow runs `lint`, `test` and `build` one after another. Open a run (the **Details** link of a check on the PR) and look at its **Summary** page:

- **lint** lists every ESLint finding, type error and out-of-date generated doc file. ESLint and `tsc` findings also show up as annotations on the affected lines in the PR's **Files changed** tab.
- **test** shows Vitest's results and a coverage table with the thresholds from `vitest.config.ts`.
- **build** shows the size of `main.js` (raw and gzipped) compared with the latest `main` build, and links the artifact `vault-mcp-server-<short-sha>`. It holds `main.js`, `manifest.json` and `styles.css` for 14 days. To try the PR in Obsidian, copy the three files into `<vault>/.obsidian/plugins/vault-mcp-server/` of a test vault and reload the plugin.

The summaries are written by `scripts/ci-summary.ts`. You can run it locally with `npx tsx scripts/ci-summary.ts <command> …`; it prints the Markdown to stdout when `GITHUB_STEP_SUMMARY` is not set.
