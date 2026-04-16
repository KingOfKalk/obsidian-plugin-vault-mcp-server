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
