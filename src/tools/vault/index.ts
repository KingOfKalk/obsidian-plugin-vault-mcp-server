import { ToolModule, ToolDefinition, annotations } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createHandlers, WriteMutex } from './handlers';
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

export function createVaultModule(adapter: ObsidianAdapter): ToolModule {
  const mutex = new WriteMutex();
  const handlers = createHandlers(adapter, mutex);

  return {
    metadata: {
      id: 'vault',
      name: 'Vault and File Operations',
      description: 'Create, read, update, delete, and manage files in the vault',
    },

    tools(): ToolDefinition[] {
      return [
        {
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
        },
        {
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
          }),
          schema: readFileSchema,
          handler: handlers.readFile,
          annotations: annotations.read,
        },
        {
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
        },
        {
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
        },
        {
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
        },
        {
          name: 'vault_get_metadata',
          description: describeTool({
            summary: 'Get file stat metadata (size, creation date, modification date).',
            args: ['path (string): Vault-relative path to the file.'],
            returns: 'JSON: { path, size, created (ISO), modified (ISO) }.',
            examples: ['Use when: checking if a note has changed recently.'],
            errors: ['"File not found" if the path does not exist.'],
          }),
          schema: getMetadataSchema,
          handler: handlers.getMetadata,
          annotations: annotations.read,
        },
        {
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
        },
        {
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
        },
        {
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
        },
        {
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
        },
        {
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
        },
        {
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
        },
        {
          name: 'vault_list',
          description: describeTool({
            summary: 'List files and folders directly under a path (non-recursive).',
            args: ['path (string): Folder to list.'],
            returns: 'JSON: { files: string[], folders: string[] } (names only, no recursion).',
            examples: ['Use when: inspecting the top level of the vault.'],
            errors: ['"Folder not found" if path does not exist.'],
          }),
          schema: listFolderSchema,
          handler: handlers.listFolder,
          annotations: annotations.read,
        },
        {
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
          }),
          schema: listRecursiveSchema,
          handler: handlers.listRecursive,
          annotations: annotations.read,
        },
        {
          name: 'vault_read_binary',
          description: describeTool({
            summary: 'Read binary file contents as base64.',
            args: ['path (string): Vault-relative path to the file.'],
            returns: 'Plain text: the base64 string. Refuses files over 1 MiB.',
            examples: ['Use when: embedding an image referenced from a note.'],
            errors: [
              '"File not found" if path does not exist.',
              '"Binary file too large" if the file exceeds 1 MiB.',
            ],
          }),
          schema: readBinarySchema,
          handler: handlers.readBinary,
          annotations: annotations.read,
        },
        {
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
        },
      ];
    },
  };
}
