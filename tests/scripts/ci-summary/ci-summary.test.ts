import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ANNOTATIONS_PER_LEVEL,
  formatAnnotation,
  renderAnnotations,
  type Annotation,
} from '../../../scripts/ci-summary/annotations';
import {
  formatDelta,
  measureBundle,
  parseBundleSize,
  renderBuildSummary,
  type BundleSize,
} from '../../../scripts/ci-summary/build';
import {
  parseCoverageSummary,
  readThresholds,
  renderCoverageSummary,
} from '../../../scripts/ci-summary/coverage';
import {
  DOCS_DIFF_LINES,
  eslintAnnotations,
  parseDocsCheckOutput,
  parseEslintReport,
  parseTscOutput,
  renderLintSummary,
  tscAnnotations,
  type EslintFinding,
} from '../../../scripts/ci-summary/lint';
import { DEFAULT_CAP, code, escapeText, toOutcome } from '../../../scripts/ci-summary/markdown';
import vitestConfig from '../../../vitest.config';

const ROOT = '/home/runner/work/repo/repo';
const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function manyFindings(count: number): EslintFinding[] {
  return Array.from({ length: count }, (_, i) => ({
    file: `src/file-${i % 3}.ts`,
    line: i + 1,
    column: 1,
    severity: 'error' as const,
    rule: 'no-var',
    message: `finding ${i}`,
  }));
}

describe('markdown helpers', () => {
  it('escapes Markdown and HTML in messages and joins lines', () => {
    expect(escapeText('Type <T> | *x* `y`\n  next')).toBe(
      'Type &lt;T&gt; \\| \\*x\\* \\`y\\` next',
    );
  });

  it('builds code spans that survive backticks', () => {
    expect(code('a`b')).toBe('``a`b``');
    expect(code('plain')).toBe('`plain`');
  });

  it('maps unknown step outcomes to skipped', () => {
    expect(toOutcome('failure')).toBe('failure');
    expect(toOutcome('')).toBe('skipped');
    expect(toOutcome(undefined)).toBe('skipped');
  });
});

