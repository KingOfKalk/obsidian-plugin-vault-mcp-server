import { z } from 'zod';
import { ToolModule, ToolDefinition, annotations, defineTool } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createHandlers, WriteMutex } from './handlers';
import { createSearchHandlers } from '../search/handlers';
import { describeTool } from '../shared/describe';
import {
  createFileSchema,
  readFileSchema,
  updateFileSchema,
  deleteFileSchema,
  appendFileSchema,
  replaceInFileSchema,
  insertSchema,
  getMetadataSchema,
  renameFileSchema,
  moveFileSchema,
  copyFileSchema,
  createFolderSchema,
  deleteFolderSchema,
  renameFolderSchema,
  listFolderSchema,
  listRecursiveSchema,
  readBinarySchema,
  writeBinarySchema,
  getAspectSchema,
  dailyNoteSchema,
  setFrontmatterSchema,
} from './schemas';

/**
 * Output schemas for the read tools that emit `structuredContent`. Each
 * shape mirrors what the corresponding handler in `./handlers.ts` puts on
 * `result.structuredContent` — declaring them here lets modern MCP clients
 * validate / introspect the typed payload.
 */
const readFileOutputSchema = {
  path: z.string().describe('Vault-relative path that was read.'),
  heading: z
    .string()
    .optional()
    .describe('With the heading parameter: the matched heading as written, e.g. "## Log".'),
  line: z
    .number()
    .optional()
    .describe('With the heading parameter: 1-based line number of the heading in the file.'),
  content: z
    .string()
    .describe(
      'File content in the requested window (the whole file when it fits). With heading: the section, heading line included.',
    ),
  totalLength: z
    .number()
    .describe('Length of the whole file (or of the section, with heading) in characters.'),
  offset: z.number().describe('Character offset where this window starts.'),
  hasMore: z.boolean().describe('True when the file continues past this window.'),
  nextOffset: z
    .number()
    .optional()
    .describe('Offset to pass in the next call when hasMore is true.'),
  modified: z
    .string()
    .describe(
      'Last-modification timestamp (ISO-8601). Pass it as expectedMtime to a write tool to detect concurrent edits.',
    ),
};

const getMetadataOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  size: z.number().describe('File size in bytes.'),
  created: z
    .string()
    .describe('Creation timestamp as an ISO-8601 string.'),
  modified: z
    .string()
    .describe('Last-modification timestamp as an ISO-8601 string.'),
};

const listFolderOutputSchema = {
  files: z
    .array(z.string())
    .describe('Direct file children of the listed folder (names only).'),
  folders: z
    .array(z.string())
    .describe('Direct subfolders of the listed folder (names only).'),
};

