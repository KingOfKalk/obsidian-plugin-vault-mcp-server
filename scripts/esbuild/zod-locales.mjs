// esbuild plugin: bundle only zod's English locale (#531).
//
// zod v4 re-exports every translation as `z.locales` (`export * as locales`
// in v4/classic/external.js). esbuild cannot tree-shake a namespace that is
// itself reachable through `import { z } from 'zod'`, so ~260 KB of
// translations end up in main.js although the plugin never calls
// `z.config(z.locales.xx())`. zod's English default does not go through this
// index: v4/classic/schemas.js imports `../locales/en.js` directly.
//
// The plugin loads v4/locales/index.js with only its `en` export. It checks
// the file's shape instead of trusting it: any line that is not a plain
// `export { default as xx } from "./xx.js";`, a missing `en` export, or a
// build in which the file is never loaded (zod moved it) fails the build
// with an error naming this plugin, so a zod update cannot break it
// silently.
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const NAME = 'zod-english-only';
const LOCALES_INDEX = /[\\/]node_modules[\\/]zod[\\/]v4[\\/]locales[\\/]index\.js$/;
const LOCALE_EXPORT = /^export \{ default as ([\w$]+) \} from "\.\/[\w-]+\.js";$/;

/** @returns {import('esbuild').Plugin} */
export function zodEnglishOnly() {
  return {
    name: NAME,
    setup(build) {
      // Not reset per build: watch-mode rebuilds may not load zod again.
      let loaded = false;

      build.onLoad({ filter: LOCALES_INDEX }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const lines = source
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '' && !line.startsWith('//'));
        const unexpected = lines.find((line) => !LOCALE_EXPORT.test(line));
        if (unexpected !== undefined) {
          return {
            errors: [{ text: `${NAME}: unexpected line in ${args.path}: ${unexpected}` }],
          };
        }
        const english = lines.filter((line) => LOCALE_EXPORT.exec(line)?.[1] === 'en');
        if (english.length !== 1) {
          return { errors: [{ text: `${NAME}: no \`en\` export in ${args.path}` }] };
        }
        loaded = true;
        return { contents: `${english[0]}\n`, loader: 'js', resolveDir: dirname(args.path) };
      });

      build.onEnd((result) => {
        if (loaded || result.errors.length > 0) return undefined;
        return {
          errors: [
            {
              text: `${NAME}: zod/v4/locales/index.js was not bundled; update or remove this plugin (scripts/esbuild/zod-locales.mjs)`,
            },
          ],
        };
      });
    },
  };
}
