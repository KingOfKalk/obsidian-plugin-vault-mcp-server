import { posix } from 'path';
import { ResourceTemplate } from '@modelcontextprotocol/server';
import type { ReadResourceResult, McpServer } from '@modelcontextprotocol/server';
import { validateToolPath, withoutConfigDir, PathTraversalError } from '../utils/path-guard';
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

const VAULT_URI_PREFIX = 'obsidian://vault/';

/**
 * Validate an `obsidian://vault/{+path}` URI and return the vault-relative
 * path it points to.
 *
 * The path is cut from the serialised URI (`href`), not taken from `host`
 * and `pathname`: older Electron (Obsidian 1.5.3) parses this custom scheme
 * without a host (`host` is empty, `pathname` is `//vault/...`), newer
 * Electron gives the host `vault` (#473). Both keep the `href`. The SDK's
 * template variable is not used either, because the SDK does not
 * percent-decode it. Query and fragment are ignored, the rest is
 * percent-decoded and checked by `validateToolPath`, so traversal
 * protection and the config-folder block are shared with the tool surface.
 */
export function parseVaultUri(uri: URL, vaultPath: string, configDir: string): string {
  const href = uri.href;
  if (uri.protocol !== 'obsidian:') {
    throw new PathTraversalError(`Unexpected scheme: ${uri.protocol}`);
  }
  if (href.slice(0, VAULT_URI_PREFIX.length).toLowerCase() !== VAULT_URI_PREFIX) {
    throw new PathTraversalError(`URI must start with ${VAULT_URI_PREFIX}: ${href}`);
  }
  const encoded = href.slice(VAULT_URI_PREFIX.length).replace(/[?#][\s\S]*$/, '');
  let raw: string;
  try {
    raw = decodeURIComponent(encoded);
  } catch {
    throw new PathTraversalError(`Invalid percent-encoding in URI: ${href}`);
  }
  return validateToolPath(raw, vaultPath, configDir);
}

type FileHandler = (uri: URL) => Promise<ReadResourceResult>;

export function createFileHandler(
  adapter: ObsidianAdapter,
  _logger: Logger,
): FileHandler {
  return async (uri) => {
    const path = parseVaultUri(uri, adapter.getVaultPath(), adapter.getConfigDir());
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
    const list = withoutConfigDir(adapter.listRecursive(''), adapter.getConfigDir());
    // Stable order so truncation is deterministic across calls and adapters.
    const sortedFiles = [...list.files].sort();
    const sortedFolders = [...list.folders].sort();

    const files: IndexEntry[] = await Promise.all(
      sortedFiles.map(async (path) => {
        const stat = await adapter.stat(path);
        return {
          // encodeURIComponent per segment so reserved characters (?, #, etc.)
          // are properly escaped while keeping path slashes literal.
          uri: 'obsidian://vault/' + path.split('/').map(encodeURIComponent).join('/'),
          name: basename(path),
          mimeType: getMimeType(path),
          size: stat?.size ?? 0,
        };
      }),
    );
    const folders = sortedFolders;

    let serialised = JSON.stringify({ files, folders, truncated: false });
    if (serialised.length > CHARACTER_LIMIT) {
      const trimmed = [...files];
      while (trimmed.length > 0) {
        trimmed.pop();
        const candidate = JSON.stringify({ files: trimmed, folders, truncated: true });
        if (candidate.length <= CHARACTER_LIMIT) {
          serialised = candidate;
          break;
        }
      }
      if (serialised.length > CHARACTER_LIMIT) {
        serialised = JSON.stringify({ files: [], folders: [], truncated: true });
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

const FILE_TEMPLATE_URI = 'obsidian://vault/{+path}';

export function registerResources(
  server: McpServer,
  adapter: ObsidianAdapter,
  logger: Logger,
): void {
  const indexHandler = createIndexHandler(adapter, logger);
  const fileHandler = createFileHandler(adapter, logger);

  server.registerResource(
    'vault-index',
    VAULT_INDEX_URI,
    {
      description:
        'JSON listing of every file and folder in the vault, with ready-to-use obsidian://vault/{+path} URIs and mime types. Truncated past 25 000 characters.',
      mimeType: 'application/json',
    },
    (uri: URL) => indexHandler(uri),
  );

  server.registerResource(
    'vault-file',
    new ResourceTemplate(FILE_TEMPLATE_URI, { list: undefined }),
    {
      description:
        'Read any file in the vault by obsidian://vault/{+path}. Text files (markdown, txt, json, csv, yaml, html, svg) return TextResourceContents; other files up to 1 MiB return base64 BlobResourceContents.',
    },
    (uri: URL) => fileHandler(uri),
  );
}
