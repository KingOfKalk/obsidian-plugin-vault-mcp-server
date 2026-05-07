/**
 * Pure renderers that turn a JSON Schema fragment (as emitted by
 * `z.toJSONSchema()`) into the markdown the tool docs use. Top-level fields
 * only — nested objects/arrays render as `object` / `object[]` and rely on
 * the parent field's description for detail.
 */

import {
  type JsonSchema,
  outputSchemaToJsonSchema,
  isDiscriminatedUnion,
} from './json-schema';

export function renderTypeCell(field: JsonSchema): string {
  const type = field.type;
  if (typeof field.const === 'string') {
    return `literal: \`${field.const}\``;
  }
  if (Array.isArray(field.enum)) {
    const opts = field.enum.map((v) => `\`${String(v)}\``).join(' \\| ');
    return `enum: ${opts}`;
  }
  if (type === 'string') {
    return withRange('string', field.minLength, field.maxLength);
  }
  if (type === 'number' || type === 'integer') {
    return withRange('number', field.minimum, field.maximum);
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'array') {
    const items = (field.items ?? {}) as JsonSchema;
    if (items.type === 'object') return 'object[]';
    if (typeof items.type === 'string') return `${items.type}[]`;
    return 'unknown[]';
  }
  if (type === 'object') {
    return 'object';
  }
  return 'unknown';
}

function withRange(
  base: 'string' | 'number',
  min: unknown,
  max: unknown,
): string {
  const minN = typeof min === 'number' ? min : undefined;
  const maxN = typeof max === 'number' ? max : undefined;
  if (base === 'string') {
    if (minN !== undefined && maxN !== undefined) return `string (${minN}–${maxN})`;
    if (minN !== undefined) return `string (≥${minN})`;
    if (maxN !== undefined) return `string (≤${maxN})`;
    return 'string';
  }
  if (minN !== undefined && maxN !== undefined) return `number (${minN}–${maxN})`;
  if (minN !== undefined) return `number (≥${minN})`;
  if (maxN !== undefined) return `number (≤${maxN})`;
  return 'number';
}

// Re-export helpers needed by Task 4 / Task 5 so the call-site only imports
// from this module. Real implementations are added in later tasks.
export { outputSchemaToJsonSchema, isDiscriminatedUnion };
export type { JsonSchema };
