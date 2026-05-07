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
  // io:'input' makes fields with .default() optional in `required`, which is
  // correct: callers don't need to supply fields that have a default value.
  return z.toJSONSchema(z.object(shape), { io: 'input' });
}

export function outputSchemaToJsonSchema(
  schema: z.ZodRawShape | z.ZodTypeAny,
): JsonSchema {
  const zodSchema =
    schema instanceof z.ZodType ? schema : z.object(schema);
  return z.toJSONSchema(zodSchema);
}

export function isDiscriminatedUnion(
  schema: z.ZodTypeAny,
): schema is z.ZodDiscriminatedUnion {
  return schema instanceof z.ZodDiscriminatedUnion;
}
