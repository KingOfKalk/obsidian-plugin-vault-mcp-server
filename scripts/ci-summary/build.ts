/**
 * Bundle size measurement and the CI `build` job summary (#416).
 *
 * Pushes to `main` upload `bundle-size.json` as the baseline; PR runs
 * download the latest one and show the difference.
 */
import { gzipSync } from 'node:zlib';
import { code, formatInt, table } from './markdown';

export interface BundleSize {
  bytes: number;
  gzipBytes: number;
  sha: string;
}

export function measureBundle(content: Buffer, sha: string): BundleSize {
  return { bytes: content.length, gzipBytes: gzipSync(content, { level: 9 }).length, sha };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a `bundle-size.json`. Returns null when it is not a valid one. */
export function parseBundleSize(json: string): BundleSize | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const { bytes, gzipBytes, sha } = data;
  if (typeof bytes !== 'number' || typeof gzipBytes !== 'number' || typeof sha !== 'string')
    return null;
  return { bytes, gzipBytes, sha };
}

export function formatBytes(bytes: number): string {
  return `${formatInt(bytes)} B (${(bytes / 1024).toFixed(1)} KiB)`;
}

export function formatDelta(current: number, baseline: number): string {
  const diff = current - baseline;
  if (diff === 0) return '±0 B';
  const sign = diff > 0 ? '+' : '−';
  const pct = baseline === 0 ? '' : ` (${sign}${Math.abs((diff / baseline) * 100).toFixed(2)}%)`;
  return `${sign}${formatInt(Math.abs(diff))} B${pct}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export interface BuildSummaryInput {
  size: BundleSize;
  version: string | null;
  /** `GITHUB_EVENT_NAME`; `push` runs publish the baseline instead of comparing. */
  event: string;
  baseline: BundleSize | null;
  artifact: { name: string; url: string | null; retentionDays: number | null } | null;
}

function sizeTable(size: BundleSize): string {
  return table(
    ['File', 'Size'],
    [
      ['`main.js`', formatBytes(size.bytes)],
      ['`main.js` (gzip)', formatBytes(size.gzipBytes)],
    ],
  );
}

function renderSize(input: BuildSummaryInput): string {
  const { size, baseline } = input;
  if (input.event === 'push') {
    return [
      sizeTable(size),
      `This run uploads \`bundle-size.json\` for ${code(shortSha(size.sha))} as the baseline for pull requests.`,
    ].join('\n\n');
  }
  if (baseline === null) {
    return [
      sizeTable(size),
      '> No baseline yet: no `bundle-size.json` from a successful `main` run was found, so there is nothing to compare against.',
    ].join('\n\n');
  }
  return table(
    ['File', 'This build', `Baseline (${code(shortSha(baseline.sha))} on \`main\`)`, 'Difference'],
    [
      [
        '`main.js`',
        formatBytes(size.bytes),
        formatBytes(baseline.bytes),
        formatDelta(size.bytes, baseline.bytes),
      ],
      [
        '`main.js` (gzip)',
        formatBytes(size.gzipBytes),
        formatBytes(baseline.gzipBytes),
        formatDelta(size.gzipBytes, baseline.gzipBytes),
      ],
    ],
  );
}

function renderArtifact(artifact: NonNullable<BuildSummaryInput['artifact']>): string {
  const link = artifact.url ? `[${code(artifact.name)}](${artifact.url})` : code(artifact.name);
  const where = artifact.url ? '' : ' It is listed under **Artifacts** on the run page.';
  return [
    '### Plugin artifact',
    `${link} contains \`main.js\`, \`manifest.json\` and \`styles.css\` (placeholder).${artifact.retentionDays !== null ? ` Kept for ${artifact.retentionDays} days.` : ''}${where}`,
    '**Install for testing:** download and unzip it, copy the three files into `<vault>/.obsidian/plugins/vault-mcp-server/`, then reload Obsidian or turn the plugin off and on in **Settings → Community plugins**. Use a test vault.',
  ].join('\n\n');
}

export function renderBuildSummary(input: BuildSummaryInput): string {
  const parts = ['## Build'];
  parts.push(`Manifest version: ${input.version !== null ? code(input.version) : '_unknown_'}`);
  parts.push('### Bundle size', renderSize(input));
  if (input.artifact) parts.push(renderArtifact(input.artifact));
  return parts.join('\n\n');
}
