import { z } from 'zod';
import { ToolModule, ToolDefinition, annotations, defineTool } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createHandlers, WriteMutex } from './handlers';
import { createSearchHandlers } from '../search/handlers';
import { filePathSchema as searchFilePathSchema } from '../search/schemas';
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
} from './schemas';

/**
 * Output schemas for the read tools that emit `structuredContent`. Each
 * shape mirrors what the corresponding handler in `./handlers.ts` puts on
 * `result.structuredContent` — declaring them here lets modern MCP clients
 * validate / introspect the typed payload.
 */
const readFileOutputSchema = {
  path: z.string().describe('Vault-relative path that was read.'),
  content: z.string().describe('Full UTF-8 file content.'),
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
 * Output schemas for the `vault_get_*` single-path getters. These tools were
 * renamed from `search_get_*` by #255 and use search handlers, but they live
 * in the vault module today and so their `outputSchema` declarations live
 * alongside the rest of the vault read schemas (Batch B of #248).
 */
const getFrontmatterOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  frontmatter: z
    .record(z.string(), z.unknown())
    .describe('Parsed YAML frontmatter object, or {} when absent.'),
};

const getHeadingsOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  headings: z
    .array(
      z.object({
        heading: z.string().describe('Heading text.'),
        level: z.number().describe('Heading level (1..6).'),
      }),
    )
    .describe('Headings in document order.'),
};

const getOutgoingLinksOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  links: z
    .array(
      z.object({
        link: z.string().describe('Link target.'),
        displayText: z
          .string()
          .optional()
          .describe('Optional alias used in [[link|alias]] notation.'),
      }),
    )
    .describe('Outgoing links from this file.'),
};

const getEmbedsOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  embeds: z
    .array(
      z.object({
        link: z.string().describe('Embed target.'),
        displayText: z.string().optional().describe('Optional alias.'),
      }),
    )
    .describe('Embeds (![[...]]) referenced by this file.'),
};

const getBacklinksOutputSchema = {
  path: z.string().describe('Target path that was queried.'),
  backlinks: z
    .array(z.string())
    .describe('Vault-relative paths of files that link TO the target.'),
};

