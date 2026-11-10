import type { ObsidianAdapter } from '../../obsidian/adapter';

/** Used when the core Templates plugin has no folder set. */
export const DEFAULT_TEMPLATES_FOLDER = 'templates';

/**
 * The template folder: the one set in Obsidian's core Templates plugin,
 * without leading or trailing slashes, or `templates` when none is set
 * (#470). Read on every call, since the user can change it at any time.
 * Shared by `template_list` and the `expand-template` prompt's completer.
 */
export function templatesFolder(adapter: ObsidianAdapter): string {
  const folder = (adapter.getTemplatesFolder() ?? '').trim().replace(/^\/+|\/+$/g, '');
  return folder === '' ? DEFAULT_TEMPLATES_FOLDER : folder;
}
