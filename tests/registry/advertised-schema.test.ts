import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  trimJsonSchema,
  withAdvertisedSchema,
} from '../../src/registry/advertised-schema';

const TARGET = { target: 'draft-2020-12' } as const;

describe('trimJsonSchema (#451)', () => {
  const zodSchema = z
    .strictObject({
      count: z.number().int().describe('How many'),
      offset: z.number().int().min(0),
      tags: z.record(z.string(), z.string()),
      keys: z.record(z.string().min(1).max(5), z.string()),
      mode: z.enum(['a', 'b']).default('a'),
      items: z.array(z.strictObject({ text: z.string().describe('Text') })),
      either: z.union([z.string().describe('S'), z.number().int()]),
    })
    .describe('Root');
  const json = zodSchema['~standard'].jsonSchema.input(TARGET);

  it('drops $schema, ±MAX_SAFE_INTEGER bounds and string-only propertyNames', () => {
    const trimmed = JSON.stringify(trimJsonSchema(json, 'input'));
    expect(JSON.stringify(json)).toContain('$schema');
    expect(trimmed).not.toContain('$schema');
    expect(trimmed).not.toContain(String(Number.MAX_SAFE_INTEGER));
    expect(trimmed).not.toContain('"propertyNames":{"type":"string"}');
  });

  it('keeps input descriptions, additionalProperties: false, required, real bounds and data', () => {
    const trimmed = trimJsonSchema(json, 'input');
    expect(trimmed).toMatchObject({
      type: 'object',
      description: 'Root',
      additionalProperties: false,
      required: expect.arrayContaining(['count', 'offset', 'tags', 'items']) as unknown,
      properties: {
        count: { type: 'integer', description: 'How many' },
        offset: { type: 'integer', minimum: 0 },
        tags: { type: 'object', additionalProperties: { type: 'string' } },
        keys: { propertyNames: { type: 'string', minLength: 1, maxLength: 5 } },
        mode: { enum: ['a', 'b'], default: 'a' },
        items: {
          items: { additionalProperties: false, properties: { text: { description: 'Text' } } },
        },
      },
    });
    expect(trimmed.properties).toHaveProperty('either.anyOf.0.description', 'S');
  });

  it('drops descriptions and additionalProperties: false in output schemas, keeping type', () => {
    const trimmed = trimJsonSchema(json, 'output');
    const text = JSON.stringify(trimmed);
    expect(text).not.toContain('"description"');
    expect(text).not.toContain('"additionalProperties":false');
    expect(trimmed.type).toBe('object');
    // A record's value schema is a subschema, not the boolean flag.
    expect(trimmed).toHaveProperty('properties.tags.additionalProperties', { type: 'string' });
  });

  it('keeps properties whose names look like keywords', () => {
    const named = z.object({
      description: z.string().describe('d'),
      $schema: z.string(),
      maximum: z.number(),
      type: z.string(),
    });
    const trimmed = trimJsonSchema(named['~standard'].jsonSchema.output(TARGET), 'output');
    expect(Object.keys(trimmed.properties as object)).toEqual([
      'description',
      '$schema',
      'maximum',
      'type',
    ]);
    expect(trimmed.required).toEqual(['description', '$schema', 'maximum', 'type']);
  });

  it('leaves the input object untouched', () => {
    const before = JSON.stringify(json);
    trimJsonSchema(json, 'output');
    expect(JSON.stringify(json)).toBe(before);
  });

  it('walks every subschema keyword', () => {
    const trimmed = trimJsonSchema(
      {
        $defs: { a: { description: 'x', maximum: Number.MAX_SAFE_INTEGER } },
        allOf: [{ description: 'x' }],
        oneOf: [{ description: 'x' }, true],
        prefixItems: [{ description: 'x' }],
        not: { description: 'x' },
        if: { description: 'x' },
        then: { description: 'x' },
        else: { description: 'x' },
        patternProperties: { '^a': { description: 'x' }, '^b': true },
        examples: [{ description: 'kept: data' }],
      },
      'output',
    );
    expect(trimmed).toEqual({
      $defs: { a: {} },
      allOf: [{}],
      oneOf: [{}, true],
      prefixItems: [{}],
      not: {},
      if: {},
      then: {},
      else: {},
      patternProperties: { '^a': {}, '^b': true },
      examples: [{ description: 'kept: data' }],
    });
  });
});

describe('withAdvertisedSchema (#451)', () => {
  const schema = z.strictObject({ n: z.number().int().describe('N') });

  it('validates exactly like the wrapped schema', async () => {
    const wrapped = withAdvertisedSchema(schema, 'input');
    for (const value of [{ n: 1 }, { n: 1.5 }, { n: 1, extra: true }, {}, null]) {
      const expected = await schema['~standard'].validate(value);
      expect(await wrapped['~standard'].validate(value)).toEqual(expected);
    }
    expect(wrapped['~standard'].vendor).toBe('zod');
    expect(wrapped['~standard'].version).toBe(1);
  });

  it('trims both JSON Schema directions for its role', () => {
    const input = withAdvertisedSchema(schema, 'input')['~standard'].jsonSchema;
    const output = withAdvertisedSchema(schema, 'output')['~standard'].jsonSchema;
    // Zod's ±MAX_SAFE_INTEGER bounds of .int() are both gone.
    const expectedInput = {
      type: 'object',
      properties: { n: { type: 'integer', description: 'N' } },
      required: ['n'],
      additionalProperties: false,
    };
    expect(input.input(TARGET)).toEqual(expectedInput);
    expect(input.output(TARGET)).toEqual(expectedInput);
    const expectedOutput = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] };
    expect(output.input(TARGET)).toEqual(expectedOutput);
    expect(output.output(TARGET)).toEqual(expectedOutput);
  });
});
