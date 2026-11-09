/**
 * Build a consistent tool description in the mcp-builder format:
 *
 *   <summary>
 *   Returns: <what the result means, beyond its shape>
 *   Examples:
 *   - Use when: ...
 *   - Don't use when: ...
 *   See also:
 *   - other_tool — when ...
 *   Errors:
 *   - "msg" when ...
 *
 * No blank lines between sections and no indentation: the headings already
 * separate them, and every character is paid in every session (#457).
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
    lines.push(`Returns: ${doc.returns.trim()}`);
  }

  const list = (heading: string, items: string[] | undefined): void => {
    if (items === undefined || items.length === 0) return;
    lines.push(heading);
    for (const item of items) lines.push(`- ${item}`);
  };
  list('Examples:', doc.examples);
  list('See also:', doc.seeAlso);
  list('Errors:', doc.errors);

  return lines.join('\n');
}
