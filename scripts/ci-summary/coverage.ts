/**
 * Coverage table for the CI `test` job summary (#416). Reads the
 * `json-summary` coverage report and compares it with the thresholds from
 * `vitest.config.ts`.
 */
import { formatInt, table } from './markdown';

export const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'] as const;
export type CoverageMetric = (typeof COVERAGE_METRICS)[number];

export interface MetricTotal {
  pct: number;
  covered: number;
  total: number;
}

export type CoverageTotals = Record<CoverageMetric, MetricTotal>;
export type CoverageThresholds = Partial<Record<CoverageMetric, number>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`coverage summary: ${what} is not a number`);
  }
  return value;
}

/** Parse `coverage/coverage-summary.json`. Throws on malformed input. */
export function parseCoverageSummary(json: string): CoverageTotals {
  const data: unknown = JSON.parse(json);
  if (!isRecord(data) || !isRecord(data.total)) {
    throw new Error('coverage summary: missing "total" entry');
  }
  const total = data.total;
  const read = (metric: CoverageMetric): MetricTotal => {
    const entry = total[metric];
    if (!isRecord(entry)) throw new Error(`coverage summary: missing "${metric}"`);
    return {
      pct: toNumber(entry.pct, `${metric}.pct`),
      covered: toNumber(entry.covered, `${metric}.covered`),
      total: toNumber(entry.total, `${metric}.total`),
    };
  };
  return {
    statements: read('statements'),
    branches: read('branches'),
    functions: read('functions'),
    lines: read('lines'),
  };
}

/**
 * Pull the global coverage thresholds out of a Vitest config object
 * (`test.coverage.thresholds`). Missing or non-numeric values are skipped.
 */
export function readThresholds(config: unknown): CoverageThresholds {
  if (!isRecord(config) || !isRecord(config.test)) return {};
  const coverage = config.test.coverage;
  if (!isRecord(coverage) || !isRecord(coverage.thresholds)) return {};
  const thresholds = coverage.thresholds;
  const result: CoverageThresholds = {};
  for (const metric of COVERAGE_METRICS) {
    const value = thresholds[metric];
    if (typeof value === 'number' && Number.isFinite(value)) result[metric] = value;
  }
  return result;
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatMargin(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${Math.abs(value).toFixed(2)} pp`;
}

export function renderCoverageSummary(
  totals: CoverageTotals,
  thresholds: CoverageThresholds,
): string {
  let failing = 0;
  const rows = COVERAGE_METRICS.map((metric) => {
    const { pct, covered, total } = totals[metric];
    const threshold = thresholds[metric];
    const name = metric.charAt(0).toUpperCase() + metric.slice(1);
    if (threshold === undefined) {
      return [name, formatPct(pct), `${formatInt(covered)} / ${formatInt(total)}`, '—', '—', '—'];
    }
    const ok = pct >= threshold;
    if (!ok) failing++;
    return [
      name,
      formatPct(pct),
      `${formatInt(covered)} / ${formatInt(total)}`,
      `${threshold}%`,
      formatMargin(pct - threshold),
      ok ? '✅' : '❌',
    ];
  });
  const verdict =
    failing === 0
      ? 'All metrics meet the thresholds in `vitest.config.ts`.'
      : `${failing} metric(s) below the thresholds in \`vitest.config.ts\`.`;
  return [
    '## Coverage',
    table(['Metric', 'Coverage', 'Covered', 'Threshold', 'Margin', 'Status'], rows),
    verdict,
  ].join('\n\n');
}
