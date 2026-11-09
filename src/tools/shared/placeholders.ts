function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar date of `now` as `YYYY-MM-DD` (the `{{date}}` built-in). */
export function formatLocalDate(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Local time of `now` as `HH:mm`, 24-hour (the `{{time}}` built-in). */
export function formatLocalTime(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/** The file name of a vault path without its `.md` extension. */
export function noteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.replace(/\.md$/i, '');
}

export interface PlaceholderContext {
  /** Moment for `{{date}}` / `{{time}}`; defaults to the current time. */
  now?: Date;
  /**
   * Value of `{{title}}`: the target file's name without `.md`. Without
   * a target file (`template_expand`) `{{title}}` stays as written.
   */
  title?: string;
}

/**
 * Substitute `{{name}}` placeholders in a template body. The one
 * implementation shared by `template_expand`, `template_create_from` and
 * `vault_daily_note` (#470).
 *
 * Built-ins: `{{date}}` is the local date (`YYYY-MM-DD`), `{{time}}` the
 * local time (`HH:mm`), both of `context.now`; `{{title}}` is
 * `context.title` when given. User-supplied variables take precedence over
 * the built-ins. Unknown placeholders are left untouched.
 *
 * Placeholder matching is **literal** — variable keys may contain any
 * characters (including regex metacharacters); `{{foo(}}` matches only
 * the exact six-character sequence. This avoids both the runtime
 * SyntaxError that a `new RegExp(key)` would throw on unbalanced groups
 * and any accidental over-matching.
 */
export function expandPlaceholders(
  body: string,
  variables: Record<string, string>,
  context: PlaceholderContext = {},
): string {
  const now = context.now ?? new Date();
  const builtins: Record<string, string> = {
    date: formatLocalDate(now),
    time: formatLocalTime(now),
    ...(context.title === undefined ? {} : { title: context.title }),
    ...variables,
  };
  let result = body;
  for (const [key, value] of Object.entries(builtins)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}
