import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateVaultPath } from '../../utils/path-guard';

export class WriteMutex {
  private locks: Map<string, Promise<void>> = new Map();

  async acquire(path: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
    const existing = this.locks.get(path) ?? Promise.resolve();
    let resolve: () => void;
    const lock = new Promise<void>((r) => {
      resolve = r;
    });
    this.locks.set(path, lock);

    await existing;
    try {
      return await fn();
    } finally {
      resolve!();
      if (this.locks.get(path) === lock) {
        this.locks.delete(path);
      }
    }
  }
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

export function createHandlers(
  adapter: ObsidianAdapter,
  mutex: WriteMutex,
): {
  createFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  readFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  updateFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  deleteFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  appendFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  getMetadata: (params: Record<string, unknown>) => Promise<CallToolResult>;
} {
  const vaultPath = adapter.getVaultPath();

  return {
    async createFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const content = params.content as string;
        return await mutex.acquire(path, async () => {
          await adapter.createFile(path, content);
          return textResult(`Created file: ${path}`);
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },

    async readFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const content = await adapter.readFile(path);
        return textResult(content);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },

    async updateFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const content = params.content as string;
        return await mutex.acquire(path, async () => {
          await adapter.modifyFile(path, content);
          return textResult(`Updated file: ${path}`);
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },

    async deleteFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        return await mutex.acquire(path, async () => {
          await adapter.deleteFile(path);
          return textResult(`Deleted file: ${path}`);
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },

    async appendFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const content = params.content as string;
        return await mutex.acquire(path, async () => {
          const existing = await adapter.readFile(path);
          await adapter.modifyFile(path, existing + content);
          return textResult(`Appended to file: ${path}`);
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },

    async getMetadata(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const stat = await adapter.stat(path);
        if (!stat) {
          return errorResult(`File not found: ${path}`);
        }
        return textResult(
          JSON.stringify({
            path,
            size: stat.size,
            created: new Date(stat.ctime).toISOString(),
            modified: new Date(stat.mtime).toISOString(),
          }),
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
