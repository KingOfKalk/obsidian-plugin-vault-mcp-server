import { posix } from 'path';

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

export function validateVaultPath(inputPath: string, vaultRoot: string): string {
  if (!inputPath || inputPath.trim().length === 0) {
    throw new PathTraversalError('Path must not be empty');
  }

  // Reject null bytes
  if (inputPath.includes('\0')) {
    throw new PathTraversalError('Path must not contain null bytes');
  }

  // Reject backslashes (Windows-style path separators used as escape attempts)
  if (inputPath.includes('\\')) {
    throw new PathTraversalError('Path must not contain backslashes');
  }

  // Reject percent-encoded sequences that could hide traversal
  if (/%2[eE]/g.test(inputPath) || /%2[fF]/g.test(inputPath) || /%5[cC]/g.test(inputPath)) {
    throw new PathTraversalError('Path must not contain encoded traversal sequences');
  }

  // Normalize the path
  const normalized = posix.normalize(inputPath);

  // Reject if normalization reveals traversal
  if (normalized.startsWith('..') || normalized.includes('/..') || normalized === '..') {
    throw new PathTraversalError('Path must not traverse outside the vault');
  }

  // Remove leading slashes — vault paths are relative
  const relativePath = normalized.replace(/^\/+/, '');

  if (relativePath.length === 0) {
    throw new PathTraversalError('Path must not be empty after normalization');
  }

  // Build the absolute path and verify it's within the vault
  const normalizedVaultRoot = posix.normalize(vaultRoot);
  const absolutePath = posix.join(normalizedVaultRoot, relativePath);
  const resolvedAbsolute = posix.normalize(absolutePath);

  if (!resolvedAbsolute.startsWith(normalizedVaultRoot + '/') && resolvedAbsolute !== normalizedVaultRoot) {
    throw new PathTraversalError('Path must not traverse outside the vault');
  }

  return relativePath;
}

/**
 * Thrown for a path inside the vault's config folder (`app.vault.configDir`,
 * usually `.obsidian`). That folder holds plugin code, settings and this
 * plugin's access key, so no tool may read or write it (#462).
 */
export class ConfigDirError extends PathTraversalError {
  constructor(configDir: string) {
    super(`Path is inside the Obsidian config folder (${configDir}); it cannot be read or written`);
    this.name = 'ConfigDirError';
  }
}

/**
 * One path segment as a case-insensitive file system sees it: lower case,
 * and without trailing dots and spaces, which Windows drops (`.obsidian.`
 * opens `.obsidian`).
 */
function foldSegment(segment: string): string {
  return segment.toLowerCase().replace(/[. ]+$/, '');
}

function segments(path: string): string[] {
  return posix
    .normalize(path)
    .split('/')
    .filter((s) => s.length > 0 && s !== '.');
}

/**
 * Whether a vault-relative path is the config folder or inside it. Compared
 * case-insensitively and after normalisation, so `.Obsidian/x` and
 * `./.obsidian//x` count too. An empty `configDir` matches nothing.
 */
export function isInConfigDir(path: string, configDir: string): boolean {
  const dir = segments(configDir).map(foldSegment);
  if (dir.length === 0) return false;
  const parts = segments(path);
  if (parts.length < dir.length) return false;
  return dir.every((segment, i) => foldSegment(parts[i]) === segment);
}

/** Throw {@link ConfigDirError} when `path` is inside the config folder. */
export function assertOutsideConfigDir(path: string, configDir: string): void {
  if (isInConfigDir(path, configDir)) {
    throw new ConfigDirError(configDir);
  }
}

/**
 * Validate a path an agent passed to a tool, prompt or resource:
 * {@link validateVaultPath} plus the config-folder block. Every agent-facing
 * entry point uses this one; `validateVaultPath` alone only keeps a path
 * inside the vault.
 */
export function validateToolPath(inputPath: string, vaultRoot: string, configDir: string): string {
  const path = validateVaultPath(inputPath, vaultRoot);
  assertOutsideConfigDir(path, configDir);
  return path;
}

/** Drop the config folder and everything in it from a listing. */
export function withoutConfigDir<T extends { files: string[]; folders: string[] }>(
  list: T,
  configDir: string,
): T {
  return {
    ...list,
    files: list.files.filter((p) => !isInConfigDir(p, configDir)),
    folders: list.folders.filter((p) => !isInConfigDir(p, configDir)),
  };
}

/**
 * Inputs that mean "the vault root" for folder-listing tools.
 */
const VAULT_ROOT_ALIASES = new Set(['', '/', '.', './']);

/**
 * Validate a folder path for the folder-listing tools (`vault_list`,
 * `vault_list_recursive`). Same rules as {@link validateToolPath}, except
 * that `""`, `"/"` and `"."` are accepted and mean the vault root, which is
 * returned as `""`. File tools must keep using `validateToolPath`, which
 * rejects an empty path.
 */
export function validateFolderListPath(
  inputPath: string,
  vaultRoot: string,
  configDir: string,
): string {
  if (VAULT_ROOT_ALIASES.has(inputPath.trim())) {
    return '';
  }
  return validateToolPath(inputPath, vaultRoot, configDir);
}
