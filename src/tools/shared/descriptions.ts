import { z } from 'zod';

/**
 * Agent-facing texts that several tools share (#449). One wording per
 * concept, so the same rule never reads differently from tool to tool.
 *
 * The path texts carry only what a correct call needs on every parameter
 * (vault-relative, the extension, an example). The full path rule (forward
 * slashes, case-sensitive, leading / ignored, must stay in the vault and out
 * of the config folder, see `validateToolPath` in src/utils/path-guard.ts)
 * is `PATH_RULE_HINT`,
 * sent once in the server instructions of every session (#457).
 */
export const PATH_RULE_HINT =
  '- Paths: vault-relative, forward slashes, case-sensitive; files with the extension (e.g. `notes/foo.md`); a leading / is ignored. ' +
  'Never absolute filesystem paths; leaving the vault fails with "Path must not traverse outside the vault". ' +
  'The config folder (usually `.obsidian`) is blocked.';

/** A path to one file. */
export const FILE_PATH_DESC = 'Vault-relative file path with extension, e.g. `notes/a.md`.';

/** A path to one folder. */
export const FOLDER_PATH_DESC = 'Vault-relative folder path, e.g. `projects/2026`.';

/** A path that may name a file or a folder (rename/move). */
export const ENTRY_PATH_DESC =
  'Vault-relative path of a file (with extension) or folder, e.g. `notes/a.md` or `notes`.';

/** A required vault path parameter (1..4096 characters). */
export function vaultPathField(desc: string): z.ZodString {
  return z.string().min(1).max(4096).describe(desc);
}

/** `modified` as returned by a read. */
export const MODIFIED_DESC =
  'Last-modification time (ISO-8601); pass it as expectedMtime to a write tool to detect concurrent edits.';

/** `modified` as returned by a write. */
export const NEW_MODIFIED_DESC = 'New last-modification time (ISO-8601); pass it as the next expectedMtime.';

/**
 * The `expectedMtime` parameter of the write tools. It also names the
 * conflict error, so the tools do not repeat it in their Errors (#457).
 */
export const EXPECTED_MTIME_DESC =
  'Conflict check: the latest `modified` of this file (from vault_read, vault_get_metadata or a write result; ' +
  'ISO-8601 or epoch ms). On a mismatch nothing is written and "File changed since expectedMtime" gives the current mtime.';

/**
 * The `variables` parameter of the template tools: what the built-in
 * placeholders expand to (src/tools/shared/placeholders.ts).
 */
export const TEMPLATE_VARIABLES_DESC =
  'Values for {{name}} placeholders, overriding the built-ins {{date}} (local YYYY-MM-DD), {{time}} (local HH:mm) ' +
  'and {{title}} (target file name without .md). Unknown placeholders and Templater <% %> stay as written.';
