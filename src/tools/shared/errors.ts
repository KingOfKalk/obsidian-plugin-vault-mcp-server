import { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PathTraversalError } from '../../utils/path-guard';
import type { ObsidianAdapter } from '../../obsidian/adapter';

/**
 * Typed error classes the adapter / handlers can throw to signal a particular
 * failure category. The shared `handleToolError()` helper maps each class to
 * a consistent MCP error response shape.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * The vault path resolves to nothing — there is no file or folder there.
 * Use `FolderNotFoundError` / `FileNotFoundError` when the type is known.
 */
export class FolderNotFoundError extends NotFoundError {
  constructor(path: string) {
    super(`Folder not found: ${path}`);
    this.name = 'FolderNotFoundError';
  }
}

/**
 * No file at `path`. `suggestion` is an existing path the caller probably
 * meant (see `markdownCandidate`); it is appended as "Did you mean …?" (#463).
 */
export class FileNotFoundError extends NotFoundError {
  constructor(path: string, suggestion?: string) {
    super(
      suggestion === undefined
        ? `File not found: ${path}`
        : `File not found: ${path}. Did you mean ${suggestion}?`,
    );
    this.name = 'FileNotFoundError';
  }
}

/**
 * The path with `.md` appended, for a "Did you mean" hint: wikilinks drop
 * the extension, so `projects/Atlas` usually means `projects/Atlas.md`.
 * `null` when the path already ends in `.md` or is empty (#463).
 */
export function markdownCandidate(path: string): string | null {
  if (path === '' || path.endsWith('/') || /\.md$/i.test(path)) return null;
  return `${path}.md`;
}

/**
 * `FileNotFoundError` for `path`, with a "Did you mean" hint when
 * `path + ".md"` exists. For callers that found the file missing through
 * `adapter.stat` rather than an adapter method that throws.
 */
export async function fileNotFound(
  adapter: ObsidianAdapter,
  path: string,
): Promise<FileNotFoundError> {
  const candidate = markdownCandidate(path);
  const exists = candidate !== null && (await adapter.stat(candidate)) !== null;
  return new FileNotFoundError(path, exists ? candidate : undefined);
}

/**
 * Rename, move or copy onto a path that is taken. Replaces Obsidian's raw
 * "Destination file already exists!" and the filesystem's "EEXIST: …",
 * which name neither the path nor a next step (#463).
 */
export class DestinationExistsError extends Error {
  constructor(public readonly path: string) {
    super(`Destination already exists: ${path}. Choose another path or delete it first; nothing was changed.`);
    this.name = 'DestinationExistsError';
  }
}

/**
 * Whether `error` is Obsidian's or the filesystem's "destination exists"
 * failure from `vault.rename`, `fileManager.renameFile` or `vault.copy`.
 */
export function isDestinationExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Destination file already exists') || /\bEEXIST\b/.test(message);
}

/**
 * Run a rename / move / copy and turn a "destination exists" failure into
 * `DestinationExistsError` for `dest`; other errors pass through.
 */
export async function withDestinationCheck<T>(dest: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isDestinationExistsError(error)) throw new DestinationExistsError(dest);
    throw error;
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * The requested binary file exceeds the configured per-call byte limit.
 * Used by `vault_read_binary` and the resources surface to fail fast on
 * over-cap files instead of base64-encoding hundreds of megabytes.
 */
export class BinaryTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly limitBytes: number,
  ) {
    super(
      `Binary file too large (${String(sizeBytes)} bytes, limit ${String(limitBytes)}). Fetch the file out-of-band or use a chunked read when available.`,
    );
    this.name = 'BinaryTooLargeError';
  }
}

/**
 * The user-requested third-party plugin (e.g. Dataview, Templater) is
 * not installed or is currently disabled in Obsidian.
 */
export class PluginNotInstalledError extends Error {
  constructor(pluginId: string) {
    super(`Plugin not installed or disabled: ${pluginId}`);
    this.name = 'PluginNotInstalledError';
  }
}

/**
 * The third-party plugin is enabled but does not currently expose the
 * API surface we need (typically because it is mid-load or its API
 * changed in a newer version).
 */
export class PluginApiUnavailableError extends Error {
  constructor(pluginId: string, reason?: string) {
    super(
      reason
        ? `Plugin API unavailable for ${pluginId}: ${reason}`
        : `Plugin API unavailable for ${pluginId}`,
    );
    this.name = 'PluginApiUnavailableError';
  }
}

/**
 * Map any caught value to a well-formed CallToolResult with `isError: true`.
 * Callers can use this as a single `catch` target so they don't need to
 * maintain their own per-module `errorResult()` helper.
 */
export function handleToolError(error: unknown): CallToolResult {
  if (error instanceof z.ZodError) {
    const details = error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    return errorFrom(`Invalid arguments: ${details}`);
  }
  if (error instanceof PathTraversalError) {
    return errorFrom(error.message);
  }
  if (error instanceof NotFoundError) {
    return errorFrom(error.message);
  }
  if (error instanceof PermissionError) {
    return errorFrom(`Permission denied: ${error.message}`);
  }
  if (error instanceof ValidationError) {
    return errorFrom(error.message);
  }
  if (error instanceof TimeoutError) {
    return errorFrom(`Operation timed out: ${error.message}`);
  }
  if (error instanceof PluginNotInstalledError) {
    return errorFrom(error.message);
  }
  if (error instanceof PluginApiUnavailableError) {
    return errorFrom(error.message);
  }
  if (error instanceof BinaryTooLargeError) {
    return errorFrom(error.message);
  }
  if (error instanceof DestinationExistsError) {
    return errorFrom(error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorFrom(redactFilesystemPaths(message));
}

/**
 * Absolute vault base paths registered by the plugin at startup. Errors
 * from the filesystem (e.g. a raw ENOENT) embed them; the generic
 * fallback of `handleToolError` turns them back into vault-relative
 * paths so the absolute location of the vault never reaches a client
 * (#405).
 */
const vaultBasePaths = new Set<string>();

export function registerVaultBasePath(basePath: string): void {
  const trimmed = basePath.replace(/[\\/]+$/, '');
  if (trimmed.length > 0) vaultBasePaths.add(trimmed);
}

/** Test hook: forget every registered base path. */
export function clearVaultBasePaths(): void {
  vaultBasePaths.clear();
}

/**
 * Absolute filesystem path with at least one directory segment, on POSIX
 * (`/home/x/...`), Windows (`C:\Users\...`, `C:/...`) or UNC
 * (`\\server\share`). It must start the message or follow whitespace,
 * a quote, a bracket, `=`, `:` or `,` so vault-relative paths such as
 * `notes/a.md` are left alone.
 */
const ABSOLUTE_PATH_PATTERN =
  /(?<=^|[\s'"`([{=:,])(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s'"`\\/]+[\\/])+[^\s'"`,)\]}]*/g;

/**
 * Strip absolute filesystem paths from a message: the registered vault
 * base path becomes vault-relative, any other absolute path becomes
 * `<path>`.
 */
export function redactFilesystemPaths(message: string): string {
  let out = message;
  for (const base of vaultBasePaths) {
    for (const variant of new Set([base, base.replace(/\\/g, '/')])) {
      out = out
        .split(`${variant}/`).join('')
        .split(`${variant}\\`).join('')
        .split(variant).join('<vault>');
    }
  }
  return out.replace(ABSOLUTE_PATH_PATTERN, '<path>');
}

function errorFrom(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