const getBlockReferencesOutputSchema = {
  path: z.string().describe('Vault-relative path that was inspected.'),
  blockRefs: z
    .array(
      z.object({
        id: z.string().describe('Block-reference id (without the leading ^).'),
        line: z.string().describe('The line of text the block-reference is on.'),
      }),
    )
    .describe('Block references defined in this file.'),
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

export function createVaultModule(adapter: ObsidianAdapter): ToolModule {
  const mutex = new WriteMutex();
  const handlers = createHandlers(adapter, mutex);
  const searchHandlers = createSearchHandlers(adapter);

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
          description: describeTool({
            summary: 'Create a new file at a vault-relative path with text content.',
            args: [
              'path (string): Vault-relative path for the new file.',
              'content (string): Initial file contents (UTF-8 text).',
            ],
            returns: 'Plain text confirmation "Created file: <path>".',
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
          handler: handlers.createFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_read',
          description: describeTool({
            summary: 'Read the full UTF-8 content of a file by vault-relative path.',
            args: ['path (string): Vault-relative path to the file.'],
            returns: 'The full file content as text. Payloads over 25 000 characters are truncated with a [TRUNCATED: ...] footer.',
            examples: [
              'Use when: "show me the README" -> { path: "README.md" }',
              'Don\'t use when: you only need specific lines (use editor_* or search tools).',
            ],
            errors: [
              '"File not found" if the path does not exist.',
              '"Path must not traverse outside the vault" on traversal attempts.',
            ],
          }, readFileSchema),
          schema: readFileSchema,
          outputSchema: readFileOutputSchema,
          handler: handlers.readFile,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_update',
          description: describeTool({
            summary: 'Overwrite an existing file with new content.',
            args: [
              'path (string): Vault-relative path to an existing file.',
              'content (string): Replacement file contents.',
            ],
            returns: 'Plain text confirmation "Updated file: <path>".',
            examples: [
              'Use when: replacing a draft with a final version.',
              'Don\'t use when: you only need to append (use vault_append).',
            ],
            errors: ['"File not found" if the path does not exist.'],
          }),
          schema: updateFileSchema,
          handler: handlers.updateFile,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_delete',
          description: describeTool({
            summary: 'Delete a file by vault-relative path.',
            args: ['path (string): Vault-relative path to the file.'],
            returns: 'Plain text confirmation "Deleted file: <path>".',
            examples: ['Use when: removing an outdated note.'],
            errors: ['"File not found" if the path does not exist.'],
          }),
          schema: deleteFileSchema,
          handler: handlers.deleteFile,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_append',
          description: describeTool({
            summary: 'Append content to the end of an existing file.',
            args: [
              'path (string): Vault-relative path to an existing file.',
              'content (string): Text to append.',
            ],
            returns: 'Plain text confirmation "Appended to file: <path>".',
            examples: ['Use when: adding a new bullet to a daily note.'],
            errors: ['"File not found" if the path does not exist.'],
          }),
          schema: appendFileSchema,
          handler: handlers.appendFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_get_metadata',
          description: describeTool({
            summary: 'Get file stat metadata (size, creation date, modification date).',
            args: ['path (string): Vault-relative path to the file.'],
            returns: 'JSON: { path, size, created (ISO), modified (ISO) }.',
            examples: ['Use when: checking if a note has changed recently.'],
            errors: ['"File not found" if the path does not exist.'],
          }, getMetadataSchema),
          schema: getMetadataSchema,
          outputSchema: getMetadataOutputSchema,
          handler: handlers.getMetadata,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_rename',
          description: describeTool({
            summary: 'Rename a file within its current folder.',
            args: [
              'path (string): Current vault-relative path.',
              'newName (string): New basename — must not contain / or \\.',
            ],
            returns: 'Plain text "Renamed file: <old> → <new>".',
            examples: ['Use when: renaming "draft.md" to "final.md" in the same folder.'],
            errors: [
              '"Invalid rename target" if newName contains path separators.',
              '"File not found" if path does not exist.',
            ],
          }),
          schema: renameFileSchema,
          handler: handlers.renameFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_move',
          description: describeTool({
            summary: 'Move a file to a different path (can change folder and name).',
            args: [
              'path (string): Current vault-relative path.',
              'newPath (string): New vault-relative path.',
            ],
            returns: 'Plain text "Moved file: <old> → <new>".',
            examples: ['Use when: archiving a note by moving it to "archive/<name>.md".'],
            errors: ['"File not found" if path does not exist.'],
          }),
          schema: moveFileSchema,
          handler: handlers.moveFile,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_copy',
          description: describeTool({
            summary: 'Copy a file to a new path, leaving the original in place.',
            args: [
              'sourcePath (string): Existing vault-relative file.',
              'destPath (string): New vault-relative path.',
            ],
            returns: 'Plain text "Copied file: <src> → <dest>".',
            examples: ['Use when: duplicating a template before editing.'],
            errors: ['"File not found" if sourcePath does not exist.'],
          }),
          schema: copyFileSchema,
          handler: handlers.copyFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_create_folder',
          description: describeTool({
            summary: 'Create a new folder at a vault-relative path.',
            args: ['path (string): Folder path to create.'],
            returns: 'Plain text "Created folder: <path>".',
            examples: ['Use when: creating a "projects" folder before adding notes.'],
            errors: ['"Folder already exists" if the path is taken.'],
          }),
          schema: createFolderSchema,
          handler: handlers.createFolder,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'vault_delete_folder',
          description: describeTool({
            summary: 'Delete a folder, optionally recursively.',
            args: [
              'path (string): Folder to delete.',
              'recursive (boolean, default=false): Delete non-empty folders recursively.',
            ],
            returns: 'Plain text "Deleted folder: <path>".',
            examples: ['Use when: removing an empty "old-drafts" folder.'],
            errors: ['"Folder not empty" if non-empty and recursive=false.'],
          }),
          schema: deleteFolderSchema,
          handler: handlers.deleteFolder,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_rename_folder',
          description: describeTool({
            summary: 'Rename or move a folder.',
            args: [
              'path (string): Current folder path.',
              'newPath (string): New folder path.',
            ],
            returns: 'Plain text "Renamed folder: <old> → <new>".',
            examples: ['Use when: renaming "WIP" to "Archive".'],
            errors: ['"Folder not found" if path does not exist.'],
          }),
          schema: renameFolderSchema,
          handler: handlers.renameFolder,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'vault_list',
          description: describeTool({
            summary: 'List files and folders directly under a path (non-recursive).',
            args: ['path (string): Folder to list.'],
            returns: 'JSON: { files: string[], folders: string[] } (names only, no recursion).',
            examples: ['Use when: inspecting the top level of the vault.'],
            errors: ['"Folder not found" if path does not exist.'],
          }, listFolderSchema),
          schema: listFolderSchema,
          outputSchema: listFolderOutputSchema,
          handler: handlers.listFolder,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_list_recursive',
          description: describeTool({
            summary: 'List all files and folders under a path, recursively.',
            args: ['path (string): Folder to walk.'],
            returns: 'JSON: { files: string[], folders: string[] }. Truncated at 25 000 characters with a footer.',
            examples: [
              'Use when: building an index of a subfolder.',
              'Don\'t use when: the folder is very large — list a narrower subfolder.',
            ],
            errors: ['"Folder not found" if path does not exist.'],
          }, listRecursiveSchema),
          schema: listRecursiveSchema,
          outputSchema: listRecursiveOutputSchema,
          handler: handlers.listRecursive,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_read_binary',
          description: describeTool({
            summary: 'Read binary file contents as base64.',
            args: ['path (string): Vault-relative path to the file.'],
            returns:
              'Plain text: the base64 string (default). With response_format=json: { path, data, encoding, size_bytes }. Refuses files over 1 MiB.',
            examples: ['Use when: embedding an image referenced from a note.'],
            errors: [
              '"File not found" if path does not exist.',
              '"Binary file too large" if the file exceeds 1 MiB.',
            ],
          }, readBinarySchema),
          schema: readBinarySchema,
          outputSchema: readBinaryOutputSchema,
          handler: handlers.readBinary,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_write_binary',
          description: describeTool({
            summary: 'Write binary file contents from a base64 string.',
            args: [
              'path (string): Vault-relative destination path.',
              'data (string): Base64-encoded binary content (no data: prefix).',
            ],
            returns: 'Plain text "Wrote binary file: <path>".',
            examples: ['Use when: attaching a downloaded PDF to the vault.'],
            errors: ['"Invalid base64 string" if data is not valid base64.'],
          }),
          schema: writeBinarySchema,
          handler: handlers.writeBinary,
          annotations: annotations.destructiveIdempotent,
        }),
        defineTool({
          name: 'vault_get_frontmatter',
          description: describeTool({
            summary: 'Get the parsed YAML frontmatter block for a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: the frontmatter object, or {} when absent.',
            errors: ['"File not found" if the path does not exist.'],
          }, searchFilePathSchema),
          schema: searchFilePathSchema,
          outputSchema: getFrontmatterOutputSchema,
          handler: searchHandlers.searchFrontmatter,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_get_headings',
          description: describeTool({
            summary: 'List headings (with levels) for a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ heading, level }].',
            errors: ['"File not found" if the path does not exist.'],
          }, searchFilePathSchema),
          schema: searchFilePathSchema,
          outputSchema: getHeadingsOutputSchema,
          handler: searchHandlers.searchHeadings,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_get_outgoing_links',
          description: describeTool({
            summary: 'List outgoing links from a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ link, displayText? }].',
            errors: ['"File not found" if the path does not exist.'],
          }, searchFilePathSchema),
          schema: searchFilePathSchema,
          outputSchema: getOutgoingLinksOutputSchema,
          handler: searchHandlers.searchOutgoingLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_get_embeds',
          description: describeTool({
            summary: 'List embedded resources (![[...]]) referenced by a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ link, displayText? }].',
            errors: ['"File not found" if the path does not exist.'],
          }, searchFilePathSchema),
          schema: searchFilePathSchema,
          outputSchema: getEmbedsOutputSchema,
          handler: searchHandlers.searchEmbeds,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_get_backlinks',
          description: describeTool({
            summary: 'List files that link TO a given file (reverse links).',
            args: ['path (string): Target file path.'],
            returns: 'JSON: string[] of paths that reference the target.',
            errors: ['"File not found" if the path does not exist.'],
          }, searchFilePathSchema),
          schema: searchFilePathSchema,
          outputSchema: getBacklinksOutputSchema,
          handler: searchHandlers.searchBacklinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'vault_get_block_references',
          description: describeTool({
            summary: 'List block references (^block-id) defined in a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ id, line }].',
            errors: ['"File not found" if the path does not exist.'],
          }, searchFilePathSchema),
          schema: searchFilePathSchema,
          outputSchema: getBlockReferencesOutputSchema,
          handler: searchHandlers.searchBlockReferences,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
