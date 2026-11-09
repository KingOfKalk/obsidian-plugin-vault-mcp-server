/**
 * Small Markdown helpers for the CI job summaries (#416).
 */

/** Maximum number of detail entries listed per tool before truncating. */
export const DEFAULT_CAP = 50;

/** Messages longer than this are cut in summaries and annotations. */
export const MAX_MESSAGE_LENGTH = 500;

export type StepOutcome = 'success' | 'failure' | 'cancelled' | 'skipped';

/** Normalise a `steps.<id>.outcome` value; unknown values count as skipped. */
export function toOutcome(value: string | undefined): StepOutcome {
  switch (value) {
    case 'success':
    case 'failure':
    case 'cancelled':
      return value;
    default:
      return 'skipped';
  }
}

export function outcomeLabel(outcome: StepOutcome): string {
  switch (outcome) {
    case 'success':
      return '✅ passed';
    case 'failure':
      return '❌ failed';
    case 'cancelled':
      return '⚪ cancelled';
    case 'skipped':
      return '⏭️ not run';
  }
}

/** Cut `text` to `max` characters, marking the cut with an ellipsis. */
export function truncate(text: string, max = MAX_MESSAGE_LENGTH): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Escape text for use in Markdown prose or table cells. */
export function escapeText(text: string): string {
  return truncate(text.replace(/\s*\r?\n\s*/g, ' '))
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[|`*_[\]]/g, (match) => `\\${match}`);
}

/** Wrap text in a code span that survives backticks in the content. */
export function code(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Fenced code block with a fence longer than any backtick run inside. */
export function codeBlock(text: string, lang = ''): string {
  const runs = text.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** Collapsible block. The blank lines let GitHub render Markdown inside. */
export function details(summary: string, body: string, open = false): string {
  return `<details${open ? ' open' : ''}>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

export function formatInt(value: number): string {
  return value.toLocaleString('en-US');
}

/** Note for a list truncated to `shown` of `total` entries. */
export function moreNote(shown: number, total: number, hint: string): string {
  return total > shown ? `\n\n_…and ${formatInt(total - shown)} more not shown. ${hint}_` : '';
}

/** Group items by key, keeping first-seen key order. */
export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
