import { posix } from 'path';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { validateVaultPath, PathTraversalError } from '../utils/path-guard';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { Logger } from '../utils/logger';

/**
 * Static mime-type table covering the file types that show up in an
 * Obsidian vault. Keys are lowercase extensions including the leading dot.
 * Unknown extensions fall back to application/octet-stream. See
 * docs/superpowers/specs/2026-05-03-mcp-resources-vault-files-design.md.
 */
const MIME_TABLE: Record<string, string> = {
  // Text
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/x-typescript',
  '.svg': 'image/svg+xml',
  // Binary — images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // Binary — audio / video
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  // Binary — documents
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.epub': 'application/epub+zip',
};

const FALLBACK_MIME = 'application/octet-stream';

export function getMimeType(path: string): string {
  const ext = posix.extname(path).toLowerCase();
  return MIME_TABLE[ext] ?? FALLBACK_MIME;
}

export function isTextMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  if (mime === 'application/yaml') return true;
  if (mime === 'image/svg+xml') return true;
  return false;
}

type VaultUriVariables = { path: string | string[] };

/**
 * Validate an `obsidian://vault/{+path}` URI and return the vault-relative
 * path it points to. The SDK has already parsed the variable; we still
 * defend against scheme/host mismatches and call `validateVaultPath` so
 * traversal protection is shared with the tool surface.
 */
export function parseVaultUri(
  uri: URL,
  variables: VaultUriVariables,
  vaultPath: string,
): string {
  if (uri.protocol !== 'obsidian:') {
    throw new PathTraversalError(`Unexpected scheme: ${uri.protocol}`);
  }
  if (uri.host !== 'vault') {
    throw new PathTraversalError(`Unexpected host: ${uri.host}`);
  }
  const raw = Array.isArray(variables.path)
    ? variables.path.join('/')
    : variables.path;
  return validateVaultPath(raw, vaultPath);
}

type FileHandler = (
  uri: URL,
  variables: VaultUriVariables,
) => Promise<ReadResourceResult>;

export function createFileHandler(
  adapter: ObsidianAdapter,
  _logger: Logger,
): FileHandler {
  return async (uri, variables) => {
    const path = parseVaultUri(uri, variables, adapter.getVaultPath());
    const mime = getMimeType(path);
    if (isTextMime(mime)) {
      const text = await adapter.readFile(path);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: mime,
            text,
          },
        ],
      };
    }
    throw new Error('Binary branch not implemented yet'); // filled in in the next task
  };
}
