import { z } from 'zod';

/**
 * Agent-facing texts that several tools share (#449). One wording per
 * concept, so the same rule never reads differently from tool to tool.
 * The path rules match `validateVaultPath` (src/utils/path-guard.ts).
 */
const PATH_RULES = 'Forward slashes, case-sensitive; leading / ignored; must stay in the vault.';

/** A path to one file. */
export const FILE_PATH_DESC = `Vault-relative file path with extension, e.g. \`notes/a.md\`. ${PATH_RULES}`;

/** A path to one folder. */
export const FOLDER_PATH_DESC = `Vault-relative folder path, e.g. \`projects/2026\`. ${PATH_RULES}`;

/** A path that may name a file or a folder (rename/move). */
export const ENTRY_PATH_DESC = `Vault-relative path of a file (with extension) or folder, e.g. \`notes/a.md\` or \`notes\`. ${PATH_RULES}`;

/** A required vault path parameter (1..4096 characters). */
export function vaultPathField(desc: string): z.ZodString {
  return z.string().min(1).max(4096).describe(desc);
}

/** `modified` as returned by a read. */
export const MODIFIED_DESC =
  'Last-modification time (ISO-8601); pass it as expectedMtime to a write tool to detect concurrent edits.';

/** `modified` as returned by a write. */
export const NEW_MODIFIED_DESC = 'New last-modification time (ISO-8601); pass it as the next expectedMtime.';

/** The `expectedMtime` parameter of the write tools. */
export const EXPECTED_MTIME_DESC =
  'Optional conflict check: the latest `modified` you have for this file, from vault_read, vault_get_metadata or a write ' +
  "result (ISO-8601 or epoch ms). If the file's mtime differs, nothing is written and the error gives the current one.";

/**
 * The `variables` parameter of the template tools: what the built-in
 * placeholders expand to (src/tools/shared/placeholders.ts).
 */
export const TEMPLATE_VARIABLES_DESC =
  'Values for {{name}} placeholders; they override the built-ins {{date}} (UTC date, YYYY-MM-DD), {{time}} ' +
  '(host-locale time) and {{title}} ("Untitled"). Unknown placeholders and Templater <% %> stay as written.';
