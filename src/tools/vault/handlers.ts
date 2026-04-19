import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateVaultPath } from '../../utils/path-guard';
import { truncateText } from '../shared/truncate';
import { handleToolError } from '../shared/errors';
import { paginate, readPagination } from '../shared/pagination';
import { makeResponse, readResponseFormat } from '../shared/response';
import { BINARY_BYTE_LIMIT } from '../../constants';

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
  return handleToolError(new Error(message));
}

function renderFolderListing(
  path: string,
  folders: string[],
  files: string[],
): string {
  if (folders.length === 0 && files.length === 0) {
    return `\`${path}\` is empty.`;
  }
  const lines: string[] = [`**${path}**`];
  if (folders.length > 0) {
    lines.push('', 'Folders:', ...folders.map((f) => `- ${f}/`));
  }
  if (files.length > 0) {
    lines.push('', 'Files:', ...files.map((f) => `- ${f}`));
  }
  return lines.join('\n');
}

function renderRecursiveListing(
  path: string,
  folders: string[],
  files: string[],
  total: number,
  hasMore: boolean,
  nextOffset: number | undefined,
): string {
  const folderLine = folders.length > 0 ? `${String(folders.length)} folders` : '0 folders';
  const fileLine = `${String(files.length)} of ${String(total)} files`;
  const header = `**${path}** — ${folderLine}, ${fileLine}`;
  const lines: string[] = [header];
  if (folders.length > 0) {
    lines.push('', 'Folders:', ...folders.map((f) => `- ${f}/`));
  }
  if (files.length > 0) {
    lines.push('', 'Files:', ...files.map((f) => `- ${f}`));
  }
  if (hasMore) {
    lines.push('', `_More files available — next offset: ${String(nextOffset ?? '')}_`);
  }
  return lines.join('\n');
}

const RENAME_TARGET_PATTERN = /^[^/\\\x00]+$/;

