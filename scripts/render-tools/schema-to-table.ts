/**
 * Pure renderers that turn a JSON Schema fragment (as emitted by
 * `z.toJSONSchema()`) into the markdown the tool docs use. Top-level fields
 * only — nested objects/arrays render as `object` / `object[]` and rely on
 * the parent field's description for detail.
 */

import { z } from 'zod';
import {
  type JsonSchema,
  inputShapeToJsonSchema,
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

export function inputShapeToTable(shape: z.ZodRawShape): string {
  const json = inputShapeToJsonSchema(shape);
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set(
    Array.isArray(json.required) ? (json.required as string[]) : [],
  );
  const names = Object.keys(properties);
  if (names.length === 0) return '_No input parameters._';

  const lines: string[] = [];
  lines.push('| Field | Type | Required | Description |');
  lines.push('|---|---|---|---|');
  for (const name of names) {
    const field = properties[name];
    const type = renderTypeCell(field);
    const requiredCell = renderRequiredCell(field, required.has(name));
    const description = renderDescription(field.description);
    lines.push(`| \`${name}\` | ${type} | ${requiredCell} | ${description} |`);
  }
  return lines.join('\n');
}

function renderRequiredCell(field: JsonSchema, isRequired: boolean): string {
  if (field.default !== undefined) {
    return `no (default \`${formatDefault(field.default)}\`)`;
  }
  return isRequired ? 'yes' : 'no';
}

function formatDefault(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function renderDescription(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Escape backslashes before pipes so a literal `\` in the source description
  // can't combine with the next character to break the table cell. Single
  // pass via back-reference: any `\` or `|` becomes `\\` or `\|`.
  return raw.replace(/\s+/g, ' ').trim().replace(/[\\|]/g, '\\$&');
}

const NO_OUTPUT_MARKER =
  '_No `structuredContent` declared — returns plain text or binary._';
const UNRENDERABLE_MARKER =
  '_Output schema present but not renderable as a table._';

export function outputSchemaToTables(
  schema: z.ZodRawShape | z.ZodTypeAny | undefined,
): string {
  if (schema === undefined) return NO_OUTPUT_MARKER;

  if (schema instanceof z.ZodType && isDiscriminatedUnion(schema)) {
    return renderDiscriminatedUnionTables(schema);
  }

  const json = outputSchemaToJsonSchema(schema);
  if (json.type === 'object' && json.properties) {
    return renderFlatOutputTable(json);
  }
  return UNRENDERABLE_MARKER;
}

function renderDiscriminatedUnionTables(
  union: z.ZodDiscriminatedUnion,
): string {
  const discriminator: string = union.def.discriminator;
  const sections: string[] = [];
  for (const option of union.def.options) {
    const json = outputSchemaToJsonSchema(option as z.ZodTypeAny);
    const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
    const discField: JsonSchema | undefined = properties[discriminator];
    const constVal: unknown = discField ? discField['const'] : undefined;
    const literal = typeof constVal === 'string' ? constVal : '?';
    sections.push(`**When \`${discriminator}\` is \`${literal}\`**`);
    sections.push('');
    sections.push(renderFlatOutputTable(json));
    sections.push('');
  }
  return sections.join('\n').trimEnd();
}

function renderFlatOutputTable(json: JsonSchema): string {
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const lines: string[] = [];
  lines.push('| Field | Type | Description |');
  lines.push('|---|---|---|');
  for (const name of Object.keys(properties)) {
    const field = properties[name];
    const type = renderTypeCell(field);
    const description = renderDescription(field.description);
    lines.push(`| \`${name}\` | ${type} | ${description} |`);
  }
  return lines.join('\n');
}

// Re-export helpers needed by Task 4 / Task 5 so the call-site only imports
// from this module. Real implementations are added in later tasks.
export { outputSchemaToJsonSchema, isDiscriminatedUnion };
export type { JsonSchema };
