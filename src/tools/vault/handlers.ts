import { CallToolResult } from '@modelcontextprotocol/server';
// Obsidian re-exports moment at runtime; importing from 'moment' directly
// gives us a properly callable type while still resolving to the same
// bundled instance Obsidian uses (moment is a direct dependency).
import moment from 'moment';
import { ObsidianAdapter } from '../../obsidian/adapter';
import {
  ConfigDirError,
  validateFolderListPath,
  validateToolPath,
  withoutConfigDir,
} from '../../utils/path-guard';
import { sliceTextWindow, windowBody, windowMeta } from '../shared/window';
import {
  handleToolError,
  BinaryTooLargeError,
  fileNotFound,
  withDestinationCheck,
  PluginApiUnavailableError,
  ValidationError,
} from '../shared/errors';
import { fitItems, fitPage, paginate, readPagination } from '../shared/pagination';
import { dataResponse, documentResponse, documentText } from '../shared/response';
import { expandPlaceholders, noteTitle } from '../shared/placeholders';
import { assertSafeFrontmatterKeys } from '../shared/frontmatter';
import { modifiedIso } from '../shared/modified';
import { BINARY_BYTE_LIMIT } from '../../constants';
import { getMimeType, isTextMime, vaultUri } from '../../server/resources';
import type { InferredParams } from '../../registry/types';
import type { SearchHandlers } from '../search/handlers';
import { READ_MAX_LENGTH, parseExpectedMtime } from './schemas';
import {
  findSection,
  formatHeading,
  insertIntoSection,
  sectionText,
  splitLines,
} from './sections';
import { applyReplaceEdits, type ReplaceEdit } from './replace-edits';
import { renameWithLinkReport } from './link-report';
import type {
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
  if (!stat) throw await fileNotFound(adapter, path);
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

/**
 * `vault_append`'s join (#447): when the file is non-empty, does not end
 * with a line ending and `content` does not start with one, put one line
 * ending in between — CRLF if the file uses CRLF, else LF — so appended
 * text starts on a new line instead of being glued onto the last one.
 */
export function appendText(existing: string, content: string): string {
  const needsBreak =
    existing.length > 0 && !existing.endsWith('\n') && !/^\r?\n/.test(content);
  if (!needsBreak) return existing + content;
  return existing + (existing.includes('\r\n') ? '\r\n' : '\n') + content;
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
  params: {
    path: string;
    includeContext?: boolean;
    limit?: number;
    offset?: number;
  },
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

function decorateAspect(inner: CallToolResult, aspect: string, path: string): CallToolResult {
  // Pass error results through unchanged so the underlying handler's
  // message format (`isError: true`, content[0].text="…not found") is
  // preserved exactly. The dispatcher only decorates success payloads.
  if (inner.isError === true) return inner;
  return dataResponse({ aspect, path, ...(inner.structuredContent ?? {}) });
}

/**
 * `vault_daily_note` result for a note that exists (#467): the note text,
 * windowed like `vault_read` so a long note stays under CHARACTER_LIMIT.
 * A `warning` (missing template, #470) is a header line. `modified` is the
 * note's mtime like `vault_read`'s, usable as the next `expectedMtime` (#489).
 */
function dailyNoteResponse(
  path: string,
  created: boolean,
  content: string,
  modified: string,
  warning?: string,
): CallToolResult {
  const w = sliceTextWindow(content, 0, READ_MAX_LENGTH);
  return documentResponse(
    { path, exists: true, created, modified, warning, ...windowMeta(w, content.length) },
    windowBody('vault_read', w, content.length),
  );
}

/**
 * `vault_read_binary` result (#467): an `image` or `audio` content block
 * for those MIME types, so the model can see or hear the file, else the
 * file as an embedded `resource` with a base64 `blob` and its
 * `obsidian://vault/` URI. A short text block names the file; the data is
 * never repeated as text or `structuredContent`.
 */
function binaryResponse(path: string, base64: string, sizeBytes: number): CallToolResult {
  const mimeType = getMimeType(path);
  const kind = binaryContentKind(mimeType);
  const header = {
    type: 'text' as const,
    text: documentText({ path, mimeType, sizeBytes, content: kind }, '').trimEnd(),
  };
  if (kind === 'image' || kind === 'audio') {
    return { content: [header, { type: kind, data: base64, mimeType }] };
  }
  return {
    content: [
      header,
      { type: 'resource', resource: { uri: vaultUri(path), mimeType, blob: base64 } },
    ],
  };
}

/**
 * Content block type for a MIME type: `image` for raster images, `audio`
 * for audio, else `resource`. SVG is text, so it is a resource.
 */
function binaryContentKind(mimeType: string): 'image' | 'audio' | 'resource' {
  if (isTextMime(mimeType)) return 'resource';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'resource';
}

/**
 * The vault path of the configured daily-note template, or `null` when it
 * does not exist. Obsidian stores the template as a link path, usually
 * without `.md`, so a path without an extension is also tried with `.md`.
 */
async function findDailyTemplate(
  adapter: ObsidianAdapter,
  templatePath: string,
): Promise<string | null> {
  const candidates = [templatePath];
  if (!/\.[^/]+$/.test(templatePath)) candidates.push(`${templatePath}.md`);
  for (const candidate of candidates) {
    if (await adapter.exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Body of a new daily note: the configured template, expanded, or empty
 * when none is configured. A configured template that is missing gives an
 * empty body plus a `warning` instead of failing silently (#470).
 */
async function resolveInitialBody(
  adapter: ObsidianAdapter,
  templatePath: string,
  targetMoment: ReturnType<typeof moment>,
  filename: string,
): Promise<{ body: string; warning?: string }> {
  if (!templatePath) return { body: '' };
  const found = await findDailyTemplate(adapter, templatePath);
  if (found === null) {
    return {
      body: '',
      warning: `Template ${templatePath} (Daily notes settings) not found; created an empty note.`,
    };
  }
  const templateBody = await adapter.readFile(found);
  // Templater syntax: never expanded here — Templater can run arbitrary
  // user JS, so execution stays client-side (mirrors plugin_templater_*).
  if (templateBody.includes('<%')) return { body: templateBody };
  // Date placeholders use the note's date, time placeholders the current
  // time of day on that date (#488), like Obsidian's Daily notes plugin.
  const current = moment();
  const reference = targetMoment.clone().set({
    hour: current.hour(),
    minute: current.minute(),
    second: current.second(),
    millisecond: current.millisecond(),
  });
  return {
    body: expandPlaceholders(templateBody, {}, {
      now: reference.toDate(),
      title: noteTitle(filename),
    }),
  };
}

/**
 * Check a vault_set_frontmatter request before touching the file: at least
 * one key to change, no key both set and removed, no prototype keys.
 */
function validateFrontmatterChange(setKeys: string[], removeKeys: string[]): void {
  if (setKeys.length === 0 && removeKeys.length === 0) {
    throw new Error('Nothing to change: pass at least one key in set or remove');
  }
  assertSafeFrontmatterKeys([...setKeys, ...removeKeys]);
  const both = setKeys.filter((key) => removeKeys.includes(key));
  if (both.length > 0) {
    throw new Error(`Keys cannot be both set and removed: ${both.join(', ')}`);
  }
}

const RENAME_TARGET_PATTERN =/^[^/\\\x00]+$/;

/**
 * The files a rename of `path` moves, for counting the links to them: every
 * file inside a folder (recursively), or the file itself. A path that is
 * not a folder counts as one file; the rename itself then reports any
 * error. Shared by vault_rename and vault_move, which both accept files
 * and folders (#447).
 */
function movedFiles(adapter: ObsidianAdapter, path: string): string[] {
  try {
    return adapter.listRecursive(path).files;
  } catch {
    return [path];
  }
}

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
  insert: (params: InferredParams<typeof insertSchema>) => Promise<CallToolResult>;
  renameFile: (params: InferredParams<typeof renameFileSchema>) => Promise<CallToolResult>;
  moveFile: (params: InferredParams<typeof moveFileSchema>) => Promise<CallToolResult>;
  copyFile: (params: InferredParams<typeof copyFileSchema>) => Promise<CallToolResult>;
  getMetadata: (params: InferredParams<typeof getMetadataSchema>) => Promise<CallToolResult>;
  createFolder: (params: InferredParams<typeof createFolderSchema>) => Promise<CallToolResult>;
  deleteFolder: (params: InferredParams<typeof deleteFolderSchema>) => Promise<CallToolResult>;
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
  const configDir = adapter.getConfigDir();

  /**
   * `vault_replace`'s multi-edit form (#429): one mtime check, then every
   * edit is validated and applied inside a single `processFile` call, so a
   * failing edit writes nothing.
   */
  async function replaceEdits(
    path: string,
    edits: readonly ReplaceEdit[],
    expectedMtime: string | undefined,
  ): Promise<CallToolResult> {
    return await mutex.acquire(path, async () => {
      await assertExpectedMtime(adapter, path, expectedMtime);
      let perEdit: number[] = [];
      await adapter.processFile(path, (content) => {
        const applied = applyReplaceEdits(content, edits, path);
        perEdit = applied.replacements;
        return applied.content;
      });
      const modified = await modifiedIso(adapter, path);
      const replacements = perEdit.reduce((sum, count) => sum + count, 0);
      return dataResponse({
        path,
        replacements,
        edits: perEdit.map((count, index) => ({ index, replacements: count })),
        modified,
      });
    });
  }

  return {
    async createFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        return await mutex.acquire(path, async () => {
          await adapter.createFile(path, params.content);
          const modified = await modifiedIso(adapter, path);
          return dataResponse({ path, created: true, modified });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async readFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const fileContent = await adapter.readFile(path);
        const modified = await modifiedIso(adapter, path);
        let fullContent = fileContent;
        let sectionFields: { heading: string; line: number } | Record<string, never> = {};
        if (params.heading !== undefined) {
          const section = findSection(splitLines(fileContent), params.heading, path);
          fullContent = sectionText(fileContent, section);
          sectionFields = {
            heading: formatHeading(section.heading),
            line: section.start + 1,
          };
        }
        const w = sliceTextWindow(fullContent, params.offset ?? 0, params.length ?? READ_MAX_LENGTH);
        // The window plus header and footer fits in CHARACTER_LIMIT; the
        // dispatcher's cap is only a safety net.
        return documentResponse(
          { path, ...sectionFields, modified, ...windowMeta(w, fullContent.length) },
          windowBody('vault_read', w, fullContent.length),
        );
      } catch (error) {
        return handleToolError(error);
      }
    },

    async updateFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          await adapter.modifyFile(path, params.content);
          const modified = await modifiedIso(adapter, path);
          return dataResponse({ path, updated: true, modified });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async deleteFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        return await mutex.acquire(path, async () => {
          const trashedTo = adapter.getTrashDestination();
          await adapter.deleteFile(path);
          return dataResponse({
            path,
            deleted: true,
            trashedTo,
          });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async appendFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          await adapter.processFile(path, (existing) => appendText(existing, params.content));
          const modified = await modifiedIso(adapter, path);
          return dataResponse({
            path,
            appended: true,
            modified,
          });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async replaceInFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const { oldString, newString, edits } = params;
        const replaceAll = params.replaceAll ?? false;
        if (edits !== undefined) {
          if (oldString !== undefined || newString !== undefined) {
            throw new ValidationError(
              'Pass either oldString/newString or edits, not both. Nothing was written.',
            );
          }
          if (replaceAll) {
            throw new ValidationError(
              'replaceAll belongs to the single-edit form; with edits, set replaceAll on each edit. ' +
                'Nothing was written.',
            );
          }
          return await replaceEdits(path, edits, params.expectedMtime);
        }
        if (oldString === undefined || newString === undefined) {
          throw new ValidationError(
            oldString === undefined && newString === undefined
              ? 'Pass oldString and newString, or edits. Nothing was written.'
              : 'oldString and newString must be given together. Nothing was written.',
          );
        }
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
          return dataResponse({ path, replacements, modified });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async insert(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const position = params.position ?? 'end';
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          let heading = '';
          let line = 0;
          // Resolving the section inside vault.process keeps the
          // read-modify-write atomic; throwing here writes nothing.
          await adapter.processFile(path, (content) => {
            const lines = splitLines(content);
            const section = findSection(lines, params.heading, path, ' Nothing was written.');
            const result = insertIntoSection(content, lines, section, position, params.text);
            heading = formatHeading(section.heading);
            line = result.line + 1;
            return result.content;
          });
          const modified = await modifiedIso(adapter, path);
          return dataResponse({ path, heading, position, line, modified });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async getMetadata(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const stat = await adapter.stat(path);
        if (!stat) throw await fileNotFound(adapter, path);
        return dataResponse({
          path,
          size: stat.size,
          created: new Date(stat.ctime).toISOString(),
          modified: new Date(stat.mtime).toISOString(),
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async renameFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        if (!isValidRenameTarget(params.newName)) {
          return errorResult('Invalid rename target');
        }
        const parts = path.split('/');
        parts[parts.length - 1] = params.newName;
        const newPath = parts.join('/');
        try {
          validateToolPath(newPath, vaultPath, configDir);
        } catch (error) {
          if (error instanceof ConfigDirError) throw error;
          return errorResult('Invalid rename target');
        }
        return await mutex.acquire(path, async () => {
          const report = await renameWithLinkReport(adapter, path, newPath, movedFiles(adapter, path));
          return dataResponse({ from: path, to: newPath, ...report });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async moveFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const newPath = validateToolPath(params.newPath, vaultPath, configDir);
        return await mutex.acquire(path, async () => {
          const report = await renameWithLinkReport(adapter, path, newPath, movedFiles(adapter, path));
          return dataResponse({ from: path, to: newPath, ...report });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async copyFile(params): Promise<CallToolResult> {
      try {
        const sourcePath = validateToolPath(params.sourcePath, vaultPath, configDir);
        const destPath = validateToolPath(params.destPath, vaultPath, configDir);
        await withDestinationCheck(destPath, () => adapter.copyFile(sourcePath, destPath));
        return dataResponse({
          from: sourcePath,
          to: destPath,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async createFolder(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        await adapter.createFolder(path);
        return dataResponse({ path, created: true });
      } catch (error) {
        return handleToolError(error);
      }
    },

    async deleteFolder(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const trashedTo = adapter.getTrashDestination();
        await adapter.deleteFolder(path, params.recursive ?? false);
        return dataResponse({
          path,
          deleted: true,
          recursive: params.recursive ?? false,
          trashedTo,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },

    listFolder(params): Promise<CallToolResult> {
      try {
        const path = validateFolderListPath(params.path, vaultPath, configDir);
        const listing = withoutConfigDir(adapter.list(path), configDir);
        // Folders first, then files, paged as one list (#464).
        const entries = [
          ...listing.folders.map((p) => ({ path: p, folder: true })),
          ...listing.files.map((p) => ({ path: p, folder: false })),
        ];
        const page = paginate(entries, readPagination(params));
        return Promise.resolve(
          fitPage(page, (p) => {
            const { items, ...paging } = p;
            return dataResponse({
              files: items.filter((e) => !e.folder).map((e) => e.path),
              folders: items.filter((e) => e.folder).map((e) => e.path),
              ...paging,
            });
          }),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    listRecursive(params): Promise<CallToolResult> {
      try {
        const path = validateFolderListPath(params.path, vaultPath, configDir);
        const result = withoutConfigDir(adapter.listRecursive(path), configDir);
        const { limit, offset } = readPagination(params);
        // Files and folders share one window (#464): the page holds
        // files[offset, offset + n) and folders[offset, offset + n).
        const longest = Math.max(result.files.length, result.folders.length);
        const window = Math.max(0, Math.min(limit, longest - offset));
        return Promise.resolve(
          fitItems(window, (n) => {
            const end = offset + n;
            const items = result.files.slice(offset, end);
            const hasMore = end < longest;
            return dataResponse({
              folders: result.folders.slice(offset, end),
              folderTotal: result.folders.length,
              total: result.files.length,
              count: items.length,
              offset,
              items,
              hasMore,
              ...(hasMore ? { nextOffset: end } : {}),
            });
          }),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    async readBinary(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const data = await adapter.readBinary(path);
        if (data.byteLength > BINARY_BYTE_LIMIT) {
          throw new BinaryTooLargeError(data.byteLength, BINARY_BYTE_LIMIT);
        }
        return binaryResponse(path, Buffer.from(data).toString('base64'), data.byteLength);
      } catch (error) {
        return handleToolError(error);
      }
    },

    async writeBinary(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const buffer = Buffer.from(params.data, 'base64');
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
          await adapter.writeBinary(
            path,
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          );
          const modified = await modifiedIso(adapter, path);
          return dataResponse({
            path,
            sizeBytes: buffer.byteLength,
            modified,
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
        return decorateAspect(inner, aspect, path);
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
        const path = validateToolPath(rawPath, vaultPath, configDir);

        const exists = await adapter.exists(path);
        if (exists) {
          const content = await adapter.readFile(path);
          const modified = await modifiedIso(adapter, path);
          return dailyNoteResponse(path, false, content, modified);
        }
        // Lookup by default (#432): only create when explicitly asked.
        if (params.create !== true) {
          // The note may live elsewhere (older layout, changed settings),
          // so point to a search rather than a create (#514).
          const name = filenameBase.slice(filenameBase.lastIndexOf('/') + 1);
          return documentResponse(
            { path, exists: false, created: false },
            `No note at ${path} (path from the Daily notes settings). ` +
              `It may exist elsewhere: check with search_by_name { query: ${JSON.stringify(name)} } before create=true.`,
          );
        }
        const { body, warning } = await resolveInitialBody(
          adapter,
          settings.template,
          targetMoment,
          filename,
        );
        await adapter.createFile(path, body);
        const modified = await modifiedIso(adapter, path);
        return dailyNoteResponse(path, true, body, modified, warning);
      } catch (error) {
        return handleToolError(error);
      }
    },

    async setFrontmatter(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        if (!path.toLowerCase().endsWith('.md')) {
          throw new Error('Frontmatter can only be set on Markdown (.md) files');
        }
        const set = params.set;
        const remove = params.remove ?? [];
        const setKeys = Object.keys(set);
        validateFrontmatterChange(setKeys, remove);
        return await mutex.acquire(path, async () => {
          await assertExpectedMtime(adapter, path, params.expectedMtime);
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
          const modified = await modifiedIso(adapter, path);
          return dataResponse({ path, frontmatter, modified });
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  };
}
