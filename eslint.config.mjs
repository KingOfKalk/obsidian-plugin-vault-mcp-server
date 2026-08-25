import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const typescript6 = require('typescript-6');
const originalLoad = Module._load;

// Temporary compatibility shim for TypeScript 7. Remove once typescript-eslint
// supports TS >= 7.1 (tracked in https://github.com/typescript-eslint/typescript-eslint/issues/10940).
Module._load = function patchedLoad(request, parent, isMain) {
  const normalizedFilename = parent?.filename?.replaceAll('\\', '/');

  if (
    request === 'typescript' &&
    (normalizedFilename?.includes('/node_modules/typescript-eslint/') ||
      normalizedFilename?.includes('/node_modules/@typescript-eslint/') ||
      normalizedFilename?.includes('/node_modules/ts-api-utils/'))
  ) {
    return typescript6;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { default: tseslint } = await import('typescript-eslint');

export default tseslint.config(
  {
    ignores: ['dist/', 'main.js', 'node_modules/', 'esbuild.config.mjs', 'eslint.config.mjs', 'vitest.config.ts'],
  },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
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
