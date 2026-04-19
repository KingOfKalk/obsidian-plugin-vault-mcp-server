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
      // Thresholds are set a few points below the current coverage floor so
      // meaningful regressions (>~1-2%) fail CI while we ratchet up from
      // here. See GitHub issue #187 for the aspirational targets.
      thresholds: {
        statements: 77,
        branches: 63,
        functions: 79,
        lines: 78,
      },
    },
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
    },
  },
});
