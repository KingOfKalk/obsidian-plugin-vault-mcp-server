/**
 * Connects a real SDK client to the seeded server and measures what it
 * receives (#450). Uses the same harness as the generated tool docs
 * (`scripts/tool-examples.ts`), with the fixed docs version so the numbers
 * do not change with a release.
 *
 * Dev-only: nothing under `src/` imports this, so it never reaches main.js.
 */

import { collectToolRows } from '../list-tools';
import { connectSeededServer, type ConnectOptions } from '../tool-examples';
import {
  measureSnapshot,
  totalsOf,
  type SurfaceMeasurement,
  type SurfaceSnapshot,
} from './measure';

/** Tool name → module id, from the same registry walk the docs use. */
export function toolModules(): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of collectToolRows()) {
    for (const tool of row.tools) map.set(tool.name, row.moduleId);
  }
  return map;
}

/** Connect a seeded server and record what its client receives. */
export async function snapshotSurface(options: ConnectOptions = {}): Promise<SurfaceSnapshot> {
  const h = await connectSeededServer(options);
  try {
    const { tools } = await h.client.listTools();
    const { prompts } = await h.client.listPrompts();
    return {
      instructions: h.client.getInstructions() ?? '',
      tools: tools as unknown as Record<string, unknown>[],
      prompts: prompts as unknown as Record<string, unknown>[],
    };
  } finally {
    await h.close();
  }
}

/**
 * Measure the surface with every tool enabled and with the defaults of a
 * fresh install: editor, workspace, ui and extras off and an empty command
 * allowlist (#469). The seeded vault has Dataview enabled, so
 * `plugin_dataview_query` counts in both. The server reports the fixed docs
 * version, so the result does not change with a release.
 */
export async function measureSurface(): Promise<SurfaceMeasurement> {
  const moduleOf = toolModules();
  const all = measureSnapshot(await snapshotSurface(), moduleOf);
  const defaultSnapshot = await snapshotSurface({
    defaultStates: true,
    executeCommandAllowlist: [],
  });
  return {
    all,
    defaults: { toolCount: defaultSnapshot.tools.length, totals: totalsOf(defaultSnapshot) },
  };
}
