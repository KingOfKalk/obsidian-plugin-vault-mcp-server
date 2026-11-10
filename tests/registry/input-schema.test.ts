import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildInputSchema } from '../../src/registry/input-schema';
// A tool with a parameter named responseFormat (no real tool has one since
// #467): the alias response_format must still be rejected as unknown.
const shape = {
  path: z.string(),
  responseFormat: z.enum(['markdown', 'json']).default('markdown'),
};

describe('buildInputSchema without the response_format alias (#432)', () => {
  it('rejects response_format like any unknown parameter', () => {
    const schema = buildInputSchema(shape);
    const result = schema.safeParse({ path: 'a.md', response_format: 'json' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'Unknown parameter: response_format. Valid parameters: path, responseFormat.',
    );
  });

  it('rejects response_format even when responseFormat is also given', () => {
    const schema = buildInputSchema(shape);
    const result = schema.safeParse({
      path: 'a.md',
      response_format: 'json',
      responseFormat: 'markdown',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('Unknown parameter: response_format');
  });

  it('accepts responseFormat', () => {
    const schema = buildInputSchema(shape);
    expect(schema.parse({ path: 'a.md', responseFormat: 'json' })).toEqual({
      path: 'a.md',
      responseFormat: 'json',
    });
  });

  it('rejects response_format on a tool without responseFormat', () => {
    const schema = buildInputSchema({ path: z.string() });
    const result = schema.safeParse({ path: 'a.md', response_format: 'json' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain(
      'Unknown parameter: response_format',
    );
  });

  it('advertises only the current names in the JSON Schema', () => {
    const json = z.toJSONSchema(buildInputSchema(shape), { io: 'input' });
    expect(json.type).toBe('object');
    expect(json.additionalProperties).toBe(false);
    expect(Object.keys(json.properties ?? {})).toEqual(['path', 'responseFormat']);
  });
});
