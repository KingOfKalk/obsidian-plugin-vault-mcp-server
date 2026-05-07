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
