import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createHandlers, WriteMutex } from './handlers';
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
      supportsReadOnly: true,
    },

    tools(): ToolDefinition[] {
      return [
        {
          name: 'vault_create',
          description: 'Create a new file with specified path and content',
          schema: createFileSchema,
          handler: handlers.createFile,
          isReadOnly: false,
        },
        {
          name: 'vault_read',
          description: 'Read the full content of a file by path',
          schema: readFileSchema,
          handler: handlers.readFile,
          isReadOnly: true,
        },
        {
          name: 'vault_update',
          description: 'Update (overwrite) the content of an existing file',
          schema: updateFileSchema,
          handler: handlers.updateFile,
          isReadOnly: false,
        },
        {
          name: 'vault_delete',
          description: 'Delete a file by path',
          schema: deleteFileSchema,
          handler: handlers.deleteFile,
          isReadOnly: false,
        },
        {
          name: 'vault_append',
          description: 'Append content to the end of an existing file',
          schema: appendFileSchema,
          handler: handlers.appendFile,
          isReadOnly: false,
        },
        {
          name: 'vault_get_metadata',
          description: 'Get file metadata (size, creation date, modification date)',
          schema: getMetadataSchema,
          handler: handlers.getMetadata,
          isReadOnly: true,
        },
        {
          name: 'vault_rename',
          description: 'Rename a file within the same folder',
          schema: renameFileSchema,
          handler: handlers.renameFile,
          isReadOnly: false,
        },
        {
          name: 'vault_move',
          description: 'Move a file to a different folder',
          schema: moveFileSchema,
          handler: handlers.moveFile,
          isReadOnly: false,
        },
        {
          name: 'vault_copy',
          description: 'Copy a file to a new path',
          schema: copyFileSchema,
          handler: handlers.copyFile,
          isReadOnly: false,
        },
        {
          name: 'vault_create_folder',
          description: 'Create a new folder',
          schema: createFolderSchema,
          handler: handlers.createFolder,
          isReadOnly: false,
        },
        {
          name: 'vault_delete_folder',
          description: 'Delete a folder (optionally recursive)',
          schema: deleteFolderSchema,
          handler: handlers.deleteFolder,
          isReadOnly: false,
        },
        {
          name: 'vault_rename_folder',
          description: 'Rename or move a folder',
          schema: renameFolderSchema,
          handler: handlers.renameFolder,
          isReadOnly: false,
        },
        {
          name: 'vault_list',
          description: 'List files and folders at a given path (non-recursive)',
          schema: listFolderSchema,
          handler: handlers.listFolder,
          isReadOnly: true,
        },
        {
          name: 'vault_list_recursive',
          description: 'List files and folders recursively from a given path',
          schema: listRecursiveSchema,
          handler: handlers.listRecursive,
          isReadOnly: true,
        },
        {
          name: 'vault_read_binary',
          description: 'Read binary file content as base64',
          schema: readBinarySchema,
          handler: handlers.readBinary,
          isReadOnly: true,
        },
        {
          name: 'vault_write_binary',
          description: 'Write binary file content from base64',
          schema: writeBinarySchema,
          handler: handlers.writeBinary,
          isReadOnly: false,
        },
      ];
    },
  };
}
