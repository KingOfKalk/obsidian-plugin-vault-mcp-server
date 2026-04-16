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
      ];
    },
  };
}
