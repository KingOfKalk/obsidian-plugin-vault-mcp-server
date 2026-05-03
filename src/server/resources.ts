import { posix } from 'path';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { validateVaultPath, PathTraversalError } from '../utils/path-guard';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { Logger } from '../utils/logger';
import { BinaryTooLargeError, FileNotFoundError } from '../tools/shared/errors';
import { BINARY_BYTE_LIMIT, CHARACTER_LIMIT } from '../constants';

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
    const stat = await adapter.stat(path);
    if (stat === null) {
      throw new FileNotFoundError(path);
    }
    if (stat.size > BINARY_BYTE_LIMIT) {
      throw new BinaryTooLargeError(stat.size, BINARY_BYTE_LIMIT);
    }
    const data = await adapter.readBinary(path);
    const blob = Buffer.from(data).toString('base64');
    return {
      contents: [{ uri: uri.toString(), mimeType: mime, blob }],
    };
  };
}

type IndexHandler = (uri: URL) => Promise<ReadResourceResult>;

interface IndexEntry {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

interface IndexPayload {
  files: IndexEntry[];
  folders: string[];
  truncated: boolean;
}

const VAULT_INDEX_URI = 'obsidian://vault/index';

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export function createIndexHandler(
  adapter: ObsidianAdapter,
  _logger: Logger,
): IndexHandler {
  return async (_uri) => {
    const list = adapter.listRecursive('');
    const files: IndexEntry[] = [];
    for (const path of list.files) {
      const stat = await adapter.stat(path);
      files.push({
        uri: 'obsidian://vault/' + encodeURI(path),
        name: basename(path),
        mimeType: getMimeType(path),
        size: stat?.size ?? 0,
      });
    }
    const folders = [...list.folders];

    let payload: IndexPayload = { files, folders, truncated: false };
    let serialised = JSON.stringify(payload);
    if (serialised.length > CHARACTER_LIMIT) {
      const trimmed = [...files];
      while (trimmed.length > 0) {
        trimmed.pop();
        const candidate: IndexPayload = { files: trimmed, folders, truncated: true };
        const candidateSerialised = JSON.stringify(candidate);
        if (candidateSerialised.length <= CHARACTER_LIMIT) {
          payload = candidate;
          serialised = candidateSerialised;
          break;
        }
      }
      if (serialised.length > CHARACTER_LIMIT) {
        payload = { files: [], folders: [], truncated: true };
        serialised = JSON.stringify(payload);
      }
    }

    return {
      contents: [
        {
          uri: VAULT_INDEX_URI,
          mimeType: 'application/json',
          text: serialised,
        },
      ],
    };
  };
}
