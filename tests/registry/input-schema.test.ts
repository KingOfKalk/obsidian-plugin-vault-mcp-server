import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  applyDeprecatedAliases,
  buildInputSchema,
} from '../../src/registry/input-schema';
import { responseFormatField } from '../../src/tools/shared/response';

const shape = {
  path: z.string(),
  ...responseFormatField,
};

describe('buildInputSchema deprecated aliases (#392)', () => {
  it('maps response_format to responseFormat', () => {
    const onDeprecatedAlias = vi.fn();
    const schema = buildInputSchema(shape, { onDeprecatedAlias });
    const parsed = schema.parse({ path: 'a.md', response_format: 'json' });
    expect(parsed).toEqual({ path: 'a.md', responseFormat: 'json' });
    expect(onDeprecatedAlias).toHaveBeenCalledWith('response_format', 'responseFormat');
  });

  it('lets responseFormat win when both names are given', () => {
    const schema = buildInputSchema(shape);
    const parsed = schema.parse({
      path: 'a.md',
      response_format: 'json',
      responseFormat: 'markdown',
    });
    expect(parsed).toEqual({ path: 'a.md', responseFormat: 'markdown' });
  });

  it('does not call the handler when only the new name is used', () => {
    const onDeprecatedAlias = vi.fn();
    const schema = buildInputSchema(shape, { onDeprecatedAlias });
    expect(schema.parse({ path: 'a.md', responseFormat: 'json' })).toEqual({
      path: 'a.md',
      responseFormat: 'json',
    });
    expect(onDeprecatedAlias).not.toHaveBeenCalled();
  });

  it('still rejects response_format on a tool without responseFormat', () => {
    const schema = buildInputSchema({ path: z.string() });
    const result = schema.safeParse({ path: 'a.md', response_format: 'json' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain(
      'Unknown parameter: response_format',
    );
  });

  it('keeps the alias out of the JSON Schema', () => {
    const json = z.toJSONSchema(buildInputSchema(shape), { io: 'input' });
    expect(json.type).toBe('object');
    expect(json.additionalProperties).toBe(false);
    expect(Object.keys(json.properties ?? {})).toEqual(['path', 'responseFormat']);
  });

  it('does not mutate the caller input and passes non-objects through', () => {
    const input = { path: 'a.md', response_format: 'json' };
    applyDeprecatedAliases(input, ['path', 'responseFormat']);
    expect(input).toEqual({ path: 'a.md', response_format: 'json' });
    expect(applyDeprecatedAliases(undefined, ['responseFormat'])).toBeUndefined();
    expect(applyDeprecatedAliases('x', ['responseFormat'])).toBe('x');
  });
});
