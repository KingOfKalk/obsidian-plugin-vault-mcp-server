/**
 * Substitute `{{name}}` placeholders in a template body. Built-in keys
 * `date`, `time`, and `title` are seeded from the supplied `now` Date and
 * a default title of "Untitled"; user-supplied variables take precedence
 * over the built-ins. Unknown placeholders are left untouched.
 *
 * Placeholder matching is **literal** — variable keys may contain any
 * characters (including regex metacharacters); `{{foo(}}` matches only
 * the exact six-character sequence. This avoids both the runtime
 * SyntaxError that a `new RegExp(key)` would throw on unbalanced groups
 * and any accidental over-matching.
 *
 * `{{date}}` is formatted as the **UTC** calendar date of `now`
 * (`toISOString().split('T')[0]`); `{{time}}` uses **local** time
 * (`toLocaleTimeString()`). When the two need to agree, callers should
 * pass an explicit `date` variable rather than relying on the built-in.
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
    title: 'Untitled',
    ...variables,
  };
  let result = body;
  for (const [key, value] of Object.entries(builtins)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}
