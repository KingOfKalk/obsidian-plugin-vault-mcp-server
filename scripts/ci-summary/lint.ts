/**
 * Parsing and summary rendering for the CI `lint` job (#416): ESLint JSON
 * reports, `tsc --noEmit --pretty false` output and `docs:check` output.
 */
import { isAbsolute, relative, sep } from 'node:path';
import type { Annotation } from './annotations';
import {
  DEFAULT_CAP,
  code,
  codeBlock,
  details,
  escapeText,
  groupBy,
  moreNote,
  outcomeLabel,
  plural,
  table,
  type StepOutcome,
} from './markdown';

export interface EslintFinding {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning';
  rule: string | null;
  message: string;
}

export interface TscError {
  file?: string;
  line?: number;
  column?: number;
  code: string;
  message: string;
}

export interface DocsCheckResult {
  /** Committed files that differ from the regenerated ones. */
  files: string[];
  /** Diff output, or the tail of the log when there is no diff. */
  excerpt: string[];
  /** Total number of excerpt lines before truncation. */
  totalLines: number;
}

/** Lines of `docs:check` output shown in the summary. */
export const DOCS_DIFF_LINES = 40;

/** Make `file` relative to `root` with forward slashes, if it is inside it. */
export function toRepoPath(file: string, root: string): string {
  if (!isAbsolute(file)) return file.split(sep).join('/');
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) return file;
  return rel.split(sep).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Parse `eslint --format json` output. Throws on malformed input. */
export function parseEslintReport(json: string, root: string): EslintFinding[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error('ESLint report is not a JSON array');
  const findings: EslintFinding[] = [];
  for (const result of data as unknown[]) {
    if (!isRecord(result) || typeof result.filePath !== 'string') continue;
    const file = toRepoPath(result.filePath, root);
    const messages = Array.isArray(result.messages) ? (result.messages as unknown[]) : [];
    for (const msg of messages) {
      if (!isRecord(msg)) continue;
      findings.push({
        file,
        line: optionalNumber(msg.line) ?? 1,
        column: optionalNumber(msg.column) ?? 1,
        endLine: optionalNumber(msg.endLine),
        endColumn: optionalNumber(msg.endColumn),
        severity: msg.severity === 2 ? 'error' : 'warning',
        rule: typeof msg.ruleId === 'string' ? msg.ruleId : null,
        message: typeof msg.message === 'string' ? msg.message : '',
      });
    }
  }
  return findings;
}

const TSC_FILE_ERROR = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const TSC_GLOBAL_ERROR = /^error (TS\d+): (.*)$/;

/**
 * Parse `tsc --pretty false` output. Indented lines continue the previous
 * error's message (e.g. "Type 'x' is not assignable…" chains).
 */
export function parseTscOutput(text: string, root: string): TscError[] {
  const errors: TscError[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === '') continue;
    const fileMatch = TSC_FILE_ERROR.exec(line);
    if (fileMatch) {
      errors.push({
        file: toRepoPath(fileMatch[1], root),
        line: Number(fileMatch[2]),
        column: Number(fileMatch[3]),
        code: fileMatch[4],
        message: fileMatch[5],
      });
      continue;
    }
    const globalMatch = TSC_GLOBAL_ERROR.exec(line);
    if (globalMatch) {
      errors.push({ code: globalMatch[1], message: globalMatch[2] });
      continue;
    }
    const last = errors[errors.length - 1];
    if (last && /^\s/.test(raw)) last.message += `\n${line.trim()}`;
  }
  return errors;
}

const DIFF_START = /^(--- |\+\+\+ |diff |Only in |@@ )/;

/** Parse the output of `npm run docs:check` (two `diff` runs). */
export function parseDocsCheckOutput(text: string): DocsCheckResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const files: string[] = [];
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      files.push(line.slice(4).split('\t')[0].trim());
    } else if (line.startsWith('Only in ')) {
      const m = /^Only in (.+?): (.+)$/.exec(line);
      if (m) files.push(`${m[1].replace(/\/$/, '')}/${m[2]}`);
    }
  }
  const start = lines.findIndex((line) => DIFF_START.test(line));
  const relevant = start >= 0 ? lines.slice(start) : lines.slice(-DOCS_DIFF_LINES);
  return {
    files: [...new Set(files)],
    excerpt: relevant.slice(0, DOCS_DIFF_LINES),
    totalLines: relevant.length,
  };
}

export function eslintAnnotations(findings: EslintFinding[]): Annotation[] {
  return findings.map((f) => ({
    level: f.severity,
    file: f.file,
    line: f.line,
    col: f.column,
    endLine: f.endLine,
    endColumn: f.endColumn,
    title: f.rule ? `ESLint (${f.rule})` : 'ESLint',
    message: f.message,
  }));
}

export function tscAnnotations(errors: TscError[]): Annotation[] {
  return errors.map((e) => ({
    level: 'error',
    file: e.file,
    line: e.line,
    col: e.column,
    title: `tsc ${e.code}`,
    message: e.message,
  }));
}

/** One readable line per finding, for the step log. */
export function eslintLogLines(findings: EslintFinding[]): string[] {
  return findings.map(
    (f) =>
      `${f.file}:${f.line}:${f.column}  ${f.severity}  ${f.message}${f.rule ? `  ${f.rule}` : ''}`,
  );
}

export interface LintSummaryInput {
  eslint: { outcome: StepOutcome; findings: EslintFinding[] | null };
  tsc: { outcome: StepOutcome; errors: TscError[] | null };
  docs: { outcome: StepOutcome; result: DocsCheckResult | null };
  cap?: number;
}

