/**
 * Build a consistent tool description in the mcp-builder format:
 *
 *   <summary>
 *
 *   Returns:
 *     <what the result means, beyond its shape>
 *
 *   Examples:
 *     - Use when: ...
 *     - Don't use when: ...
 *
 *   See also:
 *     - other_tool — when ...
 *
 *   Errors:
 *     - "msg" when ...
 *
 * All sections except the summary are optional — pass only what's
 * relevant.
 *
 * There is deliberately no `Args:` section. Every parameter carries its
 * own `.describe()` text in the tool's `inputSchema`, which clients already
 * receive in `tools/list`; repeating it in the description doubled the
 * token cost of every tool definition (#388). Put parameter documentation
 * in the field's `.describe()`. Likewise, keep `returns` to what the
 * `outputSchema` cannot say (truncation, paging, side effects) instead of
 * restating the payload shape.
 */
export interface ToolDoc {
  summary: string;
  returns?: string;
  examples?: string[];
  seeAlso?: string[];
  errors?: string[];
}

export function describeTool(doc: ToolDoc): string {
  const lines: string[] = [doc.summary.trim()];

  if (doc.returns !== undefined) {
    lines.push('', 'Returns:');
    for (const line of doc.returns.trim().split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  if (doc.examples && doc.examples.length > 0) {
    lines.push('', 'Examples:');
    for (const ex of doc.examples) lines.push(`  - ${ex}`);
  }

  if (doc.seeAlso && doc.seeAlso.length > 0) {
    lines.push('', 'See also:');
    for (const s of doc.seeAlso) lines.push(`  - ${s}`);
  }

  if (doc.errors && doc.errors.length > 0) {
    lines.push('', 'Errors:');
    for (const e of doc.errors) lines.push(`  - ${e}`);
  }

  return lines.join('\n');
}
