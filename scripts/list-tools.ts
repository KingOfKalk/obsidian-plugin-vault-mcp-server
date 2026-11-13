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
import { MockObsidianAdapter } from '../tests/helpers/mock-adapter';
import { discoverModules } from '../src/tools';
import { createServerModule } from '../src/tools/server';
import {
  renderIndexPage,
  renderModulePage,
  type ModuleDoc,
  type ToolExampleDoc,
} from './render-tools/render';
import { collectToolExamples, DOCS_VERSION, type ToolExample } from './tool-examples';

export type ToolRow = ModuleDoc;

/** Reduce a recorded call to what the reference renders (#324). */
export function toExampleDoc(example: ToolExample): ToolExampleDoc {
  const { structuredContent, content } = example.result;
  return {
    arguments: example.request.arguments,
    response:
      structuredContent !== undefined
        ? { kind: 'structuredContent', value: structuredContent }
        : { kind: 'content', value: content },
  };
}

/**
 * Walk the registry. With `examples` (from `collectToolExamples`), each tool
 * that has a recorded call carries it for rendering.
 */
export function collectToolRows(examples?: ReadonlyMap<string, ToolExample>): ToolRow[] {
  const adapter = new MockObsidianAdapter();
  // The always-on server module (server_info) is not discovered: it never
  // enters the registry. Render it with the fixed docs version (#402).
  const modules = [
    ...discoverModules(adapter),
    createServerModule({ version: DOCS_VERSION, getEnabledModules: () => [] }),
  ];
  return modules.map((module) => ({
    moduleId: module.metadata.id,
    moduleName: module.metadata.name,
    tools: module.tools().map((t) => {
      const example = examples?.get(t.name);
      return {
        name: t.name,
        title: t.title,
        description: t.description,
        schema: t.schema,
        outputSchema: t.outputSchema,
        readOnly: t.annotations.readOnlyHint === true,
        destructive: t.annotations.destructiveHint === true,
        ...(example ? { example: toExampleDoc(example) } : {}),
      };
    }),
  }));
}

export { renderIndexPage, renderModulePage };

async function main(): Promise<void> {
  const outDir = argv[2] ?? 'docs';
  const rows = collectToolRows(await collectToolExamples());

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

  console.log(
    `Wrote ${outDir}/tools.generated.md and ${String(rows.length)} per-module pages under ${modulesDir}`,
  );
}

if (import.meta.url === `file://${argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