const listRecursiveOutputSchema = {
  folders: z
    .array(z.string())
    .describe('All folders found under the listed path (recursive).'),
  total: z
    .number()
    .describe('Total number of files matched before pagination.'),
  count: z.number().describe('Number of files in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  items: z
    .array(z.string())
    .describe('Files in this page (vault-relative paths).'),
  hasMore: z
    .boolean()
    .describe('True when there are more files past this page.'),
  nextOffset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when hasMore is true.'),
};

/**
 * Output schema for `vault_get_aspect` (#294). One flat object: `aspect`
 * says which aspect was returned and exactly one of the optional per-aspect
 * fields is populated. It used to be a `z.discriminatedUnion`, which SDK v1
 * cannot handle — the schema vanished from `tools/list` and every call
 * failed with "Cannot read properties of undefined (reading '_zod')" (#388).
 */
const linkItem = z.object({
  link: z.string().describe('Link target.'),
  displayText: z
    .string()
    .optional()
    .describe('Optional alias used in [[link|alias]] notation.'),
});

const getAspectOutputSchema = {
  aspect: z
    .enum([
      'frontmatter',
      'headings',
      'outgoing_links',
      'embeds',
      'backlinks',
      'block_references',
    ])
    .describe('The aspect that was returned; selects which field below is set.'),
  path: z.string().describe('Vault-relative path that was inspected.'),
  frontmatter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('aspect=frontmatter: parsed YAML frontmatter, or {} when absent.'),
  headings: z
    .array(
      z.object({
        heading: z.string().describe('Heading text.'),
        level: z.number().describe('Heading level (1..6).'),
      }),
    )
    .optional()
    .describe('aspect=headings: headings in document order.'),
  links: z
    .array(linkItem)
    .optional()
    .describe('aspect=outgoing_links: [[...]] links from this file.'),
  embeds: z
    .array(linkItem)
    .optional()
    .describe('aspect=embeds: ![[...]] embeds in this file.'),
  backlinks: z
    .array(z.string())
    .optional()
    .describe('aspect=backlinks: paths of files that link TO this file.'),
  backlinkContext: z
    .array(
      z.object({
        path: z.string().describe('Vault-relative path of the linking file.'),
        matches: z
          .array(
            z.object({
              line: z.number().describe('1-based line number of the line containing the link.'),
              text: z.string().describe('Full text of that line.'),
            }),
          )
          .describe('Lines in the linking file that link here; empty when the link has no line position (e.g. frontmatter).'),
      }),
    )
    .optional()
    .describe('aspect=backlinks with includeContext=true: where each backlink sits, one entry per path in backlinks.'),
  blockRefs: z
    .array(
      z.object({
        id: z.string().describe('Block-reference id (without the leading ^).'),
        line: z.string().describe('The line of text the block-reference is on.'),
      }),
    )
    .optional()
    .describe('aspect=block_references: ^block-ids defined in this file.'),
};

/**
 * Output schema for `vault_read_binary` (Batch D of #248). The handler now
 * emits `structuredContent: { path, data, encoding: 'base64', sizeBytes }`
 * alongside the plain-text base64 string so modern clients can introspect
 * the typed payload while existing `result.content[0].text` callers see no
 * change.
 */
const readBinaryOutputSchema = {
  path: z.string().describe('Vault-relative path that was read.'),
  data: z.string().describe('Base64-encoded file contents (no data: prefix).'),
  encoding: z
    .literal('base64')
    .describe('Encoding of the `data` field — always `"base64"` for this tool.'),
  sizeBytes: z
    .number()
    .describe('Decoded file size in bytes (length of the underlying binary).'),
};

const dailyNoteOutputSchema = {
  path: z.string().describe('Vault-relative path of the daily note.'),
  created: z
    .boolean()
    .describe(
      'True when the note was just created; false when it already existed or create=false left it missing.',
    ),
  exists: z
    .boolean()
    .describe('True when the note exists after the call; false only when create=false and the note is missing.'),
  content: z
    .string()
    .optional()
    .describe(
      'Full note content (template-expanded body when newly created). Absent when exists=false.',
    ),
};

/**
 * Output schemas for the write tools (#388). They used to return only a
 * plain-text confirmation; the text is unchanged, and these small payloads
 * let agents chain calls without parsing it.
 */
const writePath = z.string().describe('Vault-relative path that was written.');
const alwaysTrue = z.boolean().describe('Always true on success.');

const createdOutputSchema = { path: writePath, created: alwaysTrue };
const updatedOutputSchema = { path: writePath, updated: alwaysTrue };
const appendedOutputSchema = { path: writePath, appended: alwaysTrue };
/**
 * Where a delete went, read from the user's "Deleted files" setting
 * (#430).
 */
const trashedTo = z
  .enum(['system', 'vault', 'permanent', 'unknown'])
  .describe(
    'Where the item went, per the user\'s "Deleted files" setting: "system" (system trash), "vault" (the vault\'s .trash folder), "permanent" (deleted for good), or "unknown" if the setting could not be read.',
  );

const deletedOutputSchema = { path: writePath, deleted: alwaysTrue, trashedTo };

const deleteFolderOutputSchema = {
  path: writePath,
  deleted: alwaysTrue,
  recursive: z.boolean().describe('Whether the delete was recursive.'),
  trashedTo,
};

const fromToOutputSchema = {
  from: z.string().describe('Vault-relative source path.'),
  to: z.string().describe('Vault-relative destination path.'),
};

/** Rename/move results with the link-update report (#430). */
const renameOutputSchema = {
  ...fromToOutputSchema,
  linksUpdated: z
    .number()
    .describe('Number of links to the moved file(s) in the files listed in updatedFiles.'),
  updatedFiles: z
    .array(z.string())
    .describe('Vault-relative paths (after the rename) whose content changed because links were updated.'),
  autoUpdateLinks: z
    .boolean()
    .nullable()
    .describe('The user\'s "Automatically update internal links" setting; null if it could not be read.'),
  warning: z
    .string()
    .optional()
    .describe('Present when other files link to the moved file(s) but their links were not updated.'),
};

const replaceOutputSchema = {
  path: writePath,
  replacements: z.number().describe('Number of occurrences replaced (over all edits).'),
  edits: z
    .array(
      z.object({
        index: z.number().describe('Position of the edit in the edits array (0-based).'),
        replacements: z.number().describe('Number of occurrences this edit replaced.'),
      }),
    )
    .optional()
    .describe('Multi-edit form only: occurrences replaced per edit, in input order.'),
  modified: z
    .string()
    .describe('New last-modification timestamp (ISO-8601); usable as the next expectedMtime.'),
};

const insertOutputSchema = {
  path: writePath,
  heading: z.string().describe('The matched heading as written, e.g. "## Log".'),
  position: z.enum(['start', 'end']).describe('Where the text went in the section.'),
  line: z.number().describe('1-based line number where the inserted text starts.'),
  modified: z
    .string()
    .describe('New last-modification timestamp (ISO-8601); usable as the next expectedMtime.'),
};

/** Error lines shared by the tools that address a section by heading (#428). */
const HEADING_NOT_FOUND_ERROR =
  '"Heading not found" (with the available headings and their line numbers) if no heading matches.';
const HEADING_AMBIGUOUS_ERROR =
  '"Heading … is ambiguous" (with the matches and their line numbers) if more than one heading matches.';

/** Error line shared by the write tools that take `expectedMtime` (#406). */
const MTIME_CONFLICT_ERROR =
  '"File changed since expectedMtime" (with the current mtime) if expectedMtime is set and the file was modified since; nothing is written.';

const writeBinaryOutputSchema = {
  path: writePath,
  sizeBytes: z.number().describe('Number of bytes written.'),
};

const setFrontmatterOutputSchema = {
  path: writePath,
  frontmatter: z
    .record(z.string(), z.unknown())
    .describe('The whole frontmatter after the change ({} when no keys are left).'),
  modified: z
    .string()
    .describe('New last-modification timestamp (ISO-8601); usable as the next expectedMtime.'),
};

export function createVaultModule(adapter: ObsidianAdapter): ToolModule {
  const mutex = new WriteMutex();
  const searchHandlers = createSearchHandlers(adapter);
  const handlers = createHandlers(adapter, mutex, searchHandlers);

  return {
    metadata: {
      id: 'vault',
      name: 'Vault and File Operations',
      description: 'Create, read, update, delete, and manage files in the vault',
    },

    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'vault_create',
          title: 'Create file',
          description: describeTool({
            summary: 'Create a new file at a vault-relative path with text content. Missing parent folders are created.',
            examples: [
              'Use when: creating notes/ideas.md with "# Ideas"',
              'Don\'t use when: the file already exists — call vault_update instead.',
            ],
            errors: [
              '"File already exists" if the target path is taken.',
              '"Path must not traverse outside the vault" on traversal attempts.',
            ],
          }),
          schema: createFileSchema,
          outputSchema: createdOutputSchema,
          handler: handlers.createFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_read',
          title: 'Read file',
          description: describeTool({
            summary: 'Read the UTF-8 content of a file by vault-relative path.',
            returns:
              'Files over 24 000 characters come in windows: while hasMore is true, call again with offset=nextOffset. ' +
              'With heading, only that section is returned (paged the same way).',
            examples: [
              'Use when: "show me the README" -> { path: "README.md" }',
              'Use when: continuing a large file -> { path: "big.md", offset: 24000 }',
              'Use when: reading one section of a long note -> { path: "journal.md", heading: "## Log" }',
            ],
            errors: [
              '"File not found" if the path does not exist.',
              '"Path must not traverse outside the vault" on traversal attempts.',
              HEADING_NOT_FOUND_ERROR,
              HEADING_AMBIGUOUS_ERROR,
            ],
            seeAlso: [
              'editor_get_content — when reading the file currently open in the editor (no path needed).',
            ],
          }),
          schema: readFileSchema,
          outputSchema: readFileOutputSchema,
          handler: handlers.readFile,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_update',
          title: 'Replace file content',
          description: describeTool({
            summary: 'Overwrite an existing file with new content.',
            examples: [
              'Use when: replacing a draft with a final version.',
              'Don\'t use when: you only need to append (use vault_append) or change one passage (use vault_replace).',
              'Don\'t use when: you read only part of a large file — writing that window back truncates the note.',
            ],
            errors: ['"File not found" if the path does not exist.', MTIME_CONFLICT_ERROR],
          }),
          schema: updateFileSchema,
          outputSchema: updatedOutputSchema,
          handler: handlers.updateFile,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_delete',
          title: 'Delete file',
          description: describeTool({
            summary: 'Delete a file by vault-relative path.',
            returns: 'The file goes where the user\'s "Deleted files" setting says: system trash, the vault\'s .trash folder, or permanently. `trashedTo` reports which ("system", "vault", "permanent", or "unknown" if the setting cannot be read).',
            examples: ['Use when: removing an outdated note.'],
            errors: ['"File not found" if the path does not exist.'],
          }),
          schema: deleteFileSchema,
          outputSchema: deletedOutputSchema,
          handler: handlers.deleteFile,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_append',
          title: 'Append to file',
          description: describeTool({
            summary: 'Append content to the end of an existing file.',
            examples: ['Use when: adding a new bullet to a daily note.'],
            errors: ['"File not found" if the path does not exist.', MTIME_CONFLICT_ERROR],
          }),
          schema: appendFileSchema,
          outputSchema: appendedOutputSchema,
          handler: handlers.appendFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_replace',
          title: 'Replace text in file',
          description: describeTool({
            summary:
              'Replace an exact passage in a file without rewriting the rest. oldString must match exactly once unless replaceAll is true. ' +
              'Pass edits instead of oldString/newString to make several replacements all or nothing.',
            returns:
              'Matching and writing happen in one atomic step (app.vault.process). ' +
              'With edits, every edit is checked against the file as it was before the call, and the result adds edits: [{ index, replacements }].',
            examples: [
              'Use when: fixing one line in a large note -> { path: "notes/a.md", oldString: "status: draft", newString: "status: done" }',
              'Use when: renaming a term everywhere in one file -> { ..., replaceAll: true }',
              'Use when: changing two sections at once -> { path: "notes/a.md", edits: [{ oldString: "## Agenda\\n- old", newString: "## Agenda\\n- new" }, { oldString: "- [ ] task", newString: "- [x] task" }] }',
              'Don\'t use when: editing the open file at a cursor position (use editor_replace).',
            ],
            errors: [
              '"File not found" if the path does not exist.',
              '"oldString not found … (0 matches)" or "oldString is ambiguous … (N matches)"; nothing is written.',
              '"edits[i].oldString not found/is ambiguous … (N matches)" or "edits[i] and edits[j] overlap"; nothing is written.',
              '"Pass either oldString/newString or edits, not both" (or neither); nothing is written.',
              MTIME_CONFLICT_ERROR,
            ],
            seeAlso: [
              'vault_update — when replacing the whole file.',
            ],
          }),
          schema: replaceInFileSchema,
          outputSchema: replaceOutputSchema,
          handler: handlers.replaceInFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_insert',
          title: 'Insert into section',
          description: describeTool({
            summary:
              'Insert text at the start or end of a Markdown section, addressed by its heading, without rewriting the rest of the file.',
            returns:
              'A section runs from its heading to the next heading of the same or a higher level (or the end of the file). ' +
              'Finding the section and writing happen in one atomic step (app.vault.process).',
            examples: [
              'Use when: adding a log entry -> { path: "journal.md", heading: "## Log", text: "- 09:30 standup" }',
              'Use when: putting a note at the top of a section -> { path: "a.md", heading: "Notes", position: "start", text: "Important!" }',
              "Don't use when: the edit is not at a section boundary (use vault_replace).",
            ],
            errors: [
              '"File not found" if the path does not exist.',
              `${HEADING_NOT_FOUND_ERROR} Nothing is written.`,
              `${HEADING_AMBIGUOUS_ERROR} Nothing is written.`,
              MTIME_CONFLICT_ERROR,
            ],
            seeAlso: [
              'vault_read — with heading to read just that section first.',
              'vault_append — when adding to the end of the file.',
            ],
          }),
          schema: insertSchema,
          outputSchema: insertOutputSchema,
          handler: handlers.insert,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_get_metadata',
          title: 'Get file metadata',
          description: describeTool({
            summary: 'Get file stat metadata (size, creation date, modification date).',
            examples: ['Use when: checking if a note has changed recently.'],
            errors: ['"File not found" if the path does not exist.'],
            seeAlso: [
              'extras_get_date — when you need the current date in a specific format, not a file\'s timestamp.',
            ],
          }),
          schema: getMetadataSchema,
          outputSchema: getMetadataOutputSchema,
          handler: handlers.getMetadata,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_rename',
          title: 'Rename file',
          description: describeTool({
            summary: 'Rename a file within its current folder.',
            returns: 'Links to the file are updated if the user enabled "Automatically update internal links". `linksUpdated` and `updatedFiles` report the rewritten links, `autoUpdateLinks` the setting, and `warning` is set when other files link to it but were not updated.',
            examples: ['Use when: renaming "draft.md" to "final.md" in the same folder.'],
            errors: [
              '"Invalid rename target" if newName contains path separators.',
              '"File not found" if path does not exist.',
            ],
          }),
          schema: renameFileSchema,
          outputSchema: renameOutputSchema,
          handler: handlers.renameFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_move',
          title: 'Move file',
          description: describeTool({
            summary: 'Move a file to a different path (can change folder and name). Missing parent folders are created.',
            returns: 'Links to the file are updated if the user enabled "Automatically update internal links". `linksUpdated` and `updatedFiles` report the rewritten links, `autoUpdateLinks` the setting, and `warning` is set when other files link to it but were not updated.',
            examples: ['Use when: archiving a note by moving it to "archive/<name>.md".'],
            errors: ['"File not found" if path does not exist.'],
          }),
          schema: moveFileSchema,
          outputSchema: renameOutputSchema,
          handler: handlers.moveFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_copy',
          title: 'Copy file',
          description: describeTool({
            summary: 'Copy a file to a new path, leaving the original in place. Missing parent folders are created.',
            examples: ['Use when: duplicating a template before editing.'],
            errors: ['"File not found" if sourcePath does not exist.'],
          }),
          schema: copyFileSchema,
          outputSchema: fromToOutputSchema,
          handler: handlers.copyFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_create_folder',
          title: 'Create folder',
          description: describeTool({
            summary: 'Create a new folder at a vault-relative path.',
            examples: ['Use when: creating a "projects" folder before adding notes.'],
            errors: ['"Folder already exists" if the path is taken.'],
          }),
          schema: createFolderSchema,
          outputSchema: createdOutputSchema,
          handler: handlers.createFolder,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_delete_folder',
          title: 'Delete folder',
          description: describeTool({
            summary: 'Delete a folder, optionally recursively.',
            returns: 'The folder goes where the user\'s "Deleted files" setting says: system trash, the vault\'s .trash folder, or permanently. `trashedTo` reports which ("system", "vault", "permanent", or "unknown" if the setting cannot be read).',
            examples: ['Use when: removing an empty "old-drafts" folder.'],
            errors: ['"Folder not empty" if non-empty and recursive=false.'],
          }),
          schema: deleteFolderSchema,
          outputSchema: deleteFolderOutputSchema,
          handler: handlers.deleteFolder,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_rename_folder',
          title: 'Rename folder',
          description: describeTool({
            summary: 'Rename or move a folder.',
            returns: 'Links into the folder are updated if the user enabled "Automatically update internal links". `linksUpdated` and `updatedFiles` report the rewritten links, `autoUpdateLinks` the setting, and `warning` is set when other files link to it but were not updated.',
            examples: ['Use when: renaming "WIP" to "Archive".'],
            errors: ['"Folder not found" if path does not exist.'],
          }),
          schema: renameFolderSchema,
          outputSchema: renameOutputSchema,
          handler: handlers.renameFolder,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_list',
          title: 'List folder',
          description: describeTool({
            summary: 'List files and folders directly under a path (non-recursive).',
            examples: ['Use when: inspecting the top level of the vault.'],
            errors: ['"Folder not found" if path does not exist.'],
            seeAlso: [
              'vault_list_recursive — when you also need files in subfolders.',
            ],
          }),
          schema: listFolderSchema,
          outputSchema: listFolderOutputSchema,
          handler: handlers.listFolder,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_list_recursive',
          title: 'List folder (recursive)',
          description: describeTool({
            summary: 'List all files and folders under a path, recursively.',
            returns: 'Files are paged with limit/offset; folders are always listed in full.',
            examples: [
              'Use when: building an index of a subfolder.',
              'Don\'t use when: the folder is very large — list a narrower subfolder.',
            ],
            errors: ['"Folder not found" if path does not exist.'],
            seeAlso: [
              'vault_list — when you only need direct children of one folder.',
            ],
          }),
          schema: listRecursiveSchema,
          outputSchema: listRecursiveOutputSchema,
          handler: handlers.listRecursive,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_read_binary',
          title: 'Read binary file',
          description: describeTool({
            summary: 'Read binary file contents as base64.',
            returns: 'The text is the bare base64 string. Refuses files over 1 MiB.',
            examples: ['Use when: embedding an image referenced from a note.'],
            errors: [
              '"File not found" if path does not exist.',
              '"Binary file too large" if the file exceeds 1 MiB.',
            ],
          }),
          schema: readBinarySchema,
          outputSchema: readBinaryOutputSchema,
          handler: handlers.readBinary,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_write_binary',
          title: 'Write binary file',
          description: describeTool({
            summary: 'Write binary file contents from a base64 string. Missing parent folders are created.',
            examples: ['Use when: attaching a downloaded PDF to the vault.'],
            errors: ['"Invalid base64 string" if data is not valid base64.', MTIME_CONFLICT_ERROR],
          }),
          schema: writeBinarySchema,
          outputSchema: writeBinaryOutputSchema,
          handler: handlers.writeBinary,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_get_aspect',
          title: 'Get file aspect',
          description: describeTool({
            summary:
              'Get one metadata aspect of a file: frontmatter, headings, ' +
              'outgoing links, embeds, backlinks, or block references.',
            examples: [
              'Use when: "list the headings in README.md" → { path: "README.md", aspect: "headings" }.',
              'Use when: "what links to this note?" → { path: "ideas.md", aspect: "backlinks" }.',
              'Use when: "how is this note referenced?" → { path: "ideas.md", aspect: "backlinks", includeContext: true }.',
            ],
            errors: ['"File not found" if the path does not exist.'],
          }),
          schema: getAspectSchema,
          outputSchema: getAspectOutputSchema,
          handler: handlers.getAspect,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_daily_note',
          title: 'Open or create the daily note',
          description: describeTool({
            summary:
              "Resolve today's daily-note path from the daily-notes core plugin's settings, creating the note from the configured template if it does not yet exist. Pass create=false to look the note up without creating it.",
            examples: [
              "Use when: starting a daily review and you need today's note as context.",
              'Use when: checking whether a past daily note exists → { date: "2026-01-02", create: false }.',
              "Don't use when: you want a weekly/monthly note (not supported by this tool).",
            ],
            errors: [
              '"Plugin API unavailable for daily-notes" when the daily-notes core plugin is disabled.',
              '"date must be a valid calendar date" for malformed or out-of-calendar input.',
              '"Path must not traverse outside the vault" if the configured format produces a traversing path.',
            ],
          }),
          schema: dailyNoteSchema,
          outputSchema: dailyNoteOutputSchema,
          handler: handlers.dailyNote,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_set_frontmatter',
          title: 'Set frontmatter',
          description: describeTool({
            summary:
              'Set or remove YAML frontmatter keys of a Markdown note without rewriting the rest of the file.',
            returns:
              'The resulting frontmatter and the new modified timestamp. Obsidian writes the YAML, keeps key order and creates the block if missing.',
            examples: [
              'Use when: marking a note done -> { path: "projects/alpha.md", set: { status: "done" } }',
              'Use when: dropping a key -> { path: "projects/alpha.md", set: {}, remove: ["draft"] }',
              'Don\'t use when: changing the note body — use vault_update or the editor tools.',
            ],
            errors: [
              '"File not found" if the path does not exist.',
              '"Frontmatter can only be set on Markdown (.md) files" for other file types.',
              '"Keys cannot be both set and removed" if a key appears in set and remove.',
              '"Nothing to change" if set is empty and remove is missing or empty.',
              MTIME_CONFLICT_ERROR,
            ],
            seeAlso: [
              'vault_get_aspect — with aspect=frontmatter to read frontmatter without changing it.',
            ],
          }),
          schema: setFrontmatterSchema,
          outputSchema: setFrontmatterOutputSchema,
          handler: handlers.setFrontmatter,
          annotations: annotations.additiveIdempotent,
        }),
      ];
    },
  };
}
