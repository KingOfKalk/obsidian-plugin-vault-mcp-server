import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  globalIgnores([
    'dist/',
    'main.js',
    'node_modules/',
    'esbuild.config.mjs',
    'scripts/esbuild/',
    'eslint.config.mjs',
    'vitest.config.ts',
    'wdio.conf.mts',
    '.obsidian-cache/',
  ]),
  // The Obsidian review checks (#557): the lint plugin's recommended config,
  // which brings typescript-eslint's recommendedTypeChecked rules too. Its
  // rules for code that runs in Obsidian (window timers, `createEl`, the
  // console policy, …) stay off for tests/, scripts/ and e2e/, as in the
  // community scanner.
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        // e2e/ has its own tsconfig (WebdriverIO + Mocha globals, #441).
        project: ['./tsconfig.json', './e2e/tsconfig.json'],
      },
    },
    // Our stricter rules. The recommended config lowers or switches off a
    // few typescript-eslint rules we have always enforced; they stay errors.
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      'prefer-const': 'error',
    },
  },
  // Code that never runs in Obsidian and that the community scanner does not
  // review as plugin source: unit and E2E tests, scripts, and the LLM evals
  // (Node CLIs; whether the scanner skips evals/ is open, #556 F13). They may
  // use Node's timers, `fetch`, the npm `moment` and deprecated Zod types,
  // and disable rules where test doubles need it, as before #557.
  {
    files: ['tests/**', 'scripts/**', 'evals/**', 'e2e/**'],
    rules: {
      'eslint-comments/no-restricted-disable': 'off',
      'eslint-comments/require-description': 'off',
      'eslint-comments/disable-enable-pair': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'obsidianmd/prefer-window-timers': 'off',
    },
  },
  // What the community scanner reports as errors on top of the recommended
  // config, for the plugin source (eslint-plugin-obsidianmd
  // docs/configuration.md: "Community plugin scanner configuration" and its
  // newest "Rule severity adjustments" layer).
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-eval': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'obsidianmd/regex-lookbehind': 'error',
      'obsidianmd/no-forbidden-elements': 'error',
      'obsidianmd/settings-tab/no-manual-html-headings': 'error',
      'obsidianmd/settings-tab/no-problematic-settings-headings': 'error',
      'obsidianmd/sample-names': 'error',
      'obsidianmd/no-sample-code': 'error',
      'obsidianmd/platform': 'error',
      'obsidianmd/no-plugin-as-component': 'error',
      'obsidianmd/detach-leaves': 'error',
      'obsidianmd/no-static-styles-assignment': 'error',
      'obsidianmd/no-view-references-in-plugin': 'error',
      'obsidianmd/no-unsupported-api': 'error',
    },
  },
]);
