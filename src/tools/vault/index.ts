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
} from './schemas';

/**
 * Output schemas for the read tools that emit `structuredContent`. Each
 * shape mirrors what the corresponding handler in `./handlers.ts` puts on
 * `result.structuredContent` — declaring them here lets modern MCP clients
 * validate / introspect the typed payload.
 */
const readFileOutputSchema = {
  path: z.string().describe('Vault-relative path that was read.'),
  content: z
    .string()
    .describe('File content in the requested window (the whole file when it fits).'),
  total_length: z.number().describe('Length of the whole file in characters.'),
  offset: z.number().describe('Character offset where this window starts.'),
  has_more: z.boolean().describe('True when the file continues past this window.'),
  next_offset: z
    .number()
    .optional()
    .describe('Offset to pass in the next call when has_more is true.'),
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
  has_more: z
    .boolean()
    .describe('True when there are more files past this page.'),
  next_offset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when has_more is true.'),
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
 * emits `structuredContent: { path, data, encoding: 'base64', size_bytes }`
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
  size_bytes: z
    .number()
    .describe('Decoded file size in bytes (length of the underlying binary).'),
};

const dailyNoteOutputSchema = {
  path: z.string().describe('Vault-relative path of the daily note.'),
  created: z
    .boolean()
    .describe('True when the note was just created; false when it already existed.'),
  content: z.string().describe('Full note content (template-expanded body when newly created).'),
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
const deletedOutputSchema = { path: writePath, deleted: alwaysTrue };

const deleteFolderOutputSchema = {
  path: writePath,
  deleted: alwaysTrue,
  recursive: z.boolean().describe('Whether the delete was recursive.'),
};

const fromToOutputSchema = {
  from: z.string().describe('Vault-relative source path.'),
  to: z.string().describe('Vault-relative destination path.'),
};

const writeBinaryOutputSchema = {
  path: writePath,
  size_bytes: z.number().describe('Number of bytes written.'),
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
            summary: 'Create a new file at a vault-relative path with text content.',
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
            returns: 'Files over 24 000 characters come in windows: while has_more is true, call again with offset=next_offset.',
            examples: [
              'Use when: "show me the README" -> { path: "README.md" }',
              'Use when: continuing a large file -> { path: "big.md", offset: 24000 }',
            ],
            errors: [
              '"File not found" if the path does not exist.',
              '"Path must not traverse outside the vault" on traversal attempts.',
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
              'Don\'t use when: you only need to append (use vault_append).',
            ],
            errors: ['"File not found" if the path does not exist.'],
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
            errors: ['"File not found" if the path does not exist.'],
          }),
          schema: appendFileSchema,
          outputSchema: appendedOutputSchema,
          handler: handlers.appendFile,
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
            examples: ['Use when: renaming "draft.md" to "final.md" in the same folder.'],
            errors: [
              '"Invalid rename target" if newName contains path separators.',
              '"File not found" if path does not exist.',
            ],
          }),
          schema: renameFileSchema,
          outputSchema: fromToOutputSchema,
          handler: handlers.renameFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_move',
          title: 'Move file',
          description: describeTool({
            summary: 'Move a file to a different path (can change folder and name).',
            examples: ['Use when: archiving a note by moving it to "archive/<name>.md".'],
            errors: ['"File not found" if path does not exist.'],
          }),
          schema: moveFileSchema,
          outputSchema: fromToOutputSchema,
          handler: handlers.moveFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_copy',
          title: 'Copy file',
          description: describeTool({
            summary: 'Copy a file to a new path, leaving the original in place.',
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
            examples: ['Use when: renaming "WIP" to "Archive".'],
            errors: ['"Folder not found" if path does not exist.'],
          }),
          schema: renameFolderSchema,
          outputSchema: fromToOutputSchema,
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
            summary: 'Write binary file contents from a base64 string.',
            examples: ['Use when: attaching a downloaded PDF to the vault.'],
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
              'Use when: "list the headings in README.md" → { path: "README.md", aspect: "headings" }.',
              'Use when: "what links to this note?" → { path: "ideas.md", aspect: "backlinks" }.',
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
              "Resolve today's daily-note path from the daily-notes core plugin's settings, creating the note from the configured template if it does not yet exist.",
            examples: [
              "Use when: starting a daily review and you need today's note as context.",
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
      ];
    },
  };
}
