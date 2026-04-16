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
