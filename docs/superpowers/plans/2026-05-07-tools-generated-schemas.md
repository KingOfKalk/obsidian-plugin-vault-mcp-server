# `tools.generated.md` per-tool schema sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tool input/output schema tables to the auto-generated tools docs by splitting it into an index (`docs/tools.generated.md`) + per-module pages (`docs/tools/<moduleId>.generated.md`).

**Architecture:** Pure renderer functions (`schema-to-table.ts`, `render.ts`) called by `scripts/list-tools.ts`. Internally use Zod v4's `z.toJSONSchema()` to normalise schemas, then walk the JSON Schema to build markdown tables. Top-level fields only, with a special case for discriminated unions (one variant table each).

**Tech Stack:** Node + tsx, Zod v4 (`^4.4.3`), Vitest, MCP SDK types.

**Spec:** [docs/superpowers/specs/2026-05-07-tools-generated-schemas-design.md](../specs/2026-05-07-tools-generated-schemas-design.md)

**Branch:** `docs/issue-320-tools-generated-schemas` (already created, off `origin/main`).

---

## File Structure

**Create:**
- `scripts/render-tools/json-schema.ts` — convert Zod input shapes / output schemas to JSON Schema; detect discriminated unions; small helper types.
- `scripts/render-tools/schema-to-table.ts` — pure functions that turn JSON Schema (or a Zod discriminated union) into markdown tables.
- `scripts/render-tools/render.ts` — compose per-tool sections, per-module pages, and the index page.
- `tests/scripts/render-tools/json-schema.test.ts`
- `tests/scripts/render-tools/schema-to-table.test.ts`
- `tests/scripts/render-tools/render.test.ts`
- `docs/tools/vault.generated.md` (and 7 sibling per-module files; regenerated, not hand-written).

**Modify:**
- `scripts/list-tools.ts` — switch from single-file output to directory output; orchestrate index + per-module writes.
- `tests/scripts/list-tools.test.ts` — adapt to the new orchestrator signature; keep coverage of the index content.
- `package.json` — `docs:tools` and `docs:check` scripts.
- `docs/tools.generated.md` — regenerated with new "Schemas →" links per module.

---

## Task 1: Baseline — confirm current state is green

**Files:** none (read-only verification).

- [ ] **Step 1: Confirm we're on the right branch**

Run: `git status && git rev-parse --abbrev-ref HEAD`
Expected: branch is `docs/issue-320-tools-generated-schemas`, working tree clean except for any untracked plan/spec files this PR is adding.

- [ ] **Step 2: Confirm baseline tests pass**

Run: `npm test`
Expected: all tests pass. If they don't, stop and investigate before making changes — the baseline must be green to give later steps a clean signal.

- [ ] **Step 3: Confirm baseline lint + typecheck pass**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed with no errors.

- [ ] **Step 4: Confirm baseline `docs:check` passes**

Run: `npm run docs:check`
Expected: succeeds (no diff against the committed `docs/tools.generated.md`).

No commit at the end of this task — it's a verification gate.

---

## Task 2: `json-schema.ts` — Zod → JSON Schema helpers

**Files:**
- Create: `scripts/render-tools/json-schema.ts`
- Test: `tests/scripts/render-tools/json-schema.test.ts`

This module wraps `z.toJSONSchema()` and adds the small helpers the renderer needs:

