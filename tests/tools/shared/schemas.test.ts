import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  MAX_TEXT_LENGTH,
  filePathSchema,
  noParamsSchema,
  textInput,
} from '../../../src/tools/shared/schemas';

describe('shared input schemas', () => {
  it('noParamsSchema accepts an empty object', () => {
    expect(z.strictObject(noParamsSchema).parse({})).toEqual({});
  });

  it('filePathSchema requires a non-empty path', () => {
    const schema = z.object(filePathSchema);
    expect(schema.parse({ path: 'notes/a.md' })).toEqual({ path: 'notes/a.md' });
    expect(() => schema.parse({ path: '' })).toThrow();
  });

  it('textInput caps text at MAX_TEXT_LENGTH characters', () => {
    expect(textInput.parse('x'.repeat(MAX_TEXT_LENGTH))).toHaveLength(MAX_TEXT_LENGTH);
    expect(() => textInput.parse('x'.repeat(MAX_TEXT_LENGTH + 1))).toThrow();
  });
});
