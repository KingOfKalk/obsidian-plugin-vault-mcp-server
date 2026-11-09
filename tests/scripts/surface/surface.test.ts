import { describe, it, expect } from 'vitest';
import {
  allowedDeviation,
  checkBudget,
  describeProblem,
  formatProblems,
  type BudgetProblem,
} from '../../../scripts/surface/budget';
import {
  approxTokens,
  descriptionChars,
  jsonChars,
  measureSnapshot,
  modelViewOf,
  parseSurface,
  toBaselineJson,
  totalsOf,
  type SurfaceMeasurement,
  type SurfaceSnapshot,
} from '../../../scripts/surface/measure';
import {
  formatCharDelta,
  renderSurfaceReport,
  renderSurfaceSummary,
} from '../../../scripts/surface/render';

const TOOL_A = {
  name: 'vault_read',
  title: 'Read',
  description: 'Read a note.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Vault path' } },
  },
  outputSchema: { type: 'object', description: 'Note' },
};
const TOOL_B = {
  name: 'ui_notice',
  description: 'Show a notice.',
  inputSchema: { type: 'object', properties: {} },
};

const SNAPSHOT: SurfaceSnapshot = {
  instructions: 'hello',
  tools: [TOOL_A, TOOL_B],
  prompts: [{ name: 'p' }],
};
const MODULES = new Map([
  ['vault_read', 'vault'],
  ['ui_notice', 'ui'],
]);

function measurement(snapshot: SurfaceSnapshot = SNAPSHOT): SurfaceMeasurement {
  const all = measureSnapshot(snapshot, MODULES);
  return { all, defaults: { toolCount: all.toolCount, totals: all.totals } };
}

/** A copy of `m` with one tool's sizes changed by `delta`. */
function grow(m: SurfaceMeasurement, tool: string, delta: number): SurfaceMeasurement {
  const copy = JSON.parse(JSON.stringify(m)) as SurfaceMeasurement;
  copy.all.tools[tool].toolsList += delta;
  copy.all.tools[tool].modelView += delta;
  return copy;
}

