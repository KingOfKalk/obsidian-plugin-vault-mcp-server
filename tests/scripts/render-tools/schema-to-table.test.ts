import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  renderTypeCell,
  inputShapeToTable,
  outputSchemaToTables,
} from '../../../scripts/render-tools/schema-to-table';

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
