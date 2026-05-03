import { posix } from 'path';

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
