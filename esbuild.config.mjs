import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import process from 'process';
import { zodEnglishOnly } from './scripts/esbuild/zod-locales.mjs';

const production = process.argv[2] === 'production';

// Node's built-in modules, bare and `node:`-prefixed (some exist only
// prefixed, e.g. `node:test`, and are listed that way).
const builtins = builtinModules.flatMap((name) =>
  name.startsWith('node:') ? [name] : [name, `node:${name}`],
);

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
  ],
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: production,
  platform: 'node',
  plugins: [zodEnglishOnly()],
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
