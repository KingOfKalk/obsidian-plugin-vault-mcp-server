import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'main.js', 'node_modules/', 'esbuild.config.mjs', 'eslint.config.mjs', 'vitest.config.ts', 'wdio.conf.mts', '.obsidian-cache/'],
  },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        // e2e/ has its own tsconfig (WebdriverIO + Mocha globals, #441).
        project: ['./tsconfig.json', './e2e/tsconfig.json'],
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'warn',
    },
  },
);
