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
 */
export interface ToolDoc {
  summary: string;
  args?: string[];
  returns?: string;
  examples?: string[];
  errors?: string[];
}

export function describeTool(doc: ToolDoc): string {
  const lines: string[] = [doc.summary.trim()];

  if (doc.args && doc.args.length > 0) {
    lines.push('', 'Args:');
    for (const arg of doc.args) lines.push(`  - ${arg}`);
  }

  if (doc.returns) {
    lines.push('', 'Returns:');
    for (const line of doc.returns.trim().split('\n')) {
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
