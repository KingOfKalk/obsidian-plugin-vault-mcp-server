/**
 * The production build keeps only zod's English locale (#531): zod's
 * `export * as locales` pulls every translation into main.js, and the
 * plugin never switches zod's locale. These tests bundle a small entry the
 * way `esbuild.config.mjs` does, with and without the plugin, and run it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Plugin } from 'esbuild';
import { describe, it, expect } from 'vitest';
import { zodEnglishOnly } from '../../scripts/esbuild/zod-locales.mjs';

const ROOT = join(__dirname, '..', '..');

const ENTRY = `
import { z } from 'zod';
const result = z.object({ name: z.string().min(2) }).safeParse({ name: 1 });
export const message = result.success ? '' : result.error.issues[0].message;
export const locales = Object.keys(z.locales);
`;

interface Bundled {
  message: string;
  locales: string[];
  size: number;
}

async function bundle(plugins: Plugin[]): Promise<Bundled> {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    minify: true,
    logLevel: 'silent',
    plugins,
  });
  const code = result.outputFiles[0].text;
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(code, { module, exports: module.exports });
  return {
    message: module.exports.message as string,
    locales: module.exports.locales as string[],
    size: code.length,
  };
}

describe('zodEnglishOnly esbuild plugin (#531)', () => {
  it('keeps the English validation messages and drops the other locales', async () => {
    const [full, english] = await Promise.all([bundle([]), bundle([zodEnglishOnly()])]);

    expect(full.locales).toContain('de');
    expect(english.locales).toEqual(['en']);
    expect(english.message).toBe('Invalid input: expected string, received number');
    expect(english.message).toBe(full.message);
    expect(full.size - english.size).toBeGreaterThan(100_000);
  });

  it('fails the build when the locales index has a shape it does not know', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zod-locales-'));
    try {
      const locales = join(dir, 'node_modules', 'zod', 'v4', 'locales');
      await mkdir(locales, { recursive: true });
      await writeFile(join(locales, 'en.js'), 'export default () => ({});\n');
      await writeFile(
        join(locales, 'index.js'),
        'export { default as en } from "./en.js";\nexport * from "./more.js";\n',
      );
      await expect(
        build({
          stdin: {
            contents: "export * from './node_modules/zod/v4/locales/index.js';",
            resolveDir: dir,
          },
          bundle: true,
          write: false,
          logLevel: 'silent',
          plugins: [zodEnglishOnly()],
        }),
      ).rejects.toThrow(/zod-english-only: unexpected line .*export \* from "\.\/more\.js";/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails the build when zod is never bundled, instead of silently doing nothing', async () => {
    await expect(
      build({
        stdin: { contents: 'export const x = 1;', resolveDir: ROOT, loader: 'ts' },
        bundle: true,
        write: false,
        logLevel: 'silent',
        plugins: [zodEnglishOnly()],
      }),
    ).rejects.toThrow(/zod-english-only/);
  });
});
