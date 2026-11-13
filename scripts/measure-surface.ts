/**
 * Measure the agent-facing surface (#450): server `instructions`,
 * `tools/list` and `prompts/list` as a real SDK client receives them, per
 * part, module and tool, in characters and ~tokens (chars / 4).
 *
 *   npm run surface:measure                    print the report
 *   npm run surface:update                     also rewrite docs/surface-baseline.json
 *   tsx scripts/measure-surface.ts --json <f>  also write the measurement to <f>
 *
 * The budget against the committed baseline is checked by
 * tests/scripts/surface-budget.test.ts.
 */

import { writeFileSync } from 'node:fs';
import { argv, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { measureSurface } from './surface/collect';
import { toBaselineJson } from './surface/measure';
import { renderSurfaceReport } from './surface/render';

async function main(): Promise<void> {
  const { values } = parseArgs({ args: argv.slice(2), options: { json: { type: 'string' } } });
  const measurement = await measureSurface();
  stdout.write(`${renderSurfaceReport(measurement)}\n`);
  if (values.json !== undefined) {
    writeFileSync(values.json, toBaselineJson(measurement));
    stdout.write(`\nWrote ${values.json}\n`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
