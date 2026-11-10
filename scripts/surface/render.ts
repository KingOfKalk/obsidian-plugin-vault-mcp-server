/**
 * Markdown tables for the surface measurement (#450): the report printed by
 * `npm run surface:measure` and the CI job summary (`scripts/ci-summary.ts
 * surface`).
 */

import { code, details, formatInt, table } from '../ci-summary/markdown';
import {
  BASELINE_PATH,
  DEFAULT_TOLERANCE,
  describeProblem,
  type BudgetProblem,
  type Tolerance,
} from './budget';
import { approxTokens, type SurfaceMeasurement, type SurfaceTotals } from './measure';

/** Rows of the parts table, in display order. */
export const TOTAL_ROWS: readonly [keyof SurfaceTotals, string][] = [
  ['toolsList', '`tools/list` total (compact JSON)'],
  ['modelView', 'Model view (name + description + input schema)'],
  ['toolDescriptions', 'Tool descriptions'],
  ['inputSchemaDescriptions', 'Input schema descriptions'],
  ['inputSchemas', 'Input schemas total'],
  ['outputSchemas', 'Output schemas total'],
  ['instructions', 'Server instructions'],
  ['promptsList', '`prompts/list` total'],
];

function n(value: number): string {
  return formatInt(value);
}

function tok(chars: number): string {
  return `~${formatInt(approxTokens(chars))}`;
}

/** Signed difference in characters, with the percentage of `baseline`. */
export function formatCharDelta(current: number, baseline: number): string {
  const diff = current - baseline;
  if (diff === 0) return '±0';
  const sign = diff > 0 ? '+' : '−';
  const pct = baseline === 0 ? '' : ` (${sign}${Math.abs((diff / baseline) * 100).toFixed(1)}%)`;
  return `${sign}${formatInt(Math.abs(diff))}${pct}`;
}

export function renderTotalsTable(m: SurfaceMeasurement): string {
  return table(
    ['Part', 'chars', '~tokens', `Defaults (${m.defaults.toolCount} tools) chars`, '~tokens'],
    TOTAL_ROWS.map(([key, label]) => [
      label,
      n(m.all.totals[key]),
      tok(m.all.totals[key]),
      n(m.defaults.totals[key]),
      tok(m.defaults.totals[key]),
    ]),
  );
}

export function renderModulesTable(m: SurfaceMeasurement): string {
  const modules = Object.entries(m.all.modules).sort((a, b) => b[1].toolsList - a[1].toolsList);
  return table(
    ['Module', 'Tools', '`tools/list` chars', '~tokens', 'Model view chars', '~tokens'],
    modules.map(([id, s]) => [
      code(id),
      String(s.tools),
      n(s.toolsList),
      tok(s.toolsList),
      n(s.modelView),
      tok(s.modelView),
    ]),
  );
}

export function renderToolsTable(m: SurfaceMeasurement, limit = Infinity): string {
  const tools = Object.entries(m.all.tools)
    .sort((a, b) => b[1].toolsList - a[1].toolsList || a[0].localeCompare(b[0]))
    .slice(0, limit);
  return table(
    ['Tool', 'Module', '`tools/list` chars', '~tokens', 'Model view chars', '~tokens'],
    tools.map(([name, s]) => [
      code(name),
      code(s.module),
      n(s.toolsList),
      tok(s.toolsList),
      n(s.modelView),
      tok(s.modelView),
    ]),
  );
}

const ASSUMPTION =
  'Model view assumes the client passes only name, description and input schema to the model (the Anthropic Messages API tool shape); clients may differ. ~tokens = chars / 4.';

