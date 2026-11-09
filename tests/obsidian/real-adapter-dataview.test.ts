import { describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { RealObsidianAdapter } from '../../src/obsidian/adapter';

type Cell = string | string[];

/**
 * Minimal stand-in for Dataview's markdown export of a TABLE query
 * (`ui/export/markdown.ts`, `markdownTable` / `rawTableLiteral` in
 * obsidian-dataview 0.5.x): with `allowHtml` (Dataview's default) list
 * values become `<ul><li>…</li></ul>`; without it they are joined with
 * ", " like `Values.toString`.
 */
function renderTable(headers: string[], rows: Cell[][], allowHtml: boolean): string {
  const cell = (value: Cell): string => {
    if (!Array.isArray(value)) return value;
    return allowHtml
      ? `<ul>${value.map((v) => `<li>${v}</li>`).join('')}</ul>`
      : value.join(', ');
  };
  let out = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n`;
  for (const row of rows) out += `| ${row.map(cell).join(' | ')} |\n`;
  return out;
}

function makeApp(queryMarkdown: unknown): App {
  const app = new App();
  (app as unknown as { plugins: unknown }).plugins = {
    plugins: { dataview: { api: { queryMarkdown } } },
  };
  return app;
}

describe('RealObsidianAdapter.getDataviewApi (#431)', () => {
  it('asks Dataview for HTML-free markdown so list fields come back as plain text', async () => {
    const queryMarkdown = vi.fn(
      (_query: unknown, _origin: unknown, settings?: { allowHtml?: boolean }) =>
        Promise.resolve({
          successful: true,
          value: renderTable(
            ['File', 'aliases'],
            [['[[Alice]]', ['Ali', 'A.']]],
            settings?.allowHtml ?? true,
          ),
        }),
    );
    const api = new RealObsidianAdapter(makeApp(queryMarkdown)).getDataviewApi();
    expect(api).not.toBeNull();
    const result = await api?.queryMarkdown('TABLE aliases FROM "people"');

    expect(queryMarkdown).toHaveBeenCalledWith('TABLE aliases FROM "people"', undefined, {
      allowHtml: false,
    });
    expect(result).toEqual({
      successful: true,
      value: '| File | aliases |\n| --- | --- |\n| [[Alice]] | Ali, A. |\n',
    });
    expect(result?.successful === true && result.value).not.toMatch(/<ul>|<li>/);
  });

  it('passes Dataview failures through', async () => {
    const api = new RealObsidianAdapter(
      makeApp(() => Promise.resolve({ successful: false, error: 'bad query' })),
    ).getDataviewApi();
    expect(await api?.queryMarkdown('TABLE')).toEqual({ successful: false, error: 'bad query' });
  });

  it('returns null when Dataview exposes no queryMarkdown', () => {
    const app = new App();
    (app as unknown as { plugins: unknown }).plugins = { plugins: { dataview: { api: {} } } };
    expect(new RealObsidianAdapter(app).getDataviewApi()).toBeNull();
  });
});
