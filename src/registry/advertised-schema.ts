import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

/**
 * Smaller JSON Schemas for `tools/list` (#451).
 *
 * The MCP SDK validates tool input and output with the schema's own
 * `~standard.validate` (Zod), not with the JSON Schema it advertises. So
 * the advertised JSON can lose keys that only cost tokens, while validation
 * stays exactly the same:
 *
 * - everywhere: `$schema`, the `maximum`/`minimum` of ±MAX_SAFE_INTEGER that
 *   Zod adds to every `.int()`, and `propertyNames: { type: "string" }`
 *   (JSON object keys are always strings);
 * - in output schemas only: every `description` and
 *   `additionalProperties: false`.
 *
 * Kept on purpose: input descriptions, input `additionalProperties: false`
 * (it tells the model the parameter list is closed), every `required` list
 * and every `type`. The output root stays `type: "object"`: the SDK reads
 * the advertised output JSON when it builds the result, and wraps
 * `structuredContent` as `{ result: … }` for a non-object root.
 */
type AdvertisedRole = 'input' | 'output';

type JsonObject = Record<string, unknown>;

/** Keywords whose value is a map from names to subschemas. */
const SCHEMA_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);

/** Keywords whose value is one subschema. */
const SCHEMA_KEYS = new Set([
  'items',
  'additionalProperties',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'unevaluatedProperties',
  'unevaluatedItems',
  'additionalItems',
  'contentSchema',
]);

/** Keywords whose value is a list of subschemas. */
const SCHEMA_LIST_KEYS = new Set(['anyOf', 'allOf', 'oneOf', 'prefixItems', 'items']);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDroppedKeyword(key: string, value: unknown, role: AdvertisedRole): boolean {
  switch (key) {
    case '$schema':
      return true;
    case 'maximum':
      return value === Number.MAX_SAFE_INTEGER;
    case 'minimum':
      return value === Number.MIN_SAFE_INTEGER;
    case 'propertyNames':
      return isObject(value) && Object.keys(value).length === 1 && value.type === 'string';
    case 'description':
      return role === 'output' && typeof value === 'string';
    case 'additionalProperties':
      return role === 'output' && value === false;
    default:
      return false;
  }
}

function trimValue(key: string, value: unknown, role: AdvertisedRole): unknown {
  if (SCHEMA_MAP_KEYS.has(key) && isObject(value)) {
    const out: JsonObject = {};
    for (const [name, sub] of Object.entries(value)) {
      out[name] = isObject(sub) ? trimJsonSchema(sub, role) : sub;
    }
    return out;
  }
  if (SCHEMA_KEYS.has(key) && isObject(value)) return trimJsonSchema(value, role);
  if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
    return value.map((sub: unknown) => (isObject(sub) ? trimJsonSchema(sub, role) : sub));
  }
  // Data, not schema: enum, const, default, examples, required, …
  return value;
}

/**
 * Return a trimmed copy of a JSON Schema. Walks subschemas only, so a
 * property that happens to be called `description` or `type` is kept.
 */
export function trimJsonSchema(schema: JsonObject, role: AdvertisedRole): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (isDroppedKeyword(key, value, role)) continue;
    out[key] = trimValue(key, value, role);
  }
  return out;
}

/**
 * Wrap a Standard Schema so the JSON Schema it advertises is trimmed for
 * `role`. `validate` and the other Standard Schema props are passed through
 * unchanged.
 */
export function withAdvertisedSchema<Input, Output>(
  schema: StandardSchemaWithJSON<Input, Output>,
  role: AdvertisedRole,
): StandardSchemaWithJSON<Input, Output> {
  const std = schema['~standard'];
  return {
    '~standard': {
      ...std,
      validate: std.validate,
      jsonSchema: {
        input: (options) => trimJsonSchema(std.jsonSchema.input(options), role),
        output: (options) => trimJsonSchema(std.jsonSchema.output(options), role),
      },
    },
  };
}
