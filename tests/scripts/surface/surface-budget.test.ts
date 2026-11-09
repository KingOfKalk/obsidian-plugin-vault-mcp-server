/**
 * Size budget of the agent-facing surface (#450). Measures `instructions`,
 * `tools/list` and `prompts/list` through a real SDK client and compares
 * them with the committed `docs/surface-baseline.json`.
 *
 * When this fails because a tool text changed on purpose, run
 * `npm run surface:update` and commit the baseline (CONTRIBUTING.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { BASELINE_PATH, checkBudget, formatProblems } from '../../../scripts/surface/budget';
import { measureSurface } from '../../../scripts/surface/collect';
import { parseSurface, toBaselineJson } from '../../../scripts/surface/measure';

const ROOT = join(__dirname, '..', '..', '..');

describe('agent-facing surface budget', () => {
  it('stays within the tolerance of the committed baseline', async () => {
    const baseline = parseSurface(readFileSync(join(ROOT, BASELINE_PATH), 'utf8'));
    expect(baseline, `${BASELINE_PATH} is missing or invalid`).not.toBeNull();
    if (baseline === null) return;

    const current = await measureSurface();
    const problems = checkBudget(current, baseline);
    expect(problems, formatProblems(problems)).toEqual([]);
  });

  it('measures the same numbers on every run', async () => {
    const first = toBaselineJson(await measureSurface());
    const second = toBaselineJson(await measureSurface());
    expect(second).toBe(first);
  });
});
