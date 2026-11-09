import { z } from 'zod';

/**
 * Format the error shown when a caller sends parameters a tool does not
 * declare. Names the offending keys and lists every valid parameter so a
 * typo such as `new_name` vs `newName` is obvious from the message alone.
 */
export function formatUnknownKeysMessage(
  unknownKeys: readonly string[],
  validKeys: readonly string[],
): string {
  const label = unknownKeys.length === 1 ? 'Unknown parameter' : 'Unknown parameters';
  const valid = validKeys.length > 0 ? validKeys.join(', ') : '(none)';
  return `${label}: ${unknownKeys.join(', ')}. Valid parameters: ${valid}.`;
}

/**
 * Build the strict object schema a tool's input is validated against.
 *
 * The same schema is handed to the MCP SDK (so it is the one advertised in
 * `tools/list`, with `additionalProperties: false`) and to the dispatcher.
 * Passing only the raw shape to the SDK made it build a non-strict
 * `z.object()`, which silently stripped unknown keys before the dispatcher's
 * own `.strict()` check could see them (#388).
 *
 * There are no parameter aliases: the deprecated `response_format` alias
 * (#392) was removed in 4.0.0 (#432), so it is rejected like any other
 * unknown parameter.
 */
export function buildInputSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodObject<Shape, z.core.$strict> {
  const validKeys = Object.keys(shape);
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? formatUnknownKeysMessage(issue.keys, validKeys)
        : undefined,
  });
}