describe('annotations', () => {
  it('formats a file annotation with escaped properties and data', () => {
    expect(
      formatAnnotation({
        level: 'error',
        file: 'src/a,b.ts',
        line: 3,
        col: 5,
        title: 'tsc TS2322',
        message: '100% wrong\nsecond line',
      }),
    ).toBe('::error file=src/a%2Cb.ts,line=3,col=5,title=tsc TS2322::100%25 wrong%0Asecond line');
  });

  it('formats an annotation without a location', () => {
    expect(formatAnnotation({ level: 'warning', message: 'x: y' })).toBe('::warning::x: y');
  });

  it('caps annotations per level and adds a notice for the rest', () => {
    const list: Annotation[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ level: 'error' as const, message: `e${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ level: 'warning' as const, message: `w${i}` })),
    ];
    const lines = renderAnnotations(list);
    expect(lines.filter((l) => l.startsWith('::error'))).toHaveLength(ANNOTATIONS_PER_LEVEL);
    expect(lines.filter((l) => l.startsWith('::warning'))).toHaveLength(3);
    expect(lines[lines.length - 1]).toMatch(/^::notice title=More findings::2 more finding/);
  });

  it('adds no notice when everything fits', () => {
    expect(renderAnnotations([{ level: 'error', message: 'x' }])).toEqual(['::error::x']);
  });
});

describe('ESLint report', () => {
  const findings = parseEslintReport(fixture('eslint-report.json'), ROOT);

  it('parses findings with repo-relative paths', () => {
    expect(findings).toHaveLength(3);
    expect(findings[0]).toEqual({
      file: 'src/main.ts',
      line: 12,
      column: 7,
      endLine: 12,
      endColumn: 13,
      severity: 'error',
      rule: '@typescript-eslint/no-unused-vars',
      message: "'unused' is assigned a value but never used.",
    });
    expect(findings[1].severity).toBe('warning');
    expect(findings[2]).toMatchObject({ file: 'tests/broken.test.ts', rule: null });
  });

  it('keeps paths outside the root as they are', () => {
    const json = JSON.stringify([
      {
        filePath: '/elsewhere/x.ts',
        messages: [{ severity: 1, message: 'm', line: 1, column: 1 }],
      },
    ]);
    expect(parseEslintReport(json, ROOT)[0].file).toBe('/elsewhere/x.ts');
  });

  it('rejects a report that is not an array', () => {
    expect(() => parseEslintReport('{}', ROOT)).toThrow(/not a JSON array/);
  });

  it('turns findings into annotations', () => {
    const lines = renderAnnotations(eslintAnnotations(findings));
    expect(lines).toContain(
      "::error file=src/main.ts,line=12,endLine=12,col=7,endColumn=13,title=ESLint (@typescript-eslint/no-unused-vars)::'unused' is assigned a value but never used.",
    );
    expect(lines).toContain(
      '::warning file=src/main.ts,line=30,endLine=30,col=3,endColumn=14,title=ESLint (no-console)::Unexpected console statement.',
    );
    expect(lines).toContain(
      "::error file=tests/broken.test.ts,line=4,col=18,title=ESLint::Parsing error: ',' expected.",
    );
  });
});

describe('tsc output', () => {
  const errors = parseTscOutput(fixture('tsc-output.txt'), ROOT);

  it('parses file errors, continuation lines and global errors', () => {
    expect(errors).toHaveLength(3);
    expect(errors[0]).toEqual({
      file: 'src/main.ts',
      line: 12,
      column: 7,
      code: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'.",
    });
    expect(errors[1].message).toContain('\nObject literal may only specify known properties');
    expect(errors[2]).toEqual({
      code: 'TS5083',
      message: "Cannot read file '/home/runner/work/repo/repo/tsconfig.base.json'.",
    });
  });

  it('returns no errors for clean output', () => {
    expect(parseTscOutput('', ROOT)).toEqual([]);
  });

  it('turns errors into annotations', () => {
    const lines = renderAnnotations(tscAnnotations(errors));
    expect(lines[0]).toBe(
      "::error file=src/main.ts,line=12,col=7,title=tsc TS2322::Type 'string' is not assignable to type 'number'.",
    );
    expect(lines[2]).toBe(
      "::error title=tsc TS5083::Cannot read file '/home/runner/work/repo/repo/tsconfig.base.json'.",
    );
  });
});

describe('docs:check output', () => {
  it('lists differing files and keeps the diff from its first line', () => {
    const result = parseDocsCheckOutput(fixture('docs-check-output.txt'));
    expect(result.files).toEqual(['docs/tools.generated.md']);
    expect(result.excerpt[0]).toMatch(/^--- docs\/tools.generated.md/);
    expect(result.excerpt).toContain('+| vault | 21 |');
  });

  it('handles diff -r output with files only on one side', () => {
    const out = [
      'diff -ru docs/tools/vault.md /tmp/tools.check/tools/vault.md',
      '--- docs/tools/vault.md\t2026-11-09',
      '+++ /tmp/tools.check/tools/vault.md\t2026-11-09',
      'Only in /tmp/tools.check/tools/: graph.md',
    ].join('\n');
    expect(parseDocsCheckOutput(out).files).toEqual([
      'docs/tools/vault.md',
      '/tmp/tools.check/tools/graph.md',
    ]);
  });

  it('caps the excerpt and records the full length', () => {
    const out = ['--- a', '+++ b', ...Array.from({ length: 100 }, (_, i) => `+line ${i}`)].join(
      '\n',
    );
    const result = parseDocsCheckOutput(out);
    expect(result.excerpt).toHaveLength(DOCS_DIFF_LINES);
    expect(result.totalLines).toBe(102);
  });

  it('falls back to the tail of the log when there is no diff', () => {
    const result = parseDocsCheckOutput('Error: something broke\n    at x\n');
    expect(result.files).toEqual([]);
    expect(result.excerpt).toEqual(['Error: something broke', '    at x']);
  });
});

describe('lint summary', () => {
  const findings = parseEslintReport(fixture('eslint-report.json'), ROOT);
  const errors = parseTscOutput(fixture('tsc-output.txt'), ROOT);
  const docs = parseDocsCheckOutput(fixture('docs-check-output.txt'));

  it('renders the overview table and the details of every tool', () => {
    const md = renderLintSummary({
      eslint: { outcome: 'failure', findings },
      tsc: { outcome: 'failure', errors },
      docs: { outcome: 'failure', result: docs },
    });
    expect(md).toContain('| ESLint | ❌ failed | 2 errors, 1 warning |');
    expect(md).toContain('| Typecheck | ❌ failed | 3 errors |');
    expect(md).toContain('| docs:check | ❌ failed | 1 file out of date |');
    expect(md).toContain('**2 errors, 1 warning in 2 files**');
    expect(md).toContain('**`src/main.ts`**');
    expect(md).toContain(
      "- `src/main.ts:12:7` **error** `@typescript-eslint/no-unused-vars`: 'unused' is assigned a value but never used.",
    );
    expect(md).toContain('- `tests/broken.test.ts:4:18` **error** _(no rule)_');
    expect(md).toContain(
      "- `src/main.ts(12,7)`: **TS2322**: Type 'string' is not assignable to type 'number'.",
    );
    expect(md).toContain('- `(global)`: **TS5083**');
    expect(md).toContain('- `docs/tools.generated.md`');
    expect(md).toContain('Run `npm run docs:tools`');
    expect(md).toContain('```diff\n--- docs/tools.generated.md');
  });

  it('renders a clean run', () => {
    const md = renderLintSummary({
      eslint: { outcome: 'success', findings: [] },
      tsc: { outcome: 'success', errors: [] },
      docs: { outcome: 'success', result: null },
    });
    expect(md).toContain('| ESLint | ✅ passed | 0 errors, 0 warnings |');
    expect(md).toContain('| docs:check | ✅ passed | in sync |');
    expect(md).toContain('No findings.');
    expect(md).toContain('No errors.');
    expect(md).toContain('Generated tool docs are in sync.');
    expect(md).not.toContain('<details');
  });

  it('reports missing reports and skipped steps', () => {
    const md = renderLintSummary({
      eslint: { outcome: 'failure', findings: null },
      tsc: { outcome: 'skipped', errors: null },
      docs: { outcome: 'cancelled', result: null },
    });
    expect(md).toContain('| ESLint | ❌ failed | no report |');
    expect(md).toContain('No report was produced. See the step log.');
    expect(md).toContain('| Typecheck | ⏭️ not run | — |');
    expect(md).toContain('_Not run._');
    expect(md).toContain('_Cancelled._');
  });

  it(`truncates long lists at the cap (${DEFAULT_CAP}) inside a collapsible block`, () => {
    const md = renderLintSummary({
      eslint: { outcome: 'failure', findings: manyFindings(DEFAULT_CAP + 7) },
      tsc: { outcome: 'success', errors: [] },
      docs: { outcome: 'success', result: null },
    });
    expect(md.match(/^- `src\/file-/gm)).toHaveLength(DEFAULT_CAP);
    expect(md).toContain('_…and 7 more not shown. Run `npm run lint` locally for the full list._');
    expect(md).toContain('<details>\n<summary>Findings</summary>');
    expect(md).toContain(`finding ${DEFAULT_CAP - 1}`);
    expect(md).not.toContain(`finding ${DEFAULT_CAP}\n`);
  });

  it('honours a custom cap for tsc errors', () => {
    const md = renderLintSummary({
      eslint: { outcome: 'success', findings: [] },
      tsc: { outcome: 'failure', errors },
      docs: { outcome: 'success', result: null },
      cap: 1,
    });
    expect(md.match(/\*\*TS\d+\*\*/g)).toHaveLength(1);
    expect(md).toContain('_…and 2 more not shown. Run `npm run typecheck` locally');
  });
});

describe('coverage summary', () => {
  const totals = parseCoverageSummary(fixture('coverage-summary.json'));

  it('parses the totals', () => {
    expect(totals.lines).toEqual({ pct: 80.24, covered: 4012, total: 5000 });
    expect(totals.branches.pct).toBe(67.08);
  });

  it('reads the thresholds from the Vitest config', () => {
    const thresholds = readThresholds(vitestConfig);
    expect(Object.keys(thresholds).sort()).toEqual([
      'branches',
      'functions',
      'lines',
      'statements',
    ]);
    expect(readThresholds({})).toEqual({});
    expect(readThresholds({ test: { coverage: { thresholds: { lines: 'x' } } } })).toEqual({});
  });

  it('renders actual value, threshold and margin per metric', () => {
    const md = renderCoverageSummary(totals, {
      statements: 78,
      branches: 66,
      functions: 79,
      lines: 79,
    });
    expect(md).toContain('| Statements | 78.30% | 4,150 / 5,300 | 78% | +0.30 pp | ✅ |');
    expect(md).toContain('| Branches | 67.08% | 1,610 / 2,400 | 66% | +1.08 pp | ✅ |');
    expect(md).toContain('| Functions | 77.77% | 700 / 900 | 79% | −1.23 pp | ❌ |');
    expect(md).toContain('1 metric(s) below the thresholds');
  });

  it('shows dashes when a metric has no threshold', () => {
    const md = renderCoverageSummary(totals, {});
    expect(md).toContain('| Lines | 80.24% | 4,012 / 5,000 | — | — | — |');
    expect(md).toContain('All metrics meet the thresholds');
  });

  it('rejects a summary without totals', () => {
    expect(() => parseCoverageSummary('{}')).toThrow(/missing "total"/);
  });
});

describe('build summary', () => {
  const baseline = parseBundleSize(fixture('bundle-size-baseline.json'));
  const current: BundleSize = {
    bytes: 1_050_000,
    gzipBytes: 262_000,
    sha: 'fedcba9876543210fedcba9876543210fedcba98',
  };
  const artifact = {
    name: 'vault-mcp-server-fedcba9',
    url: 'https://github.com/o/r/actions/runs/1/artifacts/2',
    retentionDays: 14,
  };

  it('measures raw and gzip size', () => {
    const size = measureBundle(Buffer.from('a'.repeat(10_000)), 'abc');
    expect(size.bytes).toBe(10_000);
    expect(size.gzipBytes).toBeGreaterThan(0);
    expect(size.gzipBytes).toBeLessThan(200);
    expect(size.sha).toBe('abc');
  });

  it('parses and validates bundle-size.json', () => {
    expect(baseline).toEqual({
      bytes: 1_048_576,
      gzipBytes: 262_144,
      sha: '0123456789abcdef0123456789abcdef01234567',
    });
    expect(parseBundleSize('not json')).toBeNull();
    expect(parseBundleSize('{"bytes": 1}')).toBeNull();
  });

  it('formats size differences', () => {
    expect(formatDelta(1_050_000, 1_048_576)).toBe('+1,424 B (+0.14%)');
    expect(formatDelta(262_000, 262_144)).toBe('−144 B (−0.05%)');
    expect(formatDelta(5, 5)).toBe('±0 B');
  });

  it('compares with the baseline on pull requests', () => {
    const md = renderBuildSummary({
      size: current,
      version: '3.2.0',
      event: 'pull_request',
      baseline,
      artifact,
    });
    expect(md).toContain('Manifest version: `3.2.0`');
    expect(md).toContain('Baseline (`0123456` on `main`)');
    expect(md).toContain(
      '| `main.js` | 1,050,000 B (1025.4 KiB) | 1,048,576 B (1024.0 KiB) | +1,424 B (+0.14%) |',
    );
    expect(md).toContain('| `main.js` (gzip) | 262,000 B (255.9 KiB) | 262,144 B (256.0 KiB) |');
    expect(md).toContain(`[\`vault-mcp-server-fedcba9\`](${artifact.url})`);
    expect(md).toContain('Kept for 14 days.');
    expect(md).toContain('`<vault>/.obsidian/plugins/vault-mcp-server/`');
  });

  it('says so when there is no baseline', () => {
    const md = renderBuildSummary({
      size: current,
      version: '3.2.0',
      event: 'pull_request',
      baseline: null,
      artifact: { ...artifact, url: null, retentionDays: null },
    });
    expect(md).toContain('> No baseline yet');
    expect(md).toContain('| `main.js` | 1,050,000 B (1025.4 KiB) |');
    expect(md).not.toContain('Difference');
    expect(md).toContain('It is listed under **Artifacts** on the run page.');
    expect(md).not.toContain('Kept for');
  });

  it('announces the baseline upload on pushes', () => {
    const md = renderBuildSummary({
      size: current,
      version: null,
      event: 'push',
      baseline: null,
      artifact: null,
    });
    expect(md).toContain('Manifest version: _unknown_');
    expect(md).toContain('as the baseline for pull requests');
    expect(md).not.toContain('No baseline yet');
    expect(md).not.toContain('Plugin artifact');
  });
});
