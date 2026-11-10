/**
 * The production build takes moment from Obsidian instead of bundling the
 * npm package (#531). Source keeps `import moment from 'moment'`, so tests
 * and the tsx scripts (docs, evals), which run outside Obsidian, use the
 * real package. These tests bundle a small entry the way
 * `esbuild.config.mjs` does and run it against a fake `obsidian` module.
 */
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type Plugin } from 'esbuild';
import { describe, it, expect } from 'vitest';
import { obsidianMoment } from '../../scripts/esbuild/obsidian-moment.mjs';

const ROOT = join(__dirname, '..', '..');

const ENTRY = `
import moment from 'moment';
export const instance = moment;
export const formatted = moment('2026-05-05', 'YYYY-MM-DD', true).format('dddd');
`;

interface Bundled {
  code: string;
  exports: Record<string, unknown>;
  obsidianMoment: unknown;
}

async function bundle(plugins: Plugin[]): Promise<Bundled> {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    external: ['obsidian'],
    logLevel: 'silent',
    plugins,
  });
  const code = result.outputFiles[0].text;
  const fakeMoment = (): { format: () => string } => ({ format: (): string => 'from Obsidian' });
  const module = { exports: {} as Record<string, unknown> };
  const require = (id: string): unknown => {
    if (id === 'obsidian') return { moment: fakeMoment };
    throw new Error(`unexpected require: ${id}`);
  };
  runInNewContext(code, { module, exports: module.exports, require });
  return { code, exports: module.exports, obsidianMoment: fakeMoment };
}

describe('obsidianMoment esbuild plugin (#531)', () => {
  it("resolves `import moment from 'moment'` to Obsidian's moment", async () => {
    const bundled = await bundle([obsidianMoment()]);
    const { code, exports } = bundled;

    expect(exports.instance).toBe(bundled.obsidianMoment);
    expect(exports.formatted).toBe('from Obsidian');
    expect(code).not.toContain('momentProperties');
  });

  it('bundles the npm package without the plugin', async () => {
    const { code, exports } = await bundle([]);

    expect(exports.formatted).toBe('Tuesday');
    expect(code).toContain('momentProperties');
  });
});