/** The full report printed by `npm run surface:measure`. */
export function renderSurfaceReport(m: SurfaceMeasurement): string {
  return [
    '## Agent-facing surface',
    `All ${m.all.toolCount} tools enabled (extras included); a fresh install enables ${m.defaults.toolCount} (editor, workspace, ui and extras off, empty command allowlist, Dataview enabled). ${ASSUMPTION}`,
    renderTotalsTable(m),
    '### Per module (all tools)',
    renderModulesTable(m),
    '### Per tool (all tools, largest first)',
    renderToolsTable(m),
  ].join('\n\n');
}

export interface SurfaceSummaryInput {
  current: SurfaceMeasurement;
  /** The committed baseline of the checked-out tree; the budget. */
  baseline: SurfaceMeasurement | null;
  /** `docs/surface-baseline.json` on `main`, to show what a PR changes. */
  main: SurfaceMeasurement | null;
  problems: readonly BudgetProblem[];
  tolerance?: Tolerance;
}

function comparisonTable(current: SurfaceMeasurement, ref: SurfaceMeasurement): string {
  return table(
    ['Part', 'This run', '~tokens', 'Baseline on `main`', 'Difference'],
    TOTAL_ROWS.map(([key, label]) => [
      label,
      n(current.all.totals[key]),
      tok(current.all.totals[key]),
      n(ref.all.totals[key]),
      formatCharDelta(current.all.totals[key], ref.all.totals[key]),
    ]),
  );
}

function changedToolsTable(current: SurfaceMeasurement, ref: SurfaceMeasurement): string | null {
  const names = [
    ...new Set([...Object.keys(current.all.tools), ...Object.keys(ref.all.tools)]),
  ].sort();
  const rows: string[][] = [];
  for (const name of names) {
    const now = current.all.tools[name];
    const before = ref.all.tools[name];
    const nowFull = now?.toolsList ?? 0;
    const beforeFull = before?.toolsList ?? 0;
    const nowModel = now?.modelView ?? 0;
    const beforeModel = before?.modelView ?? 0;
    if (nowFull === beforeFull && nowModel === beforeModel) continue;
    rows.push([
      code(name),
      before === undefined ? '_new_' : n(beforeFull),
      now === undefined ? '_removed_' : n(nowFull),
      formatCharDelta(nowFull, beforeFull),
      formatCharDelta(nowModel, beforeModel),
    ]);
  }
  if (rows.length === 0) return null;
  return table(
    ['Tool', '`main` chars', 'This run chars', 'Difference', 'Model view difference'],
    rows,
  );
}

function renderBudget(input: SurfaceSummaryInput): string {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const rule = `tolerance: ${tolerance.percent}% or ${tolerance.minChars} chars, whichever is larger`;
  if (input.baseline === null) {
    return `> ❌ No valid ${code(BASELINE_PATH)} found; nothing to check the budget against.`;
  }
  if (input.problems.length === 0) {
    return `✅ Within the budget of ${code(BASELINE_PATH)} (${rule}).`;
  }
  return [
    `❌ Does not match ${code(BASELINE_PATH)} (${rule}). If the change is intended, run \`npm run surface:update\` and commit the baseline.`,
    input.problems.map((p) => `- ${describeProblem(p)}`).join('\n'),
  ].join('\n\n');
}

/** The `test` job summary section. */
export function renderSurfaceSummary(input: SurfaceSummaryInput): string {
  const { current, main } = input;
  const parts = ['## Agent-facing surface', ASSUMPTION];
  if (main === null) {
    parts.push(
      renderTotalsTable(current),
      `> No ${code(BASELINE_PATH)} on \`main\` yet, so there is nothing to compare against.`,
    );
  } else {
    parts.push(comparisonTable(current, main));
    const changed = changedToolsTable(current, main);
    parts.push(
      changed === null
        ? 'No tool changed size against `main`.'
        : details('Tools that changed size against <code>main</code>', changed, true),
    );
  }
  parts.push('### Budget', renderBudget(input));
  parts.push(
    details('Per module', renderModulesTable(current)),
    details('Per tool', renderToolsTable(current)),
  );
  return parts.join('\n\n');
}
