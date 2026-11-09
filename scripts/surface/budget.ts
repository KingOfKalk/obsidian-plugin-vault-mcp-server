/**
 * Size budget for the agent-facing surface (#450).
 *
 * The committed baseline (`docs/surface-baseline.json`) records the sizes
 * on purpose. A measurement passes when every budgeted number is within a
 * small tolerance of its baseline value:
 *  - **over budget**: a number grew by more than the tolerance;
 *  - **stale baseline**: a number shrank by more than the tolerance, so the
 *    saving is not locked in yet and the texts could grow back unnoticed.
 * Both are fixed by `npm run surface:update` once the change is intended.
 *
 * Budgeted: every total of both views (all tools, defaults), the tool
 * counts, and the full and model-view size of every tool.
 */

import type { SurfaceMeasurement, SurfaceTotals } from './measure';

export const BASELINE_PATH = 'docs/surface-baseline.json';

/** Allowed deviation: the larger of `percent` of the baseline and `minChars`. */
export interface Tolerance {
  percent: number;
  minChars: number;
}

export const DEFAULT_TOLERANCE: Tolerance = { percent: 1, minChars: 40 };

export function allowedDeviation(baseline: number, tolerance: Tolerance): number {
  return Math.max(tolerance.minChars, Math.ceil((baseline * tolerance.percent) / 100));
}

export type BudgetProblem =
  | { kind: 'over'; item: string; current: number; baseline: number; allowed: number }
  | { kind: 'under'; item: string; current: number; baseline: number; allowed: number }
  | { kind: 'new-tool'; item: string }
  | { kind: 'removed-tool'; item: string }
  | { kind: 'tool-count'; item: string; current: number; baseline: number };

function compare(
  item: string,
  current: number,
  baseline: number,
  tolerance: Tolerance,
): BudgetProblem | null {
  const allowed = allowedDeviation(baseline, tolerance);
  if (current > baseline + allowed) return { kind: 'over', item, current, baseline, allowed };
  if (current < baseline - allowed) return { kind: 'under', item, current, baseline, allowed };
  return null;
}

function compareTotals(
  view: string,
  current: SurfaceTotals,
  baseline: SurfaceTotals,
  tolerance: Tolerance,
): BudgetProblem[] {
  const problems: BudgetProblem[] = [];
  for (const key of Object.keys(baseline) as (keyof SurfaceTotals)[]) {
    const p = compare(`${view}.totals.${key}`, current[key], baseline[key], tolerance);
    if (p) problems.push(p);
  }
  return problems;
}

/** Every budget problem of `current` against `baseline`; empty when it passes. */
export function checkBudget(
  current: SurfaceMeasurement,
  baseline: SurfaceMeasurement,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): BudgetProblem[] {
  const problems: BudgetProblem[] = [];
  for (const view of ['all', 'defaults'] as const) {
    if (current[view].toolCount !== baseline[view].toolCount) {
      problems.push({
        kind: 'tool-count',
        item: `${view}.toolCount`,
        current: current[view].toolCount,
        baseline: baseline[view].toolCount,
      });
    }
    problems.push(...compareTotals(view, current[view].totals, baseline[view].totals, tolerance));
  }
  for (const [name, tool] of Object.entries(current.all.tools)) {
    const base = baseline.all.tools[name];
    if (base === undefined) {
      problems.push({ kind: 'new-tool', item: name });
      continue;
    }
    for (const key of ['toolsList', 'modelView'] as const) {
      const p = compare(`${name}.${key}`, tool[key], base[key], tolerance);
      if (p) problems.push(p);
    }
  }
  for (const name of Object.keys(baseline.all.tools)) {
    if (current.all.tools[name] === undefined) problems.push({ kind: 'removed-tool', item: name });
  }
  return problems;
}

export function describeProblem(problem: BudgetProblem): string {
  switch (problem.kind) {
    case 'over':
      return `${problem.item}: ${problem.current} chars, over budget (baseline ${problem.baseline} + ${problem.allowed})`;
    case 'under':
      return `${problem.item}: ${problem.current} chars, below baseline ${problem.baseline} - ${problem.allowed}; lock in the saving`;
    case 'new-tool':
      return `${problem.item}: new tool, not in the baseline`;
    case 'removed-tool':
      return `${problem.item}: in the baseline but no longer listed`;
    case 'tool-count':
      return `${problem.item}: ${problem.current} tools, baseline has ${problem.baseline}`;
  }
}

/** Failure message for the budget test. */
export function formatProblems(problems: readonly BudgetProblem[]): string {
  return [
    `The agent-facing surface does not match ${BASELINE_PATH} within the tolerance:`,
    ...problems.map((p) => `  - ${describeProblem(p)}`),
    'If the change is intended, run `npm run surface:update` and commit the baseline.',
  ].join('\n');
}
