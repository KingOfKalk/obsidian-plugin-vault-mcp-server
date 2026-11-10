import { z } from 'zod';
import { ToolModule, ToolDefinition, annotations, defineTool } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createHandlers, WriteMutex } from './handlers';
import { createSearchHandlers } from '../search/handlers';
import { describeTool } from '../shared/describe';
import { MODIFIED_DESC, NEW_MODIFIED_DESC } from '../shared/descriptions';
import { pageOutputFields } from '../shared/pagination';
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
  listFolderSchema,
  listRecursiveSchema,
  readBinarySchema,
  writeBinarySchema,
  getAspectSchema,
  dailyNoteSchema,
  setFrontmatterSchema,
} from './schemas';

/**
 * Output schemas of the data tools (#467): each shape mirrors what the
 * handler in `./handlers.ts` puts on `structuredContent`, which is also
 * the JSON text of the result. vault_read, vault_daily_note and
 * vault_read_binary have none: they return text or binary content.
 */
const getMetadataOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  size: z.number().describe('File size in bytes.'),
  created: z
    .string()
    .describe('Creation timestamp as an ISO-8601 string.'),
  modified: z.string().describe(MODIFIED_DESC),
};

const listFolderOutputSchema = {
  files: z
    .array(z.string())
    .describe('Vault-relative paths of the files directly in the folder (e.g. `notes/a.md`, not `a.md`), in this page.'),
  folders: z
    .array(z.string())
    .describe('Vault-relative paths of the folders directly in the folder (e.g. `notes/sub`, not `sub`), in this page.'),
  ...pageOutputFields,
};

const listRecursiveOutputSchema = {
  folders: z
    .array(z.string())
    .describe('Folders under the listed path (recursive) in this page, paged with the same offset as the files.'),
  folderTotal: z.number().describe('Total number of folders before paging.'),
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
    .describe('True when more files or folders follow this page.'),
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
  link: z
    .string()
    .describe(
      'Link text as written (e.g. `Note#Heading`); may lack the extension.',
    ),
  path: z
    .string()
    .nullable()
    .describe('Vault path the link resolves to, or null if unresolved.'),
  subpath: z
    .string()
    .optional()
    .describe('`#Heading` or `#^block` part, when present.'),
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
    .describe('aspect=outgoing_links: links from this file, as written.'),
  embeds: z
    .array(linkItem)
    .optional()
    .describe('aspect=embeds: ![[...]] embeds in this file, as written.'),
  backlinks: z
    .array(z.string())
    .optional()
    .describe('aspect=backlinks: paths of files that link TO this file, in this page.'),
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
  total: z.number().optional().describe('aspect=backlinks: number of linking files before paging.'),
  hasMore: z.boolean().optional().describe('aspect=backlinks: true when more linking files follow this page.'),
  nextOffset: z
    .number()
    .optional()
    .describe('aspect=backlinks: offset to pass in the next call when hasMore is true.'),
  blockRefs: z
    .array(
      z.object({
        id: z.string().describe('Block-reference id (without the leading ^).'),
        text: z.string().describe('Text of the line that ends with the block id (trimmed).'),
      }),
    )
    .optional()
    .describe('aspect=block_references: ^block-ids defined in this file.'),
};

/**
 * Output schemas for the write tools (#388): small payloads that let
 * agents chain calls, e.g. `modified` into the next `expectedMtime`.
 */
const writePath = z.string().describe('Vault-relative path that was written.');
const pathOf = (what: string): z.ZodString =>
  z.string().describe(`Vault-relative path of the ${what}.`);
const alwaysTrue = z.boolean().describe('Always true on success.');

/** New mtime after a write (#447); feeds the next call's expectedMtime. */
const newModified = z.string().describe(NEW_MODIFIED_DESC);

const createdOutputSchema = { path: writePath, created: alwaysTrue, modified: newModified };
const createdFolderOutputSchema = { path: pathOf('created folder'), created: alwaysTrue };
const updatedOutputSchema = { path: writePath, updated: alwaysTrue, modified: newModified };

const appendedOutputSchema = { path: writePath, appended: alwaysTrue, modified: newModified };
/**
 * Where a delete went, read from the user's "Deleted files" setting
 * (#430).
 */
const trashedTo = z
  .enum(['system', 'vault', 'permanent', 'unknown'])
  .describe(
    'Where the item went, per the user\'s "Deleted files" setting: "system" (system trash), "vault" (the vault\'s .trash folder), "permanent" (deleted for good), or "unknown" if the setting could not be read.',
  );

