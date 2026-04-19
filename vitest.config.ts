import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // adapter.ts is a thin Obsidian API wrapper; its 449 lines bind to
      // Obsidian's runtime and require a real app. Leaving it out until we
      // can drive Obsidian headlessly; everything else is in scope.
      exclude: ['src/obsidian/adapter.ts'],
      // Thresholds ratchet upward as coverage grows. The aim is to catch
      // meaningful regressions (~1-2%) without flapping on small changes,
      // and to close the gap with the aspirational 75/85/85/85 target over
      // a handful of PRs. Current floor on main: ~78/67/79/79 with the
      // makeResponse rollout landed; numbers below are the floor minus a
      // small buffer. See GitHub issues #187 + #218 for the history.
      thresholds: {
        statements: 78,
        branches: 66,
        functions: 79,
        lines: 79,
      },
    },
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
    },
  },
});
