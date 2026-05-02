import type { z } from 'zod';
import { paginationFields } from './pagination';
import { responseFormatField } from './response';

/**
 * Build a consistent tool description in the mcp-builder format:
 *
 *   <summary>
 *
 *   Args:
 *     - name (type): description.
 *
 *   Returns:
 *     <return shape>
 *
 *   Examples:
 *     - Use when: ...
 *     - Don't use when: ...
 *
 *   Errors:
 *     - "msg" when ...
 *
 * All sections are optional — pass only what's relevant. A model reading
 * these descriptions picks better tools and makes fewer invalid calls.
 *
 * Pass the tool's raw Zod shape as the second argument and `describeTool`
 * will auto-inject documentation rows for any of the shared field fragments
 * the schema spreads in (`paginationFields`, `responseFormatField`). Detection
 * is by reference equality on the shape's keys — `...spread` preserves the
 * original Zod schema references, so it never produces false positives for
 * unrelated `limit`/`offset`/`response_format` fields with bespoke shapes.
 */
export interface ToolDoc {
  summary: string;
  args?: string[];
  returns?: string;
  examples?: string[];
  errors?: string[];
}

const PAGINATION_DEFAULT_RETURNS =
  'Returns { items, total, count, offset, has_more, next_offset } when paginating.';

function spreadsPagination(schema: z.ZodRawShape): boolean {
  return (
    schema.limit === paginationFields.limit &&
    schema.offset === paginationFields.offset
  );
}

function spreadsResponseFormat(schema: z.ZodRawShape): boolean {
  return schema.response_format === responseFormatField.response_format;
}

export function describeTool(doc: ToolDoc, schema?: z.ZodRawShape): string {
  const callerArgs = doc.args ?? [];
  const injected: string[] = [];

  const hasPagination = schema ? spreadsPagination(schema) : false;
  const hasResponseFormat = schema ? spreadsResponseFormat(schema) : false;

  if (hasPagination) {
    injected.push(
      'limit (integer, optional): Maximum items to return (1..100, default 20).',
      'offset (integer, optional): Number of items to skip before returning results (default 0).',
    );
  }
  if (hasResponseFormat) {
    injected.push(
      'response_format (enum, optional): "markdown" (default) or "json".',
    );
  }

  const mergedArgs = [...callerArgs, ...injected];

  const lines: string[] = [doc.summary.trim()];

  if (mergedArgs.length > 0) {
    lines.push('', 'Args:');
    for (const arg of mergedArgs) lines.push(`  - ${arg}`);
  }

  // Resolve `returns`: caller-supplied wins; else inject the default
  // pagination return shape when applicable.
  const effectiveReturns =
    doc.returns ?? (hasPagination ? PAGINATION_DEFAULT_RETURNS : undefined);

  if (effectiveReturns !== undefined) {
    lines.push('', 'Returns:');
    for (const line of effectiveReturns.trim().split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  if (doc.examples && doc.examples.length > 0) {
    lines.push('', 'Examples:');
    for (const ex of doc.examples) lines.push(`  - ${ex}`);
  }

  if (doc.errors && doc.errors.length > 0) {
    lines.push('', 'Errors:');
    for (const e of doc.errors) lines.push(`  - ${e}`);
  }

  return lines.join('\n');
}