const deletedOutputSchema = { path: pathOf('deleted file'), deleted: alwaysTrue, trashedTo };

const deleteFolderOutputSchema = {
  path: pathOf('deleted folder'),
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
  modified: newModified,
};

const insertOutputSchema = {
  path: writePath,
  heading: z.string().describe('The matched heading as written, e.g. "## Log".'),
  position: z.enum(['start', 'end']).describe('Where the text went in the section.'),
  line: z.number().describe('1-based line number where the inserted text starts.'),
  modified: newModified,
};

/** Error line shared by the tools that address a section by heading (#428). */
const HEADING_ERRORS =
  '"Heading not found" or "Heading … is ambiguous" (with the candidate headings and their line numbers) if none or several match.';

/** Errors of the rename/move tools, as the adapter and Obsidian word them (#449). */
const PATH_NOT_FOUND_ERROR = '"Path not found" if path does not exist.';
const DESTINATION_EXISTS_ERROR =
  '"Destination already exists" if the new path is taken; nothing is moved.';

/**
 * Error line of the tools that take a file path. The conflict error of
 * `expectedMtime` is in that parameter's text (EXPECTED_MTIME_DESC), and
 * the traversal error in the server instructions (#457).
 */
const FILE_NOT_FOUND_ERROR = '"File not found" if path does not exist.';

/** Link handling of the rename/move tools (#449). */
const LINK_UPDATE_RETURNS =
  'Links to it (for a folder: to every file in it) are updated only if the user enabled "Automatically update internal links"; ' +
  'no Obsidian prompt appears either way. linksUpdated and updatedFiles report the rewritten links, autoUpdateLinks the setting; ' +
  'warning is set when other files link to it but were not updated.';

/** Where a delete goes (#449). */
const TRASH_RETURNS =
  'It goes where the user\'s "Deleted files" setting says; trashedTo reports which: "system" (system trash), ' +
  '"vault" (the vault\'s .trash folder), "permanent", or "unknown" if the setting cannot be read.';

const writeBinaryOutputSchema = {
  path: writePath,
  sizeBytes: z.number().describe('Number of bytes written.'),
  modified: newModified,
};

