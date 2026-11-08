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
 * Deprecated parameter names that are still accepted at call time and
 * renamed to their current name before strict validation (#392).
 *
 * The old names are not part of any tool's schema, so they never appear in
 * `tools/list`. An alias is applied only when the tool declares the current
 * name. Remove these aliases in the next major release.
 */
export const DEPRECATED_PARAM_ALIASES: Readonly<Record<string, string>> = {
  response_format: 'responseFormat',
};

/** Called each time a call uses a deprecated alias. */
export type DeprecatedAliasHandler = (alias: string, replacement: string) => void;

export interface BuildInputSchemaOptions {
  onDeprecatedAlias?: DeprecatedAliasHandler;
}

/**
 * Rename deprecated aliases in a raw argument object to their current name.
 * When both the alias and the current name are given, the current name wins
 * and the alias is dropped. Non-object input passes through untouched so the
 * strict schema can report it.
 */
export function applyDeprecatedAliases(
  input: unknown,
  validKeys: readonly string[],
  onDeprecatedAlias?: DeprecatedAliasHandler,
): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  let result: Record<string, unknown> | undefined;
  for (const [alias, replacement] of Object.entries(DEPRECATED_PARAM_ALIASES)) {
    if (!validKeys.includes(replacement) || !Object.hasOwn(input, alias)) continue;
    result ??= { ...(input as Record<string, unknown>) };
    const value = result[alias];
    delete result[alias];
    if (!Object.hasOwn(result, replacement)) {
      result[replacement] = value;
    }
    onDeprecatedAlias?.(alias, replacement);
  }
  return result ?? input;
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
 * The strict object is wrapped in a preprocess step that renames deprecated
 * aliases (see `DEPRECATED_PARAM_ALIASES`). Zod renders a preprocess pipe's
 * JSON Schema from its output side, so `tools/list` still shows only the
 * strict object with the current names.
 */
export function buildInputSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
  options: BuildInputSchemaOptions = {},
): z.ZodPreprocess<z.ZodObject<Shape, z.core.$strict>> {
  const validKeys = Object.keys(shape);
  const strict = z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? formatUnknownKeysMessage(issue.keys, validKeys)
        : undefined,
  });
  return z.preprocess(
    (input) => applyDeprecatedAliases(input, validKeys, options.onDeprecatedAlias),
    strict,
  );
}
