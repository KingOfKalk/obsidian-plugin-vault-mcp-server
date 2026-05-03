const TEMPLATE_BUILTIN_PLACEHOLDERS = new Set(['date', 'time', 'title']);

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/**
 * Scan a template body for `{{name}}` placeholders. Dedupes (preserving
 * first-seen order) and filters out the built-ins (`date`, `time`,
 * `title`) that the existing `template_expand` tool auto-resolves so the
 * `/expand-template` prompt only asks the user for placeholders that
 * actually need a value.
 */
export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (TEMPLATE_BUILTIN_PLACEHOLDERS.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