const setFrontmatterOutputSchema = {
  path: writePath,
  frontmatter: z
    .record(z.string(), z.unknown())
    .describe('The whole frontmatter after the change ({} when no keys are left).'),
  modified: newModified,
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
            summary: 'Create a new text file. Missing parent folders are created.',
            examples: [
              'Don\'t use when: the file exists — use vault_update.',
            ],
            errors: ['"File already exists" if path is taken.'],
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
            summary: 'Read the UTF-8 content of a file.',
            returns:
              'Text: "key: value" header lines (path, modified, totalLength, offset, hasMore, nextOffset; heading, line), a blank line, the raw text. ' +
              'Files over 24 000 characters come in windows: while hasMore is true, call again with offset=nextOffset. ' +
              'With heading, only that section (paged the same way).',
            examples: [
              'Use when: "show me the README" -> { path: "README.md" }',
              'Use when: continuing a large file -> { path: "big.md", offset: 24000 }',
              'Use when: reading one section -> { path: "journal.md", heading: "## Log" }',
            ],
            errors: [
              FILE_NOT_FOUND_ERROR,
              HEADING_ERRORS,
            ],
            seeAlso: [
              'editor_get_content — for the file open in the editor (no path needed).',
            ],
          }),
          schema: readFileSchema,
          handler: handlers.readFile,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_update',
          title: 'Replace file content',
          description: describeTool({
            summary: 'Overwrite an existing file with new content.',
            examples: [
              'Don\'t use when: appending (vault_append) or changing one passage (vault_replace).',
              'Don\'t use when: you read only part of a large file — writing that window back truncates the note.',
            ],
            errors: [FILE_NOT_FOUND_ERROR],
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
            summary: 'Delete a file.',
            returns: TRASH_RETURNS,
            errors: [FILE_NOT_FOUND_ERROR],
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
            returns:
              'If the file is not empty, does not end with a line break and content does not start with one, ' +
              'one line break (the file\'s own LF or CRLF) is added first, so the content starts on a new line. ' +
              'The result has the new modified timestamp.',
            examples: ['Use when: adding a bullet to a daily note -> { path: "daily/2026-01-02.md", content: "- call Ada" }'],
            errors: [FILE_NOT_FOUND_ERROR],
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
              'Pass edits instead of oldString/newString for several replacements, all or nothing.',
            returns:
              'Matching and writing happen in one atomic step; on any error nothing is written. Matching uses the raw file text, ' +
              'line endings included (in a CRLF file a line break is \\r\\n). With edits, the result adds edits: [{ index, replacements }].',
            examples: [
              'Use when: fixing one line in a large note -> { path: "notes/a.md", oldString: "status: draft", newString: "status: done" }',
              'Use when: renaming a term everywhere in one file -> { ..., replaceAll: true }',
              'Use when: changing two places at once -> { path: "notes/a.md", edits: [{ oldString: "## Agenda\\n- old", newString: "## Agenda\\n- new" }, { oldString: "- [ ] task", newString: "- [x] task" }] }',
              'Don\'t use when: editing the open note by line/column (use editor_replace).',
            ],
            errors: [
              FILE_NOT_FOUND_ERROR,
              '"oldString not found … (0 matches)" or "oldString is ambiguous … (N matches)".',
              '"edits[i].oldString not found/is ambiguous … (N matches)" or "edits[i] and edits[j] overlap".',
              '"Pass either oldString/newString or edits, not both" (or neither).',
            ],
            seeAlso: [
              'vault_update — to replace the whole file.',
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
              'Finding the section and writing happen in one atomic step; on any error nothing is written.',
            examples: [
              'Use when: adding a log entry -> { path: "journal.md", heading: "## Log", text: "- 09:30 standup" }',
              'Use when: putting a note at the top of a section -> { path: "a.md", heading: "Notes", position: "start", text: "Important!" }',
              "Don't use when: the edit is not at a section boundary (use vault_replace).",
            ],
            errors: [
              FILE_NOT_FOUND_ERROR,
              HEADING_ERRORS,
            ],
            seeAlso: [
              'vault_read — with heading, to read just that section first.',
              'vault_append — to add to the end of the file.',
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
            summary: 'Get file stat metadata: size in bytes, creation and modification time.',
            examples: ['Use when: checking if a note has changed recently.'],
            errors: [FILE_NOT_FOUND_ERROR],
            seeAlso: [
              'extras_get_date — for the current date and time, not a file\'s timestamp.',
            ],
          }),
          schema: getMetadataSchema,
          outputSchema: getMetadataOutputSchema,
          handler: handlers.getMetadata,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_rename',
          title: 'Rename file or folder',
          description: describeTool({
            summary: 'Rename a file or folder within its current folder.',
            returns: LINK_UPDATE_RETURNS,
            examples: ['Use when: renaming "notes/draft.md" to "notes/final.md" -> { path: "notes/draft.md", newName: "final.md" }'],
            errors: [
              '"newName must not contain path separators" if newName has / or \\; "Invalid rename target" if it is blank or invalid.',
              PATH_NOT_FOUND_ERROR,
              DESTINATION_EXISTS_ERROR,
            ],
          }),
          schema: renameFileSchema,
          outputSchema: renameOutputSchema,
          handler: handlers.renameFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_move',
          title: 'Move file or folder',
          description: describeTool({
            summary: 'Move a file or folder to a new path (can change folder and name). Missing parent folders are created.',
            returns: LINK_UPDATE_RETURNS,
            errors: [PATH_NOT_FOUND_ERROR, DESTINATION_EXISTS_ERROR],
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
            errors: [
              '"File not found" if sourcePath does not exist or is a folder.',
              '"Destination already exists" if destPath is taken; nothing is copied.',
            ],
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
            summary: 'Create a new folder.',
            errors: ['"Folder already exists" if the path is taken.'],
          }),
          schema: createFolderSchema,
          outputSchema: createdFolderOutputSchema,
          handler: handlers.createFolder,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_delete_folder',
          title: 'Delete folder',
          description: describeTool({
            summary: 'Delete a folder, optionally recursively.',
            returns: TRASH_RETURNS,
            errors: [
              '"Folder not found" if path does not exist or is not a folder.',
              '"Folder "<path>" is not empty. Use recursive=true to delete." if it has contents and recursive is false.',
            ],
          }),
          schema: deleteFolderSchema,
          outputSchema: deleteFolderOutputSchema,
          handler: handlers.deleteFolder,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_list',
          title: 'List folder',
          description: describeTool({
            summary: 'List files and folders directly under a path (non-recursive), as full vault-relative paths.',
            returns: 'Folders first, then files, paged together with limit/offset.',
            errors: ['"Folder not found" if path does not exist.'],
            seeAlso: [
              'vault_list_recursive — to include subfolders.',
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
            returns: 'Files and folders are paged with the same limit/offset, each list on its own.',
            examples: [
              'Don\'t use when: the folder is very large — list a narrower subfolder.',
            ],
            errors: ['"Folder not found" if path does not exist.'],
            seeAlso: [
              'vault_list — for the direct children of one folder only.',
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
            summary: 'Read a binary file (up to 1 MiB).',
            returns:
              'An image block for images, an audio block for audio, else an embedded resource (base64 blob), after a short text header. ' +
              'For text files use vault_read.',
            errors: [
              FILE_NOT_FOUND_ERROR,
              '"Binary file too large" if the file exceeds 1 MiB.',
            ],
          }),
          schema: readBinarySchema,
          handler: handlers.readBinary,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_write_binary',
          title: 'Write binary file',
          description: describeTool({
            summary: 'Create a binary file from base64, or overwrite it if it exists. Missing parent folders are created.',
            errors: ['"Invalid base64 string" if data is not valid base64.'],
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
              'Use when: "list the headings in README.md" → { path: "README.md", aspect: "headings" }',
              'Use when: "what links to this note?" → { path: "ideas.md", aspect: "backlinks" }',
              'Use when: "how is this note referenced?" → { ..., aspect: "backlinks", includeContext: true }',
            ],
            errors: [FILE_NOT_FOUND_ERROR],
          }),
          schema: getAspectSchema,
          outputSchema: getAspectOutputSchema,
          handler: handlers.getAspect,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_daily_note',
          title: 'Get or create a daily note',
          description: describeTool({
            summary:
              "Resolve the daily note's path for today or date from the Daily notes core plugin settings and return the note if it exists. " +
              'Does not open it in the editor. Creates a missing note (from the configured template) only with create=true.',
            returns:
              'Text: "key: value" header lines (path, exists, created, warning, paging), a blank line, the note (continue a long one with vault_read). ' +
              "In a new note {{date}} is the note's date (YYYY-MM-DD), {{time}} the current local time (HH:mm), {{title}} the file name without .md; " +
              "{{date:FORMAT}} / {{time:FORMAT}} format the note's date with the current time by a moment.js format (e.g. {{date:dddd}}). " +
              'Templater syntax (<%) is copied unchanged; a configured template that is missing gives an empty note and a warning.',
            examples: [
              "Use when: you need today's note, creating it if missing → { create: true }",
              'Use when: checking whether a past daily note exists → { date: "2026-01-02" }',
              "Don't use when: you want a weekly/monthly note (not supported).",
            ],
            errors: [
              '"Plugin API unavailable for daily-notes" if the Daily notes core plugin is disabled.',
              '"date must be a valid calendar date" for an out-of-calendar date such as 2026-02-30.',
              '"Path must not traverse outside the vault" if the configured format leads outside the vault.',
            ],
          }),
          schema: dailyNoteSchema,
          handler: handlers.dailyNote,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_set_frontmatter',
          title: 'Set frontmatter',
          description: describeTool({
            summary:
              'Set or remove YAML frontmatter keys of a Markdown note; the body is untouched. Obsidian rewrites the YAML block, so quoting of other keys can change.',
            returns:
              'The resulting frontmatter and the new modified timestamp. Key order and values are kept; a missing block is created.',
            examples: [
              'Use when: marking a note done -> { path: "projects/alpha.md", set: { status: "done" } }',
              'Use when: dropping a key -> { path: "projects/alpha.md", set: {}, remove: ["draft"] }',
              'Don\'t use when: changing the note body (vault_replace, vault_insert).',
            ],
            errors: [
              FILE_NOT_FOUND_ERROR,
              '"Frontmatter can only be set on Markdown (.md) files" for other file types.',
              '"Keys cannot be both set and removed" if a key is in both.',
              '"Nothing to change" if set is empty and remove is missing or empty.',
            ],
            seeAlso: [
              'vault_get_aspect — with aspect=frontmatter to read it without changing it.',
            ],
          }),
          schema: setFrontmatterSchema,
          outputSchema: setFrontmatterOutputSchema,
          handler: handlers.setFrontmatter,
          annotations: annotations.destructiveIdempotent,
        }),
      ];
    },
  };
}