function isValidRenameTarget(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    value.trim().length > 0 &&
    RENAME_TARGET_PATTERN.test(value)
  );
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
  renameFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  moveFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  copyFile: (params: Record<string, unknown>) => Promise<CallToolResult>;
  getMetadata: (params: Record<string, unknown>) => Promise<CallToolResult>;
  createFolder: (params: Record<string, unknown>) => Promise<CallToolResult>;
  deleteFolder: (params: Record<string, unknown>) => Promise<CallToolResult>;
  renameFolder: (params: Record<string, unknown>) => Promise<CallToolResult>;
  listFolder: (params: Record<string, unknown>) => Promise<CallToolResult>;
  listRecursive: (params: Record<string, unknown>) => Promise<CallToolResult>;
  readBinary: (params: Record<string, unknown>) => Promise<CallToolResult>;
  writeBinary: (params: Record<string, unknown>) => Promise<CallToolResult>;
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
        return handleToolError(error);
      }
    },

    async readFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const content = await adapter.readFile(path);
        const result = makeResponse(
          { path, content },
          (v) => v.content,
          readResponseFormat(params),
        );
        const firstBlock = result.content[0];
        const text = firstBlock.type === 'text' ? firstBlock.text : '';
        const truncated = truncateText(text, {
          hint: 'Read a specific range via editor_* tools or ask for a summary.',
        });
        return {
          ...result,
          content: [{ type: 'text' as const, text: truncated.text }],
        };
      } catch (error) {
        return handleToolError(error);
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
        return handleToolError(error);
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
        return handleToolError(error);
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
        return handleToolError(error);
      }
    },

    async getMetadata(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const stat = await adapter.stat(path);
        if (!stat) {
          return errorResult(`File not found: ${path}`);
        }
        const payload = {
          path,
          size: stat.size,
          created: new Date(stat.ctime).toISOString(),
          modified: new Date(stat.mtime).toISOString(),
        };
        return makeResponse(
          payload,
          (v) =>
            `**${v.path}**\n- size: ${String(v.size)} bytes\n- created: ${v.created}\n- modified: ${v.modified}`,
          readResponseFormat(params),
        );
      } catch (error) {
        return handleToolError(error);
      }
    },

    async renameFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const rawNewName = params.newName;
        if (!isValidRenameTarget(rawNewName)) {
          return errorResult('Invalid rename target');
        }
        const newName = rawNewName;
        const parts = path.split('/');
        parts[parts.length - 1] = newName;
        const newPath = parts.join('/');
        try {
          validateVaultPath(newPath, vaultPath);
        } catch {
          return errorResult('Invalid rename target');
        }
        return await mutex.acquire(path, async () => {
          await adapter.renameFile(path, newPath);
          return textResult(`Renamed file: ${path} → ${newPath}`);
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async moveFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const newPath = validateVaultPath(params.newPath as string, vaultPath);
        return await mutex.acquire(path, async () => {
          await adapter.renameFile(path, newPath);
          return textResult(`Moved file: ${path} → ${newPath}`);
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async copyFile(params): Promise<CallToolResult> {
      try {
        const sourcePath = validateVaultPath(params.sourcePath as string, vaultPath);
        const destPath = validateVaultPath(params.destPath as string, vaultPath);
        await adapter.copyFile(sourcePath, destPath);
        return textResult(`Copied file: ${sourcePath} → ${destPath}`);
      } catch (error) {
        return handleToolError(error);
      }
    },

    async createFolder(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        await adapter.createFolder(path);
        return textResult(`Created folder: ${path}`);
      } catch (error) {
        return handleToolError(error);
      }
    },

    async deleteFolder(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const recursive = (params.recursive as boolean) ?? false;
        await adapter.deleteFolder(path, recursive);
        return textResult(`Deleted folder: ${path}`);
      } catch (error) {
        return handleToolError(error);
      }
    },

    async renameFolder(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const newPath = validateVaultPath(params.newPath as string, vaultPath);
        await adapter.renameFile(path, newPath);
        return textResult(`Renamed folder: ${path} → ${newPath}`);
      } catch (error) {
        return handleToolError(error);
      }
    },

    listFolder(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const result = adapter.list(path);
        return Promise.resolve(
          makeResponse(
            result,
            (v) =>
              renderFolderListing(path, v.folders, v.files),
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    listRecursive(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const result = adapter.listRecursive(path);
        const pagination = readPagination(params);
        const filesPage = paginate(result.files, pagination);
        const payload = {
          folders: result.folders,
          ...filesPage,
        };
        const wrapped = makeResponse(
          payload,
          (v) => renderRecursiveListing(path, v.folders, v.items, v.total, v.has_more, v.next_offset),
          readResponseFormat(params),
        );
        const firstBlock = wrapped.content[0];
        const text = firstBlock.type === 'text' ? firstBlock.text : '';
        const truncated = truncateText(text, {
          hint: 'Shrink limit, advance offset, or list a narrower subfolder.',
        });
        return Promise.resolve({
          ...wrapped,
          content: [{ type: 'text' as const, text: truncated.text }],
        });
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    async readBinary(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const data = await adapter.readBinary(path);
        if (data.byteLength > BINARY_BYTE_LIMIT) {
          return errorResult(
            `Binary file too large (${String(data.byteLength)} bytes, limit ${String(BINARY_BYTE_LIMIT)}). Fetch the file out-of-band or use a chunked read when available.`,
          );
        }
        const base64 = Buffer.from(data).toString('base64');
        return textResult(base64);
      } catch (error) {
        return handleToolError(error);
      }
    },

    async writeBinary(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const base64 = params.data as string;
        const buffer = Buffer.from(base64, 'base64');
        return await mutex.acquire(path, async () => {
          await adapter.writeBinary(path, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
          return textResult(`Wrote binary file: ${path}`);
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  };
}
