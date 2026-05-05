/**
 * Substitute `{{name}}` placeholders in a template body. Built-in keys
 * `date`, `time`, and `title` are seeded from the supplied `now` Date and
 * a default title of "Untitled"; user-supplied variables take precedence
 * over the built-ins. Unknown placeholders are left untouched.
 *
 * Extracted from the original `template_expand` tool so `vault_daily_note`
 * can share the exact same expansion semantics without depending on the
 * templates module.
 */
export function expandPlaceholders(
  body: string,
  variables: Record<string, string>,
  now: Date = new Date(),
): string {
  const builtins: Record<string, string> = {
    date: now.toISOString().split('T')[0],
    time: now.toLocaleTimeString(),
    title: variables.title ?? 'Untitled',
    ...variables,
  };
  let result = body;
  for (const [key, value] of Object.entries(builtins)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
