// esbuild plugin: use Obsidian's moment instead of bundling it (#531).
//
// Obsidian hands plugins its own moment instance as `moment` from
// 'obsidian' (the one its core Templates and Daily notes plugins format
// with). Source keeps `import moment from 'moment'`: tests and the tsx
// scripts (docs, evals) run the tool modules outside Obsidian, where
// 'obsidian' has no runtime, and use the npm package. Only the bundle
// swaps it for Obsidian's instance, which saves ~64 KB in main.js.
const NAME = 'obsidian-moment';

/** @returns {import('esbuild').Plugin} */
export function obsidianMoment() {
  return {
    name: NAME,
    setup(build) {
      build.onResolve({ filter: /^moment$/ }, () => ({ path: 'moment', namespace: NAME }));
      build.onLoad({ filter: /.*/, namespace: NAME }, () => ({
        contents: "export { moment as default } from 'obsidian';",
        loader: 'js',
        resolveDir: process.cwd(),
      }));
    },
  };
}
