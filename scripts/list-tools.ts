/**
 * Walk the tool registry and emit a markdown snapshot of every module and
 * its tools. The output is one index file plus one per-module page; CI's
 * `docs:check` diffs the regenerated tree against the committed copy.
 *
 * Run via `npm run docs:tools` (writes into ./docs).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { MockObsidianAdapter } from '../src/obsidian/mock-adapter';
import { discoverModules } from '../src/tools';
import { renderIndexPage, renderModulePage, type ModuleDoc } from './render-tools/render';

export type ToolRow = ModuleDoc;

export function collectToolRows(): ToolRow[] {
  const adapter = new MockObsidianAdapter();
  const modules = discoverModules(adapter);
  return modules.map((module) => ({
    moduleId: module.metadata.id,
    moduleName: module.metadata.name,
    tools: module.tools().map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      schema: t.schema,
      outputSchema: t.outputSchema,
      readOnly: t.annotations.readOnlyHint === true,
      destructive: t.annotations.destructiveHint === true,
    })),
  }));
}

export { renderIndexPage, renderModulePage };

function main(): void {
  const outDir = argv[2] ?? 'docs';
  const rows = collectToolRows();

  // Index page at <outDir>/tools.generated.md.
  writeFileSync(join(outDir, 'tools.generated.md'), renderIndexPage(rows));

  // Per-module pages under <outDir>/tools/.
  const modulesDir = join(outDir, 'tools');
  mkdirSync(modulesDir, { recursive: true });
  for (const row of rows) {
    writeFileSync(
      join(modulesDir, `${row.moduleId}.generated.md`),
      renderModulePage(row),
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${outDir}/tools.generated.md and ${String(rows.length)} per-module pages under ${modulesDir}`,
  );
}

if (import.meta.url === `file://${argv[1]}`) {
  main();
}