describe('surface measurement', () => {
  it('counts compact JSON characters and estimates tokens', () => {
    expect(jsonChars({ a: 1 })).toBe(7);
    expect(approxTokens(10)).toBe(3);
  });

  it('sums every description string, however deeply nested', () => {
    expect(descriptionChars(TOOL_A.inputSchema)).toBe('Vault path'.length);
    expect(descriptionChars([{ description: 'ab' }, { x: { description: 'c' } }])).toBe(3);
    // A property named "description" is a schema, not a text.
    expect(descriptionChars({ description: { type: 'string', description: 'd' } })).toBe(1);
    expect(descriptionChars('description')).toBe(0);
  });

  it('builds the model view from name, description and input schema only', () => {
    expect(modelViewOf(TOOL_A)).toEqual({
      name: 'vault_read',
      description: 'Read a note.',
      input_schema: TOOL_A.inputSchema,
    });
    expect(modelViewOf({ name: 'x' })).toEqual({
      name: 'x',
      description: '',
      input_schema: undefined,
    });
  });

  it('measures totals, modules and tools', () => {
    const m = measureSnapshot(SNAPSHOT, MODULES);
    expect(m.toolCount).toBe(2);
    expect(m.totals).toEqual({
      instructions: 5,
      toolsList: jsonChars({ tools: [TOOL_A, TOOL_B] }),
      modelView: jsonChars([modelViewOf(TOOL_A), modelViewOf(TOOL_B)]),
      toolDescriptions: 'Read a note.'.length + 'Show a notice.'.length,
      inputSchemas: jsonChars(TOOL_A.inputSchema) + jsonChars(TOOL_B.inputSchema),
      inputSchemaDescriptions: 'Vault path'.length,
      outputSchemas: jsonChars(TOOL_A.outputSchema),
      promptsList: jsonChars({ prompts: [{ name: 'p' }] }),
    });
    expect(m.tools.vault_read).toEqual({
      module: 'vault',
      toolsList: jsonChars(TOOL_A),
      modelView: jsonChars(modelViewOf(TOOL_A)),
    });
    expect(m.modules.ui).toEqual({
      tools: 1,
      toolsList: jsonChars(TOOL_B),
      modelView: jsonChars(modelViewOf(TOOL_B)),
    });
  });

  it('groups tools of an unknown module under "unknown"', () => {
    const m = measureSnapshot({ ...SNAPSHOT, tools: [{ description: 1 }] }, new Map());
    expect(Object.keys(m.modules)).toEqual(['unknown']);
    expect(m.tools['']?.module).toBe('unknown');
    expect(totalsOf({ ...SNAPSHOT, tools: [{ name: 'x' }] }).toolDescriptions).toBe(0);
  });

  it('round-trips through the baseline file', () => {
    const m = measurement();
    const json = toBaselineJson(m);
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json)).toHaveProperty('$comment');
    expect(parseSurface(json)).toEqual({ $comment: expect.any(String) as unknown, ...m });
  });

  it('rejects files that are not a measurement', () => {
    const valid = JSON.parse(toBaselineJson(measurement())) as Record<string, unknown>;
    const broken = (patch: (d: Record<string, unknown>) => void): string => {
      const copy = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
      patch(copy);
      return JSON.stringify(copy);
    };
    type View = {
      totals: Record<string, unknown>;
      tools: Record<string, unknown>;
      modules: Record<string, unknown>;
    };
    expect(parseSurface('not json')).toBeNull();
    expect(parseSurface('[]')).toBeNull();
    expect(parseSurface(broken((d) => delete d.defaults))).toBeNull();
    expect(parseSurface(broken((d) => ((d.all as View).totals.toolsList = '1')))).toBeNull();
    expect(parseSurface(broken((d) => ((d.all as Record<string, unknown>).tools = [])))).toBeNull();
    expect(parseSurface(broken((d) => ((d.all as View).tools.x = 1)))).toBeNull();
    expect(
      parseSurface(broken((d) => ((d.all as View).tools.x = { toolsList: 1, modelView: 1 }))),
    ).toBeNull();
    expect(parseSurface(broken((d) => ((d.all as View).modules.x = { tools: 1 })))).toBeNull();
  });
});

describe('surface budget', () => {
  const tolerance = { percent: 1, minChars: 40 };

  it('allows the larger of the percentage and the minimum', () => {
    expect(allowedDeviation(1000, tolerance)).toBe(40);
    expect(allowedDeviation(10_000, tolerance)).toBe(100);
    expect(allowedDeviation(10_001, tolerance)).toBe(101);
  });

  it('passes an unchanged measurement and changes within the tolerance', () => {
    const base = measurement();
    expect(checkBudget(base, base, tolerance)).toEqual([]);
    expect(checkBudget(grow(base, 'vault_read', 40), base, tolerance)).toEqual([]);
  });

  it('fails when a tool grows beyond its budget', () => {
    const base = measurement();
    const problems = checkBudget(grow(base, 'vault_read', 41), base, tolerance);
    expect(problems.map((p) => [p.kind, p.item])).toEqual([
      ['over', 'vault_read.toolsList'],
      ['over', 'vault_read.modelView'],
    ]);
  });

  it('fails when a tool shrinks beyond the tolerance, so the saving is locked in', () => {
    const base = measurement();
    const problems = checkBudget(grow(base, 'ui_notice', -41), base, tolerance);
    expect(problems.map((p) => p.kind)).toEqual(['under', 'under']);
  });

  it('fails on totals, tool counts, new and removed tools', () => {
    const base = measurement();
    const bigger = measurement({
      ...SNAPSHOT,
      instructions: 'x'.repeat(100),
      tools: [TOOL_A, { ...TOOL_B, name: 'ui_toast' }],
    });
    const items = checkBudget(bigger, base, tolerance).map((p) => `${p.kind}:${p.item}`);
    expect(items).toContain('over:all.totals.instructions');
    expect(items).toContain('over:defaults.totals.instructions');
    expect(items).toContain('new-tool:ui_toast');
    expect(items).toContain('removed-tool:ui_notice');

    const fewer = measurement({ ...SNAPSHOT, tools: [TOOL_A] });
    const kinds = checkBudget(fewer, base, tolerance).map((p) => p.kind);
    expect(kinds).toContain('tool-count');
  });

  it('explains every problem and how to update the baseline', () => {
    const problems: BudgetProblem[] = [
      { kind: 'over', item: 'a', current: 150, baseline: 100, allowed: 40 },
      { kind: 'under', item: 'b', current: 50, baseline: 100, allowed: 40 },
      { kind: 'new-tool', item: 'c' },
      { kind: 'removed-tool', item: 'd' },
      { kind: 'tool-count', item: 'all.toolCount', current: 3, baseline: 2 },
    ];
    expect(problems.map(describeProblem)).toEqual([
      'a: 150 chars, over budget (baseline 100 + 40)',
      'b: 50 chars, below baseline 100 - 40; lock in the saving',
      'c: new tool, not in the baseline',
      'd: in the baseline but no longer listed',
      'all.toolCount: 3 tools, baseline has 2',
    ]);
    expect(formatProblems(problems)).toContain('npm run surface:update');
  });
});