- `inputShapeToJsonSchema(shape: z.ZodRawShape): JsonSchema` — wrap in `z.object()`, convert.
- `outputSchemaToJsonSchema(schema: z.ZodRawShape | z.ZodTypeAny): JsonSchema` — accept both forms.
- `isDiscriminatedUnion(schema: z.ZodTypeAny): schema is z.ZodDiscriminatedUnion` — true when the original Zod schema is a discriminated union (we check the Zod side because zod@4.4.2's JSON Schema output uses plain `oneOf` without a `discriminator` key).
- `JsonSchema` type alias — `Record<string, unknown>` is fine for our purposes; we narrow at the use-site.

- [ ] **Step 1: Write the failing tests**

Create `tests/scripts/render-tools/json-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  inputShapeToJsonSchema,
  outputSchemaToJsonSchema,
  isDiscriminatedUnion,
} from '../../../scripts/render-tools/json-schema';

describe('scripts/render-tools/json-schema', () => {
  it('converts an input raw shape to a JSON object schema', () => {
    const shape = {
      path: z.string().min(1).max(10).describe('p'),
      n: z.number().int().min(0).default(20).describe('n'),
    };
    const json = inputShapeToJsonSchema(shape) as Record<string, unknown>;
    expect(json.type).toBe('object');
    const properties = json.properties as Record<string, Record<string, unknown>>;
    expect(properties.path.type).toBe('string');
    expect(properties.path.minLength).toBe(1);
    expect(properties.path.maxLength).toBe(10);
    expect(properties.path.description).toBe('p');
    expect(properties.n.default).toBe(20);
    expect(json.required).toEqual(['path']);
  });

  it('accepts a raw shape for the output schema and converts it', () => {
    const shape = { path: z.string().describe('out') };
    const json = outputSchemaToJsonSchema(shape) as Record<string, unknown>;
    expect(json.type).toBe('object');
  });

  it('accepts a full Zod schema (discriminated union) for the output schema', () => {
    const u = z.discriminatedUnion('aspect', [
      z.object({ aspect: z.literal('a'), x: z.string() }),
      z.object({ aspect: z.literal('b'), y: z.number() }),
    ]);
    const json = outputSchemaToJsonSchema(u) as Record<string, unknown>;
    expect(Array.isArray(json.oneOf)).toBe(true);
  });

  it('detects discriminated unions on the Zod side', () => {
    const u = z.discriminatedUnion('aspect', [
      z.object({ aspect: z.literal('a') }),
      z.object({ aspect: z.literal('b') }),
    ]);
    expect(isDiscriminatedUnion(u)).toBe(true);
    expect(isDiscriminatedUnion(z.object({ x: z.string() }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/render-tools/json-schema.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `scripts/render-tools/json-schema.ts`:

```ts
/**
 * Helpers around Zod v4's `z.toJSONSchema()` used by the tools-doc renderer.
 *
 * The renderer walks JSON Schema (a stable, normalised shape) rather than
 * Zod's internal `_def` so the renderer survives Zod version bumps as long as
 * `z.toJSONSchema()` keeps emitting the same fields. Discriminated unions are
 * the one case where we still inspect the Zod side: `z.toJSONSchema()` in
 * 4.4.x emits plain `oneOf` without a `discriminator` key, so detecting them
 * via the Zod schema is more direct.
 */

import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

export function inputShapeToJsonSchema(shape: z.ZodRawShape): JsonSchema {
  return z.toJSONSchema(z.object(shape)) as JsonSchema;
}

export function outputSchemaToJsonSchema(
  schema: z.ZodRawShape | z.ZodTypeAny,
): JsonSchema {
  const zodSchema =
    schema instanceof z.ZodType ? schema : z.object(schema);
  return z.toJSONSchema(zodSchema) as JsonSchema;
}

export function isDiscriminatedUnion(
  schema: z.ZodTypeAny,
): schema is z.ZodDiscriminatedUnion<string, z.ZodObject<z.ZodRawShape>[]> {
  return schema instanceof z.ZodDiscriminatedUnion;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/render-tools/json-schema.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-tools/json-schema.ts tests/scripts/render-tools/json-schema.test.ts
git commit -m "feat(scripts/render-tools): zod-to-json-schema helpers (#320)

Adds helpers that wrap Zod v4 z.toJSONSchema() for the upcoming
per-tool schema renderer: shape→schema for inputs, schema-or-shape→schema
for outputs, plus an isDiscriminatedUnion guard.

Refs #320"
```

---

## Task 3: `schema-to-table.ts` — type-cell renderer

**Files:**
- Create: `scripts/render-tools/schema-to-table.ts`
- Test: `tests/scripts/render-tools/schema-to-table.test.ts`

We start with the smallest pure helper: `renderTypeCell(field: JsonSchema): string`. Once this works, building the full table is trivial.

- [ ] **Step 1: Write the failing tests**

Create `tests/scripts/render-tools/schema-to-table.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderTypeCell } from '../../../scripts/render-tools/schema-to-table';

describe('renderTypeCell', () => {
  it('renders a plain string', () => {
    expect(renderTypeCell({ type: 'string' })).toBe('string');
  });

  it('renders a bounded string', () => {
    expect(
      renderTypeCell({ type: 'string', minLength: 1, maxLength: 4096 }),
    ).toBe('string (1–4096)');
  });

  it('renders a min-only string', () => {
    expect(renderTypeCell({ type: 'string', minLength: 1 })).toBe('string (≥1)');
  });

  it('renders a max-only string', () => {
    expect(renderTypeCell({ type: 'string', maxLength: 100 })).toBe('string (≤100)');
  });

  it('renders a plain number', () => {
    expect(renderTypeCell({ type: 'number' })).toBe('number');
  });

  it('renders a bounded number (treats integer like number)', () => {
    expect(
      renderTypeCell({ type: 'integer', minimum: 0, maximum: 100 }),
    ).toBe('number (0–100)');
  });

  it('renders boolean', () => {
    expect(renderTypeCell({ type: 'boolean' })).toBe('boolean');
  });

  it('renders an enum with pipe escaping', () => {
    expect(renderTypeCell({ enum: ['text', 'json'] })).toBe(
      'enum: `text` \\| `json`',
    );
  });

  it('renders a literal const', () => {
    expect(renderTypeCell({ const: 'frontmatter', type: 'string' })).toBe(
      'literal: `frontmatter`',
    );
  });

  it('renders an array of primitives', () => {
    expect(
      renderTypeCell({ type: 'array', items: { type: 'string' } }),
    ).toBe('string[]');
  });

  it('renders an array of objects', () => {
    expect(
      renderTypeCell({ type: 'array', items: { type: 'object' } }),
    ).toBe('object[]');
  });

  it('renders a plain object', () => {
    expect(renderTypeCell({ type: 'object' })).toBe('object');
  });

  it('falls back to unknown for anything else', () => {
    expect(renderTypeCell({})).toBe('unknown');
    expect(renderTypeCell({ type: 'something-weird' })).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts`
Expected: FAIL — module/function does not exist.

- [ ] **Step 3: Implement `renderTypeCell`**

Create `scripts/render-tools/schema-to-table.ts`:

```ts
/**
 * Pure renderers that turn a JSON Schema fragment (as emitted by
 * `z.toJSONSchema()`) into the markdown the tool docs use. Top-level fields
 * only — nested objects/arrays render as `object` / `object[]` and rely on
 * the parent field's description for detail.
 */

import { z } from 'zod';
import {
  type JsonSchema,
  outputSchemaToJsonSchema,
  isDiscriminatedUnion,
} from './json-schema';

export function renderTypeCell(field: JsonSchema): string {
  const type = field.type;
  if (typeof field.const === 'string') {
    return `literal: \`${field.const}\``;
  }
  if (Array.isArray(field.enum)) {
    const opts = field.enum.map((v) => `\`${String(v)}\``).join(' \\| ');
    return `enum: ${opts}`;
  }
  if (type === 'string') {
    return withRange('string', field.minLength, field.maxLength);
  }
  if (type === 'number' || type === 'integer') {
    return withRange('number', field.minimum, field.maximum);
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'array') {
    const items = (field.items ?? {}) as JsonSchema;
    if (items.type === 'object') return 'object[]';
    if (typeof items.type === 'string') return `${items.type}[]`;
    return 'unknown[]';
  }
  if (type === 'object') {
    return 'object';
  }
  return 'unknown';
}

function withRange(
  base: 'string' | 'number',
  min: unknown,
  max: unknown,
): string {
  const minN = typeof min === 'number' ? min : undefined;
  const maxN = typeof max === 'number' ? max : undefined;
  if (base === 'string') {
    if (minN !== undefined && maxN !== undefined) return `string (${minN}–${maxN})`;
    if (minN !== undefined) return `string (≥${minN})`;
    if (maxN !== undefined) return `string (≤${maxN})`;
    return 'string';
  }
  if (minN !== undefined && maxN !== undefined) return `number (${minN}–${maxN})`;
  if (minN !== undefined) return `number (≥${minN})`;
  if (maxN !== undefined) return `number (≤${maxN})`;
  return 'number';
}

// Re-export helpers needed by Task 4 / Task 5 so the call-site only imports
// from this module. Real implementations are added in later tasks.
export { outputSchemaToJsonSchema, isDiscriminatedUnion };
export type { JsonSchema };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts`
Expected: PASS — all `renderTypeCell` cases.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-tools/schema-to-table.ts tests/scripts/render-tools/schema-to-table.test.ts
git commit -m "feat(scripts/render-tools): renderTypeCell for JSON Schema (#320)

Adds the per-field type-cell renderer used by the tools-doc tables.
Handles strings/numbers (with min/max), booleans, enums (with pipe
escaping), literals, arrays of primitives or objects, and a sensible
unknown fallback.

Refs #320"
```

---

## Task 4: `inputShapeToTable` — full input table

**Files:**
- Modify: `scripts/render-tools/schema-to-table.ts`
- Modify: `tests/scripts/render-tools/schema-to-table.test.ts`

Builds on `renderTypeCell` to turn an input `z.ZodRawShape` into a complete markdown table. Required column comes from JSON Schema's `required` array; defaults render as `` no (default `X`) ``.

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Append to `tests/scripts/render-tools/schema-to-table.test.ts`:

```ts
import { z } from 'zod';
import { inputShapeToTable } from '../../../scripts/render-tools/schema-to-table';

describe('inputShapeToTable', () => {
  it('renders a header and one row per top-level field', () => {
    const shape = {
      path: z.string().min(1).max(4096).describe('Vault path'),
      format: z.enum(['text', 'json']).default('text').describe('Output format'),
    };
    const md = inputShapeToTable(shape);
    expect(md).toContain('| Field | Type | Required | Description |');
    expect(md).toContain('|---|---|---|---|');
    expect(md).toMatch(/\| `path` \| string \(1–4096\) \| yes \| Vault path \|/);
    expect(md).toMatch(
      /\| `format` \| enum: `text` \\\| `json` \| no \(default `text`\) \| Output format \|/,
    );
  });

  it('marks optional fields without defaults as not required', () => {
    const shape = {
      date: z.string().optional().describe('Optional date'),
    };
    const md = inputShapeToTable(shape);
    expect(md).toMatch(/\| `date` \| string \| no \| Optional date \|/);
  });

  it('escapes pipes inside descriptions', () => {
    const shape = { x: z.string().describe('a | b') };
    const md = inputShapeToTable(shape);
    expect(md).toMatch(/\| `x` \| string \| yes \| a \\\| b \|/);
  });

  it('collapses internal whitespace in descriptions', () => {
    const shape = { x: z.string().describe('line one\n  line two') };
    const md = inputShapeToTable(shape);
    expect(md).toMatch(/\| `x` \| string \| yes \| line one line two \|/);
  });

  it('returns an empty-table marker for empty shapes', () => {
    const md = inputShapeToTable({});
    expect(md).toContain('_No input parameters._');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts -t inputShapeToTable`
Expected: FAIL — `inputShapeToTable` not exported.

- [ ] **Step 3: Implement `inputShapeToTable` (and helpers)**

Add to `scripts/render-tools/schema-to-table.ts`:

```ts
import { inputShapeToJsonSchema } from './json-schema';

export function inputShapeToTable(shape: z.ZodRawShape): string {
  const json = inputShapeToJsonSchema(shape);
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set(
    Array.isArray(json.required) ? (json.required as string[]) : [],
  );
  const names = Object.keys(properties);
  if (names.length === 0) return '_No input parameters._';

  const lines: string[] = [];
  lines.push('| Field | Type | Required | Description |');
  lines.push('|---|---|---|---|');
  for (const name of names) {
    const field = properties[name];
    const type = renderTypeCell(field);
    const requiredCell = renderRequiredCell(field, required.has(name));
    const description = renderDescription(field.description);
    lines.push(`| \`${name}\` | ${type} | ${requiredCell} | ${description} |`);
  }
  return lines.join('\n');
}

function renderRequiredCell(field: JsonSchema, isRequired: boolean): string {
  if (field.default !== undefined) {
    return `no (default \`${formatDefault(field.default)}\`)`;
  }
  return isRequired ? 'yes' : 'no';
}

function formatDefault(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function renderDescription(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts`
Expected: PASS — all existing + new cases.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-tools/schema-to-table.ts tests/scripts/render-tools/schema-to-table.test.ts
git commit -m "feat(scripts/render-tools): inputShapeToTable (#320)

Renders a Zod input shape as a markdown table with Field / Type /
Required / Description columns. Required column reflects JSON Schema's
required[] plus default-as-implicit-optional. Pipes in descriptions
are escaped; whitespace is collapsed.

Refs #320"
```

---

## Task 5: `outputSchemaToTables` — flat raw-shape output

**Files:**
- Modify: `scripts/render-tools/schema-to-table.ts`
- Modify: `tests/scripts/render-tools/schema-to-table.test.ts`

Output tables drop the Required column. This task covers the raw-shape case (the common one). The discriminated-union case is Task 6.

- [ ] **Step 1: Write the failing tests (append)**

Append to `tests/scripts/render-tools/schema-to-table.test.ts`:

```ts
import { outputSchemaToTables } from '../../../scripts/render-tools/schema-to-table';

describe('outputSchemaToTables (flat shapes)', () => {
  it('renders the no-output marker when schema is undefined', () => {
    expect(outputSchemaToTables(undefined)).toContain(
      '_No `structuredContent` declared — returns plain text or binary._',
    );
  });

  it('renders a flat raw shape with three columns', () => {
    const shape = {
      path: z.string().describe('Vault path'),
      content: z.string().describe('File content'),
    };
    const md = outputSchemaToTables(shape);
    expect(md).toContain('| Field | Type | Description |');
    expect(md).toContain('|---|---|---|');
    expect(md).toMatch(/\| `path` \| string \| Vault path \|/);
    expect(md).toMatch(/\| `content` \| string \| File content \|/);
  });

  it('handles arrays of objects and arrays of primitives', () => {
    const shape = {
      items: z.array(z.object({ a: z.string() })).describe('list of items'),
      tags: z.array(z.string()).describe('list of tags'),
    };
    const md = outputSchemaToTables(shape);
    expect(md).toMatch(/\| `items` \| object\[\] \| list of items \|/);
    expect(md).toMatch(/\| `tags` \| string\[\] \| list of tags \|/);
  });

  it('falls back to a one-line note when the schema converts to something unrecognised', () => {
    // A bare boolean — z.toJSONSchema(z.boolean()) does not produce object/oneOf.
    const md = outputSchemaToTables(z.boolean());
    expect(md).toContain('_Output schema present but not renderable as a table._');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts -t outputSchemaToTables`
Expected: FAIL — `outputSchemaToTables` not exported.

- [ ] **Step 3: Implement `outputSchemaToTables` (flat case only)**

Add to `scripts/render-tools/schema-to-table.ts`:

```ts
const NO_OUTPUT_MARKER =
  '_No `structuredContent` declared — returns plain text or binary._';
const UNRENDERABLE_MARKER =
  '_Output schema present but not renderable as a table._';

export function outputSchemaToTables(
  schema: z.ZodRawShape | z.ZodTypeAny | undefined,
): string {
  if (schema === undefined) return NO_OUTPUT_MARKER;

  // Discriminated-union special case: implemented in Task 6.
  // For now, flat case only.
  const json = outputSchemaToJsonSchema(schema);
  if (json.type === 'object' && json.properties) {
    return renderFlatOutputTable(json);
  }
  return UNRENDERABLE_MARKER;
}

function renderFlatOutputTable(json: JsonSchema): string {
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const lines: string[] = [];
  lines.push('| Field | Type | Description |');
  lines.push('|---|---|---|');
  for (const name of Object.keys(properties)) {
    const field = properties[name];
    const type = renderTypeCell(field);
    const description = renderDescription(field.description);
    lines.push(`| \`${name}\` | ${type} | ${description} |`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts`
Expected: PASS — all cases including the new ones.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-tools/schema-to-table.ts tests/scripts/render-tools/schema-to-table.test.ts
git commit -m "feat(scripts/render-tools): outputSchemaToTables flat case (#320)

Renders raw-shape output schemas as a Field/Type/Description table.
Tools without an outputSchema get a no-structuredContent marker line;
schemas that don't shape into properties get a graceful unrenderable
fallback. Discriminated unions are next.

Refs #320"
```

---

## Task 6: `outputSchemaToTables` — discriminated-union case

**Files:**
- Modify: `scripts/render-tools/schema-to-table.ts`
- Modify: `tests/scripts/render-tools/schema-to-table.test.ts`

Detect `ZodDiscriminatedUnion` on the Zod side, then iterate variants. Each variant is a `z.object` we can convert independently and render with the flat helper. The discriminator value is taken from each variant's literal field.

- [ ] **Step 1: Write the failing tests (append)**

Append to `tests/scripts/render-tools/schema-to-table.test.ts`:

```ts
describe('outputSchemaToTables (discriminated union)', () => {
  it('renders one variant table per branch', () => {
    const u = z.discriminatedUnion('aspect', [
      z.object({
        aspect: z.literal('frontmatter'),
        path: z.string().describe('p'),
        frontmatter: z.record(z.string(), z.unknown()).describe('fm'),
      }),
      z.object({
        aspect: z.literal('headings'),
        path: z.string().describe('p'),
        headings: z.array(z.object({ heading: z.string(), level: z.number() })).describe('h'),
      }),
    ]);
    const md = outputSchemaToTables(u);
    expect(md).toContain('**When `aspect` is `frontmatter`**');
    expect(md).toContain('**When `aspect` is `headings`**');
    // Frontmatter variant table
    expect(md).toMatch(/\| `aspect` \| literal: `frontmatter` \| /);
    expect(md).toMatch(/\| `frontmatter` \| object \| fm \|/);
    // Headings variant table
    expect(md).toMatch(/\| `aspect` \| literal: `headings` \| /);
    expect(md).toMatch(/\| `headings` \| object\[\] \| h \|/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts -t "discriminated union"`
Expected: FAIL — current implementation goes down the unrenderable path for unions.

- [ ] **Step 3: Wire the union case into `outputSchemaToTables`**

Modify `scripts/render-tools/schema-to-table.ts`:

```ts
export function outputSchemaToTables(
  schema: z.ZodRawShape | z.ZodTypeAny | undefined,
): string {
  if (schema === undefined) return NO_OUTPUT_MARKER;

  if (schema instanceof z.ZodType && isDiscriminatedUnion(schema)) {
    return renderDiscriminatedUnionTables(schema);
  }

  const json = outputSchemaToJsonSchema(schema);
  if (json.type === 'object' && json.properties) {
    return renderFlatOutputTable(json);
  }
  return UNRENDERABLE_MARKER;
}

function renderDiscriminatedUnionTables(
  union: z.ZodDiscriminatedUnion<string, z.ZodObject<z.ZodRawShape>[]>,
): string {
  const discriminator = union.def.discriminator;
  const sections: string[] = [];
  for (const option of union.def.options) {
    const json = outputSchemaToJsonSchema(option);
    const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
    const discField = properties[discriminator];
    const literal =
      discField && typeof discField.const === 'string' ? discField.const : '?';
    sections.push(`**When \`${discriminator}\` is \`${literal}\`**`);
    sections.push('');
    sections.push(renderFlatOutputTable(json));
    sections.push('');
  }
  return sections.join('\n').trimEnd();
}
```

The cast on `union.def.options` matches what `z.discriminatedUnion` accepts at the type level; if Zod's exported types make this awkward, an `as` to `z.ZodObject<z.ZodRawShape>[]` is acceptable here — these are scripts, not the plugin runtime.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/render-tools/schema-to-table.test.ts`
Expected: PASS — all cases including the new union case.

- [ ] **Step 5: Sanity-check against the real `vault_get_aspect` schema**

Run: `npx tsx -e "import('./src/tools/index.ts').then(async () => {
  const { MockObsidianAdapter } = await import('./src/obsidian/mock-adapter');
  const { discoverModules } = await import('./src/tools');
  const { outputSchemaToTables } = await import('./scripts/render-tools/schema-to-table');
  const vault = discoverModules(new MockObsidianAdapter()).find((m) => m.metadata.id === 'vault');
  const tool = vault.tools().find((t) => t.name === 'vault_get_aspect');
  console.log(outputSchemaToTables(tool.outputSchema));
})"`
Expected: 6 variant headings (frontmatter, headings, outgoing_links, embeds, backlinks, block_references), each followed by a Field/Type/Description table.

- [ ] **Step 6: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add scripts/render-tools/schema-to-table.ts tests/scripts/render-tools/schema-to-table.test.ts
git commit -m "feat(scripts/render-tools): discriminated-union output tables (#320)

Detects Zod discriminated unions and emits one variant table per
branch under a 'When <discriminator> is <literal>' heading. Tested
against the synthetic case; verified manually against vault_get_aspect's
six aspects.

Refs #320"
```

---

## Task 7: `render.ts` — module-page composer

**Files:**
- Create: `scripts/render-tools/render.ts`
- Test: `tests/scripts/render-tools/render.test.ts`

`renderModulePage(row)` composes a per-module markdown page. `row` is the existing `ToolRow` shape from `scripts/list-tools.ts`, with one addition: each tool needs to carry its `description`, `schema`, and `outputSchema` (for the renderer to hand to the schema-to-table helpers). The `ToolRow` type lives in `list-tools.ts`; we'll widen it in Task 9.

For now we accept what the renderer needs as a self-contained `ToolDoc` type so tests don't depend on the registry.

- [ ] **Step 1: Write the failing tests**

Create `tests/scripts/render-tools/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { renderModulePage, type ToolDoc, type ModuleDoc } from '../../../scripts/render-tools/render';

const sampleModule: ModuleDoc = {
  moduleId: 'sample',
  moduleName: 'Sample Module',
  tools: [
    {
      name: 'sample_read',
      title: 'Read sample',
      description: 'Reads a sample.\n\nArgs:\n- path (string)',
      schema: { path: z.string().min(1).describe('Path') },
      outputSchema: { path: z.string().describe('Path read') },
    } satisfies ToolDoc,
    {
      name: 'sample_write',
      title: 'Write sample',
      description: 'Writes a sample.',
      schema: { path: z.string().describe('Path'), content: z.string().describe('Body') },
      outputSchema: undefined,
    } satisfies ToolDoc,
  ],
};

describe('renderModulePage', () => {
  it('starts with the auto-generated banner and an H1', () => {
    const md = renderModulePage(sampleModule);
    expect(md.split('\n')[0]).toContain('AUTO-GENERATED');
    expect(md).toMatch(/^# Sample Module \(`sample`\)/m);
  });

  it('renders one section per tool with name, title, description, and Input table', () => {
    const md = renderModulePage(sampleModule);
    expect(md).toContain('### sample_read');
    expect(md).toContain('Read sample');
    expect(md).toContain('Reads a sample.');
    expect(md).toContain('#### Input');
    expect(md).toMatch(/\| `path` \| string \(≥1\) \| yes \| Path \|/);
  });

  it('renders an Output section for tools that declare outputSchema', () => {
    const md = renderModulePage(sampleModule);
    expect(md).toContain('#### Output');
    expect(md).toMatch(/\| `path` \| string \| Path read \|/);
  });

  it('renders the no-output marker for tools without outputSchema', () => {
    const md = renderModulePage(sampleModule);
    // The sample_write section should contain the marker, not a table.
    const writeSection = md.split('### sample_write')[1];
    expect(writeSection).toContain(
      '_No `structuredContent` declared — returns plain text or binary._',
    );
    expect(writeSection.split('### ')[0]).not.toContain('| Field | Type | Description |');
  });

  it('preserves the order tools were registered in', () => {
    const md = renderModulePage(sampleModule);
    expect(md.indexOf('### sample_read')).toBeLessThan(md.indexOf('### sample_write'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/render-tools/render.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `render.ts`**

Create `scripts/render-tools/render.ts`:

```ts
/**
 * Composes the per-module pages and the index page that together form
 * `docs/tools.generated.md` + `docs/tools/<module>.generated.md`. Pure
 * string functions — file I/O lives in `scripts/list-tools.ts`.
 */

import { z } from 'zod';
import { inputShapeToTable, outputSchemaToTables } from './schema-to-table';

export interface ToolDoc {
  name: string;
  title: string;
  description: string;
  schema: z.ZodRawShape;
  outputSchema: z.ZodRawShape | z.ZodTypeAny | undefined;
}

export interface ModuleDoc {
  moduleId: string;
  moduleName: string;
  tools: ToolDoc[];
}

const BANNER =
  '<!-- AUTO-GENERATED by `npm run docs:tools`. Do not edit manually. -->';

export function renderModulePage(module: ModuleDoc): string {
  const lines: string[] = [];
  lines.push(BANNER);
  lines.push('');
  lines.push(`# ${module.moduleName} (\`${module.moduleId}\`)`);
  lines.push('');
  lines.push(
    `Auto-generated schema reference for the \`${module.moduleId}\` module. See [../tools.generated.md](../tools.generated.md) for the full registry index.`,
  );
  lines.push('');

  for (const tool of module.tools) {
    lines.push(`### ${tool.name}`);
    lines.push('');
    lines.push(`**${tool.title}**`);
    lines.push('');
    lines.push(tool.description.trim());
    lines.push('');
    lines.push('#### Input');
    lines.push('');
    lines.push(inputShapeToTable(tool.schema));
    lines.push('');
    lines.push('#### Output');
    lines.push('');
    lines.push(outputSchemaToTables(tool.outputSchema));
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/render-tools/render.test.ts`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-tools/render.ts tests/scripts/render-tools/render.test.ts
git commit -m "feat(scripts/render-tools): renderModulePage (#320)

Composes a per-module markdown page: banner, H1 'Module Name (id)',
back-link to the index, then one H3 section per tool with title,
description, input table, and output table (or no-structuredContent
marker).

Refs #320"
```

---

## Task 8: `renderIndexPage` — extend the index with schema links

**Files:**
- Modify: `scripts/render-tools/render.ts`
- Modify: `tests/scripts/render-tools/render.test.ts`

The index keeps its existing summary table + "Tools by module" annotation tables but adds a schema-link line under each per-module heading.

- [ ] **Step 1: Write the failing tests (append)**

Append to `tests/scripts/render-tools/render.test.ts`:

```ts
import { renderIndexPage } from '../../../scripts/render-tools/render';

describe('renderIndexPage', () => {
  it('keeps the existing summary banner, summary table, and totals line', () => {
    const md = renderIndexPage([sampleModule]);
    expect(md).toContain('AUTO-GENERATED');
    expect(md).toContain('# Tool Registry Snapshot');
    expect(md).toContain('| Module ID | Module Name | Count | Tools |');
    expect(md).toMatch(/\*\*Total tools:\*\* 2 across 1 modules\./);
  });

  it('keeps the per-module annotation tables', () => {
    const md = renderIndexPage([sampleModule]);
    expect(md).toContain('### Sample Module (`sample`)');
    expect(md).toContain('| Name | Title | readOnly | destructive |');
    expect(md).toContain('| `sample_read` | Read sample |');
  });

  it('adds a schema link line per module', () => {
    const md = renderIndexPage([sampleModule]);
    expect(md).toContain('Schemas → [docs/tools/sample.generated.md](tools/sample.generated.md)');
  });
});
```

The annotation columns in `renderIndexPage` need to know `readOnly` / `destructive`; the input type widens to include those flags. Update the test fixture:

```ts
const sampleModule: ModuleDoc = {
  moduleId: 'sample',
  moduleName: 'Sample Module',
  tools: [
    {
      name: 'sample_read',
      title: 'Read sample',
      description: 'Reads a sample.\n\nArgs:\n- path (string)',
      schema: { path: z.string().min(1).describe('Path') },
      outputSchema: { path: z.string().describe('Path read') },
      readOnly: true,
      destructive: false,
    } satisfies ToolDoc,
    {
      name: 'sample_write',
      title: 'Write sample',
      description: 'Writes a sample.',
      schema: { path: z.string().describe('Path'), content: z.string().describe('Body') },
      outputSchema: undefined,
      readOnly: false,
      destructive: false,
    } satisfies ToolDoc,
  ],
};
```

(Replace the existing `sampleModule` definition with this expanded one — the `renderModulePage` tests still pass because they don't depend on the new flags.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/render-tools/render.test.ts -t renderIndexPage`
Expected: FAIL — `renderIndexPage` not exported, `readOnly`/`destructive` not in `ToolDoc`.

- [ ] **Step 3: Widen `ToolDoc` and implement `renderIndexPage`**

Modify `scripts/render-tools/render.ts`:

```ts
export interface ToolDoc {
  name: string;
  title: string;
  description: string;
  schema: z.ZodRawShape;
  outputSchema: z.ZodRawShape | z.ZodTypeAny | undefined;
  readOnly: boolean;
  destructive: boolean;
}

function check(value: boolean): string {
  return value ? '✓' : '';
}

export function renderIndexPage(modules: ModuleDoc[]): string {
  const lines: string[] = [];
  lines.push(BANNER);
  lines.push('');
  lines.push('# Tool Registry Snapshot');
  lines.push('');
  lines.push(
    'This file is regenerated from the tool registry and committed so CI can detect doc drift.',
  );
  lines.push('');

  // Summary table — preserved verbatim from the previous renderer.
  lines.push('| Module ID | Module Name | Count | Tools |');
  lines.push('|---|---|---|---|');
  let total = 0;
  for (const m of modules) {
    total += m.tools.length;
    const names = m.tools.map((t) => t.name).join(', ');
    lines.push(
      `| \`${m.moduleId}\` | ${m.moduleName} | ${String(m.tools.length)} | ${names} |`,
    );
  }
  lines.push('');
  lines.push(`**Total tools:** ${String(total)} across ${String(modules.length)} modules.`);
  lines.push('');

  // Per-module annotation tables, each prefixed by the schema link.
  lines.push('## Tools by module');
  lines.push('');
  for (const m of modules) {
    lines.push(`### ${m.moduleName} (\`${m.moduleId}\`)`);
    lines.push('');
    lines.push(
      `Schemas → [docs/tools/${m.moduleId}.generated.md](tools/${m.moduleId}.generated.md)`,
    );
    lines.push('');
    lines.push('| Name | Title | readOnly | destructive |');
    lines.push('|---|---|---|---|');
    for (const t of m.tools) {
      lines.push(
        `| \`${t.name}\` | ${t.title} | ${check(t.readOnly)} | ${check(t.destructive)} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/render-tools/render.test.ts`
Expected: PASS — both `renderModulePage` and `renderIndexPage` cases.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-tools/render.ts tests/scripts/render-tools/render.test.ts
git commit -m "feat(scripts/render-tools): renderIndexPage (#320)

Reproduces the existing index content (summary table, totals, per-module
annotation tables) and adds a 'Schemas → docs/tools/<module>.generated.md'
link line under each module heading.

Refs #320"
```

---

## Task 9: Wire `scripts/list-tools.ts` to write a directory

**Files:**
- Modify: `scripts/list-tools.ts`
- Modify: `tests/scripts/list-tools.test.ts`

The script becomes a thin orchestrator: collect rows, call `renderIndexPage` and `renderModulePage`, write files. Output target switches from a single file path to a directory path. The existing `collectToolRows()` API expands to also carry `description`, `schema`, `outputSchema`.

- [ ] **Step 1: Update existing tests for the new signature**

Modify `tests/scripts/list-tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collectToolRows, renderIndexPage, renderModulePage } from '../../scripts/list-tools';

describe('scripts/list-tools', () => {
  it('collects all registered modules with tool docs', () => {
    const rows = collectToolRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.moduleId).not.toBe('');
      expect(row.moduleName).not.toBe('');
      expect(row.tools.length).toBeGreaterThan(0);
      for (const t of row.tools) {
        expect(typeof t.name).toBe('string');
        expect(typeof t.title).toBe('string');
        expect(typeof t.description).toBe('string');
        expect(typeof t.schema).toBe('object');
      }
    }
  });

  it('renderIndexPage carries the auto-generated banner and totals', () => {
    const rows = collectToolRows();
    const md = renderIndexPage(rows);
    expect(md).toContain('AUTO-GENERATED');
    expect(md).toContain('| Module ID |');
    expect(md).toMatch(/\*\*Total tools:\*\* \d+ across \d+ modules\./);
  });

  it('every tool name appears in the index annotation tables', () => {
    const rows = collectToolRows();
    const md = renderIndexPage(rows);
    for (const row of rows) {
      for (const tool of row.tools) {
        expect(md).toContain(`| \`${tool.name}\` | ${tool.title} |`);
      }
    }
  });

  it('every tool name appears in its module page', () => {
    const rows = collectToolRows();
    for (const row of rows) {
      const md = renderModulePage(row);
      for (const tool of row.tools) {
        expect(md).toContain(`### ${tool.name}`);
      }
    }
  });

  it('the vault module page renders the vault_get_aspect discriminated union', () => {
    const rows = collectToolRows();
    const vault = rows.find((r) => r.moduleId === 'vault');
    expect(vault).toBeDefined();
    if (!vault) return;
    const md = renderModulePage(vault);
    expect(md).toContain('### vault_get_aspect');
    expect(md).toContain('**When `aspect` is `frontmatter`**');
    expect(md).toContain('**When `aspect` is `headings`**');
    expect(md).toContain('**When `aspect` is `outgoing_links`**');
    expect(md).toContain('**When `aspect` is `embeds`**');
    expect(md).toContain('**When `aspect` is `backlinks`**');
    expect(md).toContain('**When `aspect` is `block_references`**');
  });

  it('the ui module page shows the no-structuredContent marker for ui_notice', () => {
    const rows = collectToolRows();
    const ui = rows.find((r) => r.moduleId === 'ui');
    expect(ui).toBeDefined();
    if (!ui) return;
    const md = renderModulePage(ui);
    expect(md).toContain(
      '_No `structuredContent` declared — returns plain text or binary._',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/list-tools.test.ts`
Expected: FAIL — `renderIndexPage`/`renderModulePage` not yet exported from `list-tools.ts`; `description`/`schema` not on the row type.

- [ ] **Step 3: Rewrite `scripts/list-tools.ts`**

Replace `scripts/list-tools.ts` with:

```ts
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
import { z } from 'zod';
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
      outputSchema: t.outputSchema as z.ZodRawShape | z.ZodTypeAny | undefined,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/list-tools.test.ts`
Expected: PASS — all cases.

- [ ] **Step 5: Run lint + typecheck**

Run: `npm run lint`
Run: `npm run typecheck`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add scripts/list-tools.ts tests/scripts/list-tools.test.ts
git commit -m "refactor(scripts/list-tools): write index + per-module pages (#320)

Splits the docs/tools.generated.md output into an index file plus one
per-module page under docs/tools/<moduleId>.generated.md. CLI now takes
a directory (default ./docs) instead of a single file path. Module rows
now carry description / schema / outputSchema for the renderer.

Refs #320"
```

---

## Task 10: Update `package.json` scripts

**Files:**
- Modify: `package.json`

`docs:tools` writes into `./docs`. `docs:check` regenerates into `/tmp/tools.check` and runs both a single-file diff (the index) and a recursive diff (the per-module dir).

- [ ] **Step 1: Update `package.json`**

In the `scripts` block, replace:

```json
"docs:tools": "tsx scripts/list-tools.ts docs/tools.generated.md",
"docs:check": "tsx scripts/list-tools.ts /tmp/tools.check.md && diff -u docs/tools.generated.md /tmp/tools.check.md"
```

with:

```json
"docs:tools": "tsx scripts/list-tools.ts docs",
"docs:check": "rm -rf /tmp/tools.check && mkdir -p /tmp/tools.check && tsx scripts/list-tools.ts /tmp/tools.check && diff -u docs/tools.generated.md /tmp/tools.check/tools.generated.md && diff -ru docs/tools/ /tmp/tools.check/tools/"
```

- [ ] **Step 2: Sanity-check the script line**

Run: `node -e "console.log(require('./package.json').scripts['docs:check'])"`
Expected: prints the new `docs:check` command.

- [ ] **Step 3: Do NOT run `docs:check` yet** — there are no `docs/tools/*.generated.md` files committed, so the recursive diff would fail. Task 11 generates them.

No commit at this task boundary; the change is folded into Task 11's commit so the repo never has a "broken `docs:check`" state across commits.

---

## Task 11: Regenerate the docs and commit them

**Files:**
- Create: `docs/tools/vault.generated.md` (and 7 sibling per-module files).
- Modify: `docs/tools.generated.md` (regenerated; gains schema-link rows).
- Modify: `package.json` (already edited in Task 10 — staged here).

- [ ] **Step 1: Regenerate**

Run: `npm run docs:tools`
Expected: `Wrote docs/tools.generated.md and 8 per-module pages under docs/tools`.

- [ ] **Step 2: Inspect the output**

Run: `ls docs/tools/`
Expected: 8 files — `vault.generated.md`, `editor.generated.md`, `search.generated.md`, `workspace.generated.md`, `ui.generated.md`, `templates.generated.md`, `plugin-interop.generated.md`, `extras.generated.md`.

Read a couple of the generated files (e.g. `docs/tools/vault.generated.md` and `docs/tools/ui.generated.md`) and visually confirm:
- Banner is present.
- Each tool has `### <name>`, title, description, Input table, Output (or marker).
- `vault_get_aspect` shows six variant blocks.
- `ui_notice` shows the no-structuredContent marker.

If anything looks off (missing field, malformed cell, weird whitespace), fix it back in the renderer code, re-run, and re-inspect. Only proceed when the output reads cleanly.

- [ ] **Step 3: Run `docs:check`**

Run: `npm run docs:check`
Expected: succeeds (no diff against the just-committed regeneration… wait, we haven't committed yet — let's verify by running `docs:check` after `git add` so the working tree matches what's about to be committed). Re-run order:

```
npm run docs:tools
npm run docs:check
```

The second call regenerates into `/tmp/tools.check` and diffs against the working tree. Expected: zero diff.

- [ ] **Step 4: Run lint + typecheck + full test suite**

Run: `npm test`
Run: `npm run lint`
Run: `npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add package.json docs/tools.generated.md docs/tools/
git commit -m "docs(tools.generated): per-tool schema sections (#320)

Regenerates docs/tools.generated.md as an index that links to per-module
schema pages under docs/tools/<moduleId>.generated.md. Each per-module
page lists every tool's input table (Field/Type/Required/Description)
and output table where the tool declares an outputSchema; tools without
one show the no-structuredContent marker line. vault_get_aspect renders
one variant table per discriminated-union branch.

Updates docs:tools and docs:check accordingly.

Closes acceptance items #1, #2, #4 of #320. Examples (acceptance #3)
deferred to a follow-up.

Refs #320"
```

---

## Task 12: Open the follow-up issue for examples

**Files:** none (GitHub issue, not a file change).

- [ ] **Step 1: Open the issue via `gh`**

Run:

```bash
gh issue create \
  --title "docs(tools.generated): add example request/response per tool family" \
  --body "$(cat <<'EOF'
Surfaced as the deferred portion of #320. The schema work landed there closed
acceptance items #1, #2, and #4. Item #3 — at least one example
request/response per tool family — was scoped out and is tracked here.

## Approach to decide

- Hand-written `tests/fixtures/tool-examples/<tool>.json` fixtures.
- Generate from existing handler/integration tests via a small helper.
- Live-call against `MockObsidianAdapter` from \`scripts/list-tools.ts\` and capture the real \`CallToolResult\`.

See the design doc that originally captured the deferral:
\`docs/superpowers/specs/2026-05-07-tools-generated-schemas-design.md\`.

## Acceptance

- [ ] At least one \`{ request, response }\` example per tool family rendered
      under each tool's section in \`docs/tools/<module>.generated.md\`.
- [ ] \`npm run docs:check\` still green.

Refs #320, #264 (PRD audit DR8).
EOF
)" \
  --label documentation
```

Expected: issue URL printed.

- [ ] **Step 2: Note the issue number**

Take the issue number from the URL and record it in the PR description for #320 ("Follow-up: #<NEW>").

No commit at this task boundary — the follow-up is just a GitHub issue.

---

## Task 13: Open the PR

**Files:** none (PR creation).

- [ ] **Step 1: Push the branch**

Run: `git push -u origin docs/issue-320-tools-generated-schemas`
Expected: branch pushed; `gh` will pick it up.

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create \
  --title "docs(tools.generated): per-tool input/output schemas (#320)" \
  --body "$(cat <<'EOF'
Closes #320 (acceptance items #1, #2, #4). Examples deferred to follow-up
issue #<NEW> (replace with the number from Task 12).

## Summary
- Splits \`docs/tools.generated.md\` into an index plus per-module schema pages under \`docs/tools/<module>.generated.md\`.
- Adds Input (Field/Type/Required/Description) and Output (Field/Type/Description) tables per tool.
- Special-cases discriminated unions — \`vault_get_aspect\` renders one variant table per aspect.
- Updates \`docs:tools\` / \`docs:check\` to operate on the directory.

## Test plan
- \`npm test\` (passes; unit tests for json-schema, schema-to-table, render, and the integration smoke in list-tools)
- \`npm run lint\` / \`npm run typecheck\`
- \`npm run docs:check\` (zero diff against the committed regeneration)
- Visually skimmed \`docs/tools/vault.generated.md\` and \`docs/tools/ui.generated.md\` for sane formatting.
EOF
)"
```

Expected: PR URL printed. CI runs.

- [ ] **Step 3: Replace the placeholder follow-up issue number**

Run: `gh pr edit <PR-NUMBER> --body "<paste the body with the real issue number>"`
Or edit via the web UI.

- [ ] **Step 4: Watch CI**

Run: `gh pr checks <PR-NUMBER> --watch`
Expected: all checks green. If `docs:check` fails, the working tree drifted from the regeneration — re-run `npm run docs:tools`, commit, push.

---

## Notes for the implementer

- **Ordering matters.** Tasks 1 → 11 must run sequentially (each depends on the previous). Tasks 12 and 13 happen after the implementation commits land locally.
- **TDD discipline.** Every renderer task writes the test first, runs it, sees it fail, then implements. Don't skip the failing run — it's the proof your test actually exercises the new code.
- **Don't rewrite the description text.** Each tool's `description` is authored via `describeTool()` and is the source of truth. The renderer drops it in verbatim, trimmed.
- **No CLAUDE.md edit.** Existing rule about `npm run docs:tools` after registry changes still holds; the same command now also writes the per-module pages.
- **Help docs.** This change is internal documentation only — no user-facing surface changes — so `docs/help/en.md` does not need updating per project rule 5.
