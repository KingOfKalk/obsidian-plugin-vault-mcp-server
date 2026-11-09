/**
 * CI job summaries and annotations (#416). Called from
 * `.github/workflows/ci.yml`; writes Markdown to `$GITHUB_STEP_SUMMARY`
 * (stdout when unset) and annotation commands to stdout.
 *
 *   tsx scripts/ci-summary.ts annotate eslint <eslint.json>
 *   tsx scripts/ci-summary.ts annotate tsc <tsc.txt>
 *   tsx scripts/ci-summary.ts lint --eslint <file> --eslint-outcome <o>
 *       --tsc <file> --tsc-outcome <o> --docs <file> --docs-outcome <o>
 *   tsx scripts/ci-summary.ts coverage <coverage-summary.json>
 *   tsx scripts/ci-summary.ts size <main.js> --sha <sha> --out <bundle-size.json>
 *   tsx scripts/ci-summary.ts build --size <bundle-size.json> [--baseline <file>]
 *       --manifest <manifest.json> --event <event> [--artifact-name <n>]
 *       [--artifact-url <url>] [--retention-days <n>]
 *   tsx scripts/ci-summary.ts surface --current <surface.json>
 *       --baseline <docs/surface-baseline.json> [--main <surface-baseline.json from main>]
 *
 * Missing input files are reported in the summary instead of failing the
 * step, so a crashed tool still gets a readable summary.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, cwd, env, exit, stderr, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { renderAnnotations } from './ci-summary/annotations';
import { measureBundle, parseBundleSize, renderBuildSummary } from './ci-summary/build';
import { parseCoverageSummary, readThresholds, renderCoverageSummary } from './ci-summary/coverage';
import {
  eslintAnnotations,
  eslintLogLines,
  parseDocsCheckOutput,
  parseEslintReport,
  parseTscOutput,
  renderLintSummary,
  tscAnnotations,
} from './ci-summary/lint';
import { toOutcome } from './ci-summary/markdown';
import { checkBudget } from './surface/budget';
import { parseSurface } from './surface/measure';
import { renderSurfaceSummary } from './surface/render';

const root = env.GITHUB_WORKSPACE ?? cwd();

function readIfExists(path: string | undefined): string | null {
  if (path === undefined || path === '' || !existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function writeSummary(markdown: string): void {
  const target = env.GITHUB_STEP_SUMMARY;
  if (target) appendFileSync(target, `${markdown}\n`);
  else stdout.write(`${markdown}\n`);
}

function print(lines: string[]): void {
  if (lines.length > 0) stdout.write(`${lines.join('\n')}\n`);
}

function warn(message: string): void {
  stderr.write(`ci-summary: ${message}\n`);
}

/** Parse a report, or warn and return null when it is missing or broken. */
function parseReport<T>(path: string | undefined, parse: (text: string) => T): T | null {
  const text = readIfExists(path);
  if (text === null) return null;
  try {
    return parse(text);
  } catch (error) {
    warn(`cannot parse ${path ?? ''}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function annotate(args: string[]): void {
  const [tool, file] = args;
  if (tool === 'eslint') {
    const findings = parseReport(file, (t) => parseEslintReport(t, root));
    if (findings === null) return warn(`no ESLint report at ${file ?? '(none)'}`);
    print(eslintLogLines(findings));
    print(renderAnnotations(eslintAnnotations(findings)));
  } else if (tool === 'tsc') {
    const errors = parseReport(file, (t) => parseTscOutput(t, root));
    if (errors === null) return warn(`no tsc output at ${file ?? '(none)'}`);
    print(renderAnnotations(tscAnnotations(errors)));
  } else {
    throw new Error(`annotate: unknown tool "${tool ?? ''}" (expected eslint or tsc)`);
  }
}

function lint(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      eslint: { type: 'string' },
      'eslint-outcome': { type: 'string' },
      tsc: { type: 'string' },
      'tsc-outcome': { type: 'string' },
      docs: { type: 'string' },
      'docs-outcome': { type: 'string' },
    },
  });
  writeSummary(
    renderLintSummary({
      eslint: {
        outcome: toOutcome(values['eslint-outcome']),
        findings: parseReport(values.eslint, (t) => parseEslintReport(t, root)),
      },
      tsc: {
        outcome: toOutcome(values['tsc-outcome']),
        errors: parseReport(values.tsc, (t) => parseTscOutput(t, root)),
      },
      docs: {
        outcome: toOutcome(values['docs-outcome']),
        result: parseReport(values.docs, parseDocsCheckOutput),
      },
    }),
  );
}

async function coverage(args: string[]): Promise<void> {
  const [file] = args;
  const totals = parseReport(file, parseCoverageSummary);
  if (totals === null) {
    writeSummary(
      `## Coverage\n\n_No coverage summary found at \`${file ?? ''}\`. See the test step log._`,
    );
    return;
  }
  // The thresholds come from the Vitest config itself so they cannot drift.
  const config = (await import('../vitest.config')).default as unknown;
  writeSummary(renderCoverageSummary(totals, readThresholds(config)));
}