describe('surface rendering', () => {
  it('formats signed character differences', () => {
    expect(formatCharDelta(100, 100)).toBe('±0');
    expect(formatCharDelta(1100, 1000)).toBe('+100 (+10.0%)');
    expect(formatCharDelta(900, 1000)).toBe('−100 (−10.0%)');
    expect(formatCharDelta(5, 0)).toBe('+5');
  });

  it('prints totals, modules and tools with ~tokens', () => {
    const report = renderSurfaceReport(measurement());
    expect(report).toContain('| `tools/list` total (compact JSON) |');
    expect(report).toContain('| Server instructions | 5 | ~1 | 5 | ~1 |');
    expect(report).toContain('### Per module');
    expect(report).toMatch(/\| `vault_read` \| `vault` \|/);
  });

  it('compares with main and lists changed tools in the CI summary', () => {
    const base = measurement();
    const current = grow(base, 'vault_read', 100);
    const md = renderSurfaceSummary({ current, baseline: base, main: base, problems: [] });
    expect(md).toContain('Baseline on `main`');
    expect(md).toContain('Tools that changed size');
    expect(md).toMatch(/\| `vault_read` \| [\d,]+ \| [\d,]+ \| \+100 /);
    expect(md).toContain('✅ Within the budget');
  });

  it('marks new and removed tools against main', () => {
    const base = measurement();
    const current = measurement({ ...SNAPSHOT, tools: [TOOL_A, { ...TOOL_B, name: 'ui_toast' }] });
    const md = renderSurfaceSummary({ current, baseline: base, main: base, problems: [] });
    expect(md).toMatch(/\| `ui_toast` \| _new_ \|/);
    expect(md).toMatch(/\| `ui_notice` \| [\d,]+ \| _removed_ \|/);
  });

  it('says when nothing changed, main has no baseline, or the budget fails', () => {
    const base = measurement();
    expect(
      renderSurfaceSummary({ current: base, baseline: base, main: base, problems: [] }),
    ).toContain('No tool changed size');
    const problems: BudgetProblem[] = [{ kind: 'new-tool', item: 'x' }];
    const md = renderSurfaceSummary({ current: base, baseline: base, main: null, problems });
    expect(md).toContain('on `main` yet');
    expect(md).toContain('❌ Does not match');
    expect(md).toContain('- x: new tool, not in the baseline');
    expect(
      renderSurfaceSummary({ current: base, baseline: null, main: null, problems: [] }),
    ).toContain('No valid `docs/surface-baseline.json`');
  });
});