function countSeverity(findings: EslintFinding[], severity: EslintFinding['severity']): number {
  return findings.filter((f) => f.severity === severity).length;
}

function eslintOverview(input: LintSummaryInput['eslint']): string {
  if (input.findings === null) return input.outcome === 'skipped' ? '—' : 'no report';
  const errors = countSeverity(input.findings, 'error');
  const warnings = countSeverity(input.findings, 'warning');
  return `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`;
}

function tscOverview(input: LintSummaryInput['tsc']): string {
  if (input.errors === null) return input.outcome === 'skipped' ? '—' : 'no output';
  return plural(input.errors.length, 'error');
}

function docsOverview(input: LintSummaryInput['docs']): string {
  if (input.outcome === 'success') return 'in sync';
  if (input.outcome === 'skipped' || input.outcome === 'cancelled') return '—';
  const files = input.result?.files.length ?? 0;
  return files > 0 ? `${plural(files, 'file')} out of date` : 'failed';
}

/** Wrap long sections in a collapsible block; short ones stay inline. */
function maybeCollapse(summary: string, body: string, count: number): string {
  return count > 10 ? details(summary, body) : body;
}

function missingReport(outcome: StepOutcome): string {
  if (outcome === 'skipped') return '_Not run._';
  if (outcome === 'cancelled') return '_Cancelled._';
  return outcome === 'success'
    ? '_No report found._'
    : '_No report was produced. See the step log._';
}

function renderEslintSection(input: LintSummaryInput['eslint'], cap: number): string {
  const head = '### ESLint';
  if (input.findings === null) return `${head}\n\n${missingReport(input.outcome)}`;
  const { findings } = input;
  if (findings.length === 0) return `${head}\n\nNo findings.`;
  const errors = countSeverity(findings, 'error');
  const warnings = countSeverity(findings, 'warning');
  const shown = findings.slice(0, cap);
  const groups = groupBy(shown, (f) => f.file);
  const fileCount = new Set(findings.map((f) => f.file)).size;
  const blocks = [...groups].map(([file, items]) => {
    const rows = items.map(
      (f) =>
        `- ${code(`${f.file}:${f.line}:${f.column}`)} **${f.severity}** ${f.rule ? code(f.rule) : '_(no rule)_'}: ${escapeText(f.message)}`,
    );
    return `**${code(file)}**\n\n${rows.join('\n')}`;
  });
  const body =
    blocks.join('\n\n') +
    moreNote(shown.length, findings.length, 'Run `npm run lint` locally for the full list.');
  const summary = `${plural(errors, 'error')}, ${plural(warnings, 'warning')} in ${plural(fileCount, 'file')}`;
  return `${head}\n\n**${summary}**\n\n${maybeCollapse('Findings', body, findings.length)}`;
}

function renderTscSection(input: LintSummaryInput['tsc'], cap: number): string {
  const head = '### Typecheck';
  if (input.errors === null) return `${head}\n\n${missingReport(input.outcome)}`;
  const { errors } = input;
  if (errors.length === 0) {
    return input.outcome === 'failure'
      ? `${head}\n\n\`tsc\` failed without reporting errors. See the step log.`
      : `${head}\n\nNo errors.`;
  }
  const shown = errors.slice(0, cap);
  const rows = shown.map((e) => {
    const location =
      e.file !== undefined ? `${e.file}(${e.line ?? 0},${e.column ?? 0})` : '(global)';
    return `- ${code(location)}: **${e.code}**: ${escapeText(e.message)}`;
  });
  const body =
    rows.join('\n') +
    moreNote(shown.length, errors.length, 'Run `npm run typecheck` locally for the full list.');
  return `${head}\n\n**${plural(errors.length, 'error')}**\n\n${maybeCollapse('Errors', body, errors.length)}`;
}

function renderDocsSection(input: LintSummaryInput['docs']): string {
  const head = '### docs:check';
  if (input.outcome === 'success') return `${head}\n\nGenerated tool docs are in sync.`;
  if (input.outcome !== 'failure') return `${head}\n\n${missingReport(input.outcome)}`;
  const parts = [head];
  const result = input.result;
  if (result && result.files.length > 0) {
    parts.push(
      'These generated files differ from the committed ones:',
      result.files.map((f) => `- ${code(f)}`).join('\n'),
    );
  } else {
    parts.push('`docs:check` failed.');
  }
  parts.push('Run `npm run docs:tools` and commit the result.');
  if (result && result.excerpt.length > 0) {
    const label =
      result.totalLines > result.excerpt.length
        ? `First ${result.excerpt.length} of ${result.totalLines} lines of output`
        : 'Output';
    parts.push(details(label, codeBlock(result.excerpt.join('\n'), 'diff'), true));
  }
  return parts.join('\n\n');
}

export function renderLintSummary(input: LintSummaryInput): string {
  const cap = input.cap ?? DEFAULT_CAP;
  const overview = table(
    ['Check', 'Result', 'Details'],
    [
      ['ESLint', outcomeLabel(input.eslint.outcome), eslintOverview(input.eslint)],
      ['Typecheck', outcomeLabel(input.tsc.outcome), tscOverview(input.tsc)],
      ['docs:check', outcomeLabel(input.docs.outcome), docsOverview(input.docs)],
    ],
  );
  return [
    '## Lint',
    overview,
    renderEslintSection(input.eslint, cap),
    renderTscSection(input.tsc, cap),
    renderDocsSection(input.docs),
  ].join('\n\n');
}