function size(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { sha: { type: 'string' }, out: { type: 'string' } },
  });
  const [file] = positionals;
  if (file === undefined || values.out === undefined)
    throw new Error('size: need <file> and --out');
  const result = measureBundle(readFileSync(file), values.sha ?? 'unknown');
  writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  print([`${file}: ${result.bytes} bytes, ${result.gzipBytes} bytes gzipped`]);
}

function build(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      size: { type: 'string' },
      baseline: { type: 'string' },
      manifest: { type: 'string' },
      event: { type: 'string' },
      'artifact-name': { type: 'string' },
      'artifact-url': { type: 'string' },
      'retention-days': { type: 'string' },
    },
  });
  const current = parseReport(values.size, parseBundleSize);
  if (current === null)
    throw new Error(`build: no valid bundle size at ${values.size ?? '(none)'}`);
  const manifest = parseReport(values.manifest, (t) => JSON.parse(t) as unknown);
  const version =
    typeof manifest === 'object' &&
    manifest !== null &&
    'version' in manifest &&
    typeof manifest.version === 'string'
      ? manifest.version
      : null;
  const artifactName = values['artifact-name'];
  writeSummary(
    renderBuildSummary({
      size: current,
      version,
      event: values.event ?? env.GITHUB_EVENT_NAME ?? '',
      baseline: parseReport(values.baseline, parseBundleSize),
      artifact: artifactName
        ? {
            name: artifactName,
            url: values['artifact-url'] || null,
            retentionDays: Number(values['retention-days'] ?? 0) || null,
          }
        : null,
    }),
  );
}

function surface(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      current: { type: 'string' },
      baseline: { type: 'string' },
      main: { type: 'string' },
    },
  });
  const current = parseReport(values.current, parseSurface);
  if (current === null) {
    writeSummary(
      `## Agent-facing surface\n\n_No surface measurement found at \`${values.current ?? ''}\`. See the step log._`,
    );
    return;
  }
  const baseline = parseReport(values.baseline, parseSurface);
  writeSummary(
    renderSurfaceSummary({
      current,
      baseline,
      main: parseReport(values.main, parseSurface),
      problems: baseline === null ? [] : checkBudget(current, baseline),
    }),
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = argv.slice(2);
  switch (command) {
    case 'annotate':
      return annotate(rest);
    case 'lint':
      return lint(rest);
    case 'coverage':
      return coverage(rest);
    case 'size':
      return size(rest);
    case 'build':
      return build(rest);
    case 'surface':
      return surface(rest);
    default:
      throw new Error(
        `unknown command "${command ?? ''}" (annotate, lint, coverage, size, build, surface)`,
      );
  }
}

main().catch((error: unknown) => {
  warn(error instanceof Error ? error.message : String(error));
  exit(1);
});
