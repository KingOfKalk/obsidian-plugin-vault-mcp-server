import { CallToolResult } from '@modelcontextprotocol/server';
// Obsidian re-exports moment at runtime; importing from 'moment' directly
// gives us a properly callable type while still resolving to the same
// bundled instance Obsidian uses (moment is a direct dependency).
import moment from 'moment';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateFolderListPath, validateVaultPath } from '../../utils/path-guard';
import { truncateText } from '../shared/truncate';
import {
  handleToolError,
  BinaryTooLargeError,
  FileNotFoundError,
  PluginApiUnavailableError,
  ValidationError,
} from '../shared/errors';
import { paginate, readPagination } from '../shared/pagination';
import { confirmWithStructured, makeResponse, readResponseFormat } from '../shared/response';
import { expandPlaceholders } from '../shared/placeholders';
import { BINARY_BYTE_LIMIT } from '../../constants';
import type { InferredParams } from '../../registry/types';
import type { SearchHandlers } from '../search/handlers';
import { READ_MAX_LENGTH, parseExpectedMtime } from './schemas';
import type {
  createFileSchema,
  readFileSchema,
  updateFileSchema,
  deleteFileSchema,
  appendFileSchema,
  replaceInFileSchema,
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

/**
 * The file changed after the agent read it: its mtime no longer matches
 * the `expectedMtime` the caller sent (#406). Nothing is written.
 */
export class MtimeConflictError extends Error {
  constructor(path: string, expectedMs: number, currentMs: number) {
    const current = new Date(currentMs).toISOString();
    super(
      `File changed since expectedMtime: ${path} was last modified at ${current} ` +
        `(mtime ${String(currentMs)}), expected ${new Date(expectedMs).toISOString()}. ` +
        'Nothing was written. Re-read the file, then retry with ' +
        `expectedMtime: "${current}".`,
    );
    this.name = 'MtimeConflictError';
  }
}

/**
 * Throw unless the file's current mtime equals `expectedMtime`. A no-op
 * when `expectedMtime` is omitted. Compares whole milliseconds, the
 * precision of the ISO-8601 `modified` value agents round-trip.
 */
async function assertExpectedMtime(
  adapter: ObsidianAdapter,
  path: string,
  expectedMtime: string | undefined,
): Promise<void> {
  if (expectedMtime === undefined) return;
  const expectedMs = Math.trunc(parseExpectedMtime(expectedMtime));
  const stat = await adapter.stat(path);
  if (!stat) throw new FileNotFoundError(path);
  const currentMs = Math.trunc(stat.mtime);
  if (currentMs !== expectedMs) {
    throw new MtimeConflictError(path, expectedMs, currentMs);
  }
}

/** Count non-overlapping occurrences of `needle` (non-empty) in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** The file's mtime as an ISO-8601 string, or throw when it is gone. */
async function modifiedIso(adapter: ObsidianAdapter, path: string): Promise<string> {
  const stat = await adapter.stat(path);
  if (!stat) throw new FileNotFoundError(path);
  return new Date(stat.mtime).toISOString();
}

function errorResult(message: string): CallToolResult {
  return handleToolError(new Error(message));
}

async function dispatchAspect(
  searchHandlers: SearchHandlers,
  aspect:
    | 'frontmatter'
    | 'headings'
    | 'outgoing_links'
    | 'embeds'
    | 'backlinks'
    | 'block_references',
  params: { path: string; responseFormat?: 'markdown' | 'json' },
): Promise<CallToolResult> {
  switch (aspect) {
    case 'frontmatter':
      return searchHandlers.searchFrontmatter(params);
    case 'headings':
      return searchHandlers.searchHeadings(params);
    case 'outgoing_links':
      return searchHandlers.searchOutgoingLinks(params);
    case 'embeds':
      return searchHandlers.searchEmbeds(params);
    case 'backlinks':
      return searchHandlers.searchBacklinks(params);
    case 'block_references':
      return searchHandlers.searchBlockReferences(params);
  }
}

function decorateAspect(
  inner: CallToolResult,
  aspect: string,
  path: string,
  format: 'markdown' | 'json',
): CallToolResult {
  // Pass error results through unchanged so the underlying handler's
  // message format (`isError: true`, content[0].text="…not found") is
  // preserved exactly. The dispatcher only decorates success payloads.
  if (inner.isError === true) return inner;

  const decoratedStructured = {
    aspect,
    path,
    ...(inner.structuredContent ?? {}),
  };

  // For JSON output the rendered text mirrors the structured payload;
  // re-stringify so `aspect` shows up there too.
  // For markdown output, leave the rendered text as the underlying
  // handler produced it — the discriminator is implicit in the heading
  // each renderer already emits (e.g. "**path** frontmatter:").
  if (format === 'json') {
    return {
      ...inner,
      content: [{ type: 'text' as const, text: JSON.stringify(decoratedStructured, null, 2) }],
      structuredContent: decoratedStructured,
    };
  }
  return { ...inner, structuredContent: decoratedStructured };
}

/** Label used in rendered listings; the vault root ("") shows as "/". */
function displayFolder(path: string): string {
  return path === '' ? '/' : path;
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

async function resolveInitialBody(
  adapter: ObsidianAdapter,
  templatePath: string,
  targetMoment: ReturnType<typeof moment>,
  filename: string,
): Promise<string> {
  if (!templatePath) return '';
  let templateBody: string;
  try {
    templateBody = await adapter.readFile(templatePath);
  } catch {
    // Configured template missing/moved — create empty rather than fail.
    // (The original spec called for a warn-log here, but vault handlers do
    // not currently take a logger and threading one through is out of
    // scope for #304. Falling back silently matches existing patterns
    // like template_list error swallowing in #272.)
    return '';
  }
  // Templater syntax: never expanded here — Templater can run arbitrary
  // user JS, so execution stays client-side (mirrors plugin_templater_*).
  if (templateBody.includes('<%')) return templateBody;
  const title = filename.replace(/\.md$/, '');
  return expandPlaceholders(
    templateBody,
    {
      date: targetMoment.format('YYYY-MM-DD'),
      time: targetMoment.format('HH:mm'),
      title,
    },
    targetMoment.toDate(),
  );
}

/**
 * Cut the [offset, offset + length) window out of a file for vault_read
 * paging. Never ends a window between the two halves of a surrogate pair,
 * so a multi-chunk read reassembles to the exact original text.
 */
function sliceReadWindow(
  content: string,
  offset: number,
  length: number,
): { content: string; offset: number; end: number; hasMore: boolean } {
  const start = Math.min(Math.max(0, offset), content.length);
  let end = Math.min(start + Math.max(1, length), content.length);
  if (end < content.length && end > start + 1) {
    const code = content.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return {
    content: content.slice(start, end),
    offset: start,
    end,
    hasMore: end < content.length,
  };
}

/** Keys that would reach Object.prototype when assigned on a plain object. */
const FORBIDDEN_FRONTMATTER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Check a vault_set_frontmatter request before touching the file: at least
 * one key to change, no key both set and removed, no prototype keys.
 */
function validateFrontmatterChange(setKeys: string[], removeKeys: string[]): void {
  if (setKeys.length === 0 && removeKeys.length === 0) {
    throw new Error('Nothing to change: pass at least one key in set or remove');
  }
  for (const key of [...setKeys, ...removeKeys]) {
    if (FORBIDDEN_FRONTMATTER_KEYS.has(key)) {
      throw new Error(`Invalid frontmatter key: ${key}`);
    }
  }
  const both = setKeys.filter((key) => removeKeys.includes(key));
  if (both.length > 0) {
    throw new Error(`Keys cannot be both set and removed: ${both.join(', ')}`);
  }
}

const RENAME_TARGET_PATTERN =/^[^/\\\x00]+$/;

function isValidRenameTarget(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    value.trim().length > 0 &&
    RENAME_TARGET_PATTERN.test(value)
  );
}

export interface VaultHandlers {
  createFile: (params: InferredParams<typeof createFileSchema>) => Promise<CallToolResult>;
  readFile: (params: InferredParams<typeof readFileSchema>) => Promise<CallToolResult>;
  updateFile: (params: InferredParams<typeof updateFileSchema>) => Promise<CallToolResult>;
  deleteFile: (params: InferredParams<typeof deleteFileSchema>) => Promise<CallToolResult>;
  appendFile: (params: InferredParams<typeof appendFileSchema>) => Promise<CallToolResult>;
  replaceInFile: (params: InferredParams<typeof replaceInFileSchema>) => Promise<CallToolResult>;
  renameFile: (params: InferredParams<typeof renameFileSchema>) => Promise<CallToolResult>;
  moveFile: (params: InferredParams<typeof moveFileSchema>) => Promise<CallToolResult>;
  copyFile: (params: InferredParams<typeof copyFileSchema>) => Promise<CallToolResult>;
  getMetadata: (params: InferredParams<typeof getMetadataSchema>) => Promise<CallToolResult>;
  createFolder: (params: InferredParams<typeof createFolderSchema>) => Promise<CallToolResult>;
  deleteFolder: (params: InferredParams<typeof deleteFolderSchema>) => Promise<CallToolResult>;
  renameFolder: (params: InferredParams<typeof renameFolderSchema>) => Promise<CallToolResult>;
  listFolder: (params: InferredParams<typeof listFolderSchema>) => Promise<CallToolResult>;
  listRecursive: (params: InferredParams<typeof listRecursiveSchema>) => Promise<CallToolResult>;
  readBinary: (params: InferredParams<typeof readBinarySchema>) => Promise<CallToolResult>;
  writeBinary: (params: InferredParams<typeof writeBinarySchema>) => Promise<CallToolResult>;
  getAspect: (params: InferredParams<typeof getAspectSchema>) => Promise<CallToolResult>;
  dailyNote: (params: InferredParams<typeof dailyNoteSchema>) => Promise<CallToolResult>;
  setFrontmatter: (params: InferredParams<typeof setFrontmatterSchema>) => Promise<CallToolResult>;
}

export function createHandlers(
  adapter: ObsidianAdapter,
  mutex: WriteMutex,
  searchHandlers: SearchHandlers,
): VaultHandlers {
  const vaultPath = adapter.getVaultPath();

  return {
    async createFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        return await mutex.acquire(path, async () => {
          await adapter.createFile(path, params.content);
          return confirmWithStructured(`Created file: ${path}`, { path, created: true });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async readFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const fullContent = await adapter.readFile(path);
        const modified = await modifiedIso(adapter, path);
        const window = sliceReadWindow(
          fullContent,
          params.offset ?? 0,
          params.length ?? READ_MAX_LENGTH,
        );
        const payload = {
          path,
          content: window.content,
          totalLength: fullContent.length,
          offset: window.offset,
          hasMore: window.hasMore,
          ...(window.hasMore ? { nextOffset: window.end } : {}),
          modified,
        };
        const result = makeResponse(
          payload,
          (v) =>
            v.hasMore
              ? `${v.content}\n\n[TRUNCATED: Showing characters ${String(v.offset)}-${String(window.end)} of ${String(v.totalLength)}. Call vault_read again with offset=${String(window.end)} to continue.]`
              : v.content,
          readResponseFormat(params),
        );
        const firstBlock = result.content[0];
        const text = firstBlock.type === 'text' ? firstBlock.text : '';
        // Safety net for the JSON rendering, whose escaping can push a
        // full-size window past the limit.
        const truncated = truncateText(text, {
          hint: 'Call vault_read with a smaller length, or continue with offset.',
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
        const path = validateVaultPath(params.path, vaultPath);
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          await adapter.modifyFile(path, params.content);
          return confirmWithStructured(`Updated file: ${path}`, { path, updated: true });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async deleteFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        return await mutex.acquire(path, async () => {
          await adapter.deleteFile(path);
          return confirmWithStructured(`Deleted file: ${path}`, { path, deleted: true });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async appendFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          const existing = await adapter.readFile(path);
          await adapter.modifyFile(path, existing + params.content);
          return confirmWithStructured(`Appended to file: ${path}`, { path, appended: true });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async replaceInFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const { oldString, newString } = params;
        const replaceAll = params.replaceAll ?? false;
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          let replacements = 0;
          // Matching runs inside vault.process so the read-modify-write is
          // atomic with respect to Obsidian; throwing here writes nothing.
          await adapter.processFile(path, (content) => {
            const count = countOccurrences(content, oldString);
            if (count === 0) {
              throw new ValidationError(
                `oldString not found in ${path} (0 matches). Nothing was written.`,
              );
            }
            if (count > 1 && !replaceAll) {
              throw new ValidationError(
                `oldString is ambiguous in ${path} (${String(count)} matches). ` +
                  'Include more surrounding text so it matches exactly once, or set replaceAll: true. ' +
                  'Nothing was written.',
              );
            }
            replacements = replaceAll ? count : 1;
            return replaceAll
              ? content.split(oldString).join(newString)
              : content.replace(oldString, () => newString);
          });
          const modified = await modifiedIso(adapter, path);
          const noun = replacements === 1 ? 'occurrence' : 'occurrences';
          return confirmWithStructured(
            `Replaced ${String(replacements)} ${noun} in ${path}`,
            { path, replacements, modified },
          );
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async getMetadata(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
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
        const path = validateVaultPath(params.path, vaultPath);
        if (!isValidRenameTarget(params.newName)) {
          return errorResult('Invalid rename target');
        }
        const parts = path.split('/');
        parts[parts.length - 1] = params.newName;
        const newPath = parts.join('/');
        try {
          validateVaultPath(newPath, vaultPath);
        } catch {
          return errorResult('Invalid rename target');
        }
        return await mutex.acquire(path, async () => {
          await adapter.renameFile(path, newPath);
          return confirmWithStructured(`Renamed file: ${path} → ${newPath}`, { from: path, to: newPath });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async moveFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const newPath = validateVaultPath(params.newPath, vaultPath);
        return await mutex.acquire(path, async () => {
          await adapter.renameFile(path, newPath);
          return confirmWithStructured(`Moved file: ${path} → ${newPath}`, { from: path, to: newPath });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async copyFile(params): Promise<CallToolResult> {
      try {
        const sourcePath = validateVaultPath(params.sourcePath, vaultPath);
        const destPath = validateVaultPath(params.destPath, vaultPath);
        await adapter.copyFile(sourcePath, destPath);
        return confirmWithStructured(`Copied file: ${sourcePath} → ${destPath}`, {
          from: sourcePath,
          to: destPath,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async createFolder(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        await adapter.createFolder(path);
        return confirmWithStructured(`Created folder: ${path}`, { path, created: true });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async deleteFolder(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        await adapter.deleteFolder(path, params.recursive ?? false);
        return confirmWithStructured(`Deleted folder: ${path}`, {
          path,
          deleted: true,
          recursive: params.recursive ?? false,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async renameFolder(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const newPath = validateVaultPath(params.newPath, vaultPath);
        await adapter.renameFile(path, newPath);
        return confirmWithStructured(`Renamed folder: ${path} → ${newPath}`, {
          from: path,
          to: newPath,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    listFolder(params): Promise<CallToolResult> {
      try {
        const path = validateFolderListPath(params.path, vaultPath);
        const result = adapter.list(path);
        return Promise.resolve(
          makeResponse(
            result,
            (v) => renderFolderListing(displayFolder(path), v.folders, v.files),
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    listRecursive(params): Promise<CallToolResult> {
      try {
        const path = validateFolderListPath(params.path, vaultPath);
        const result = adapter.listRecursive(path);
        const pagination = readPagination(params);
        const filesPage = paginate(result.files, pagination);
        const payload = {
          folders: result.folders,
          ...filesPage,
        };
        const wrapped = makeResponse(
          payload,
          (v) =>
            renderRecursiveListing(
              displayFolder(path),
              v.folders,
              v.items,
              v.total,
              v.hasMore,
              v.nextOffset,
            ),
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
        const path = validateVaultPath(params.path, vaultPath);
        const data = await adapter.readBinary(path);
        if (data.byteLength > BINARY_BYTE_LIMIT) {
          throw new BinaryTooLargeError(data.byteLength, BINARY_BYTE_LIMIT);
        }
        const base64 = Buffer.from(data).toString('base64');
        return makeResponse(
          {
            path,
            data: base64,
            encoding: 'base64' as const,
            sizeBytes: data.byteLength,
          },
          (v) => v.data,
          readResponseFormat(params),
        );
      } catch (error) {
        return handleToolError(error);
      }
    },

    async writeBinary(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const buffer = Buffer.from(params.data, 'base64');
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          await adapter.writeBinary(
            path,
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          );
          return confirmWithStructured(`Wrote binary file: ${path}`, {
            path,
            sizeBytes: buffer.byteLength,
          });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async getAspect(params): Promise<CallToolResult> {
      try {
        const { aspect, path } = params;
        const inner = await dispatchAspect(searchHandlers, aspect, params);
        return decorateAspect(inner, aspect, path, readResponseFormat(params));
      } catch (error) {
        return handleToolError(error);
      }
    },

    async dailyNote(params): Promise<CallToolResult> {
      try {
        const settings = adapter.getDailyNotesSettings();
        if (settings === null) {
          throw new PluginApiUnavailableError(
            'daily-notes',
            'core plugin is disabled — enable it in Obsidian Settings → Core plugins',
          );
        }
        const targetMoment = params.date !== undefined
          ? moment(params.date, 'YYYY-MM-DD', true)
          : moment();
        if (!targetMoment.isValid()) {
          throw new Error('date must be a valid calendar date (YYYY-MM-DD)');
        }
        const filenameBase = targetMoment.format(settings.format);
        const filename = `${filenameBase}.md`;
        const rawPath = settings.folder
          ? `${settings.folder.replace(/\/+$/, '')}/${filename}`
          : filename;
        const path = validateVaultPath(rawPath, vaultPath);

        const exists = await adapter.exists(path);
        if (exists) {
          const content = await adapter.readFile(path);
          return makeResponse(
            { path, created: false, content },
            (v) => `${v.path} (existing)\n\n${v.content}`,
            readResponseFormat(params),
          );
        }
        const body = await resolveInitialBody(adapter, settings.template, targetMoment, filename);
        await adapter.createFile(path, body);
        return makeResponse(
          { path, created: true, content: body },
          (v) => `${v.path} (created)\n\n${v.content}`,
          readResponseFormat(params),
        );
      } catch (error) {
        return handleToolError(error);
      }
    },

    async setFrontmatter(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        if (!path.toLowerCase().endsWith('.md')) {
          throw new Error('Frontmatter can only be set on Markdown (.md) files');
        }
        const set = params.set;
        const remove = params.remove ?? [];
        const setKeys = Object.keys(set);
        validateFrontmatterChange(setKeys, remove);
        return await mutex.acquire(path, async () => {
          let frontmatter: Record<string, unknown> = {};
          await adapter.processFrontMatter(path, (fm) => {
            for (const key of setKeys) {
              fm[key] = set[key];
            }
            for (const key of remove) {
              delete fm[key];
            }
            // Snapshot as plain JSON so the result is serialisable even if
            // Obsidian hands back richer YAML values.
            frontmatter = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
          });
          const parts: string[] = [];
          if (setKeys.length > 0) parts.push(`set ${setKeys.join(', ')}`);
          if (remove.length > 0) parts.push(`removed ${remove.join(', ')}`);
          return confirmWithStructured(
            `Updated frontmatter of ${path} (${parts.join('; ')})`,
            { path, frontmatter },
          );
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  };
}
