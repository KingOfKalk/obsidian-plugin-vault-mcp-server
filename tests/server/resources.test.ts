import { describe, it, expect } from 'vitest';
import { getMimeType, isTextMime, parseVaultUri, createFileHandler, createIndexHandler, registerResources } from '../../src/server/resources';
import { CHARACTER_LIMIT } from '../../src/constants';
import { PathTraversalError } from '../../src/utils/path-guard';
import { Logger } from '../../src/utils/logger';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { BinaryTooLargeError, FileNotFoundError } from '../../src/tools/shared/errors';

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

describe('getMimeType', () => {
  it('maps known text extensions', () => {
    expect(getMimeType('notes/foo.md')).toBe('text/markdown');
    expect(getMimeType('foo.txt')).toBe('text/plain');
    expect(getMimeType('config.json')).toBe('application/json');
    expect(getMimeType('data.csv')).toBe('text/csv');
    expect(getMimeType('settings.yml')).toBe('application/yaml');
    expect(getMimeType('settings.yaml')).toBe('application/yaml');
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('maps known binary extensions', () => {
    expect(getMimeType('a.png')).toBe('image/png');
    expect(getMimeType('a.jpg')).toBe('image/jpeg');
    expect(getMimeType('a.jpeg')).toBe('image/jpeg');
    expect(getMimeType('a.pdf')).toBe('application/pdf');
    expect(getMimeType('a.mp3')).toBe('audio/mpeg');
    expect(getMimeType('a.mp4')).toBe('video/mp4');
  });

  it('is case-insensitive on the extension', () => {
    expect(getMimeType('FOO.MD')).toBe('text/markdown');
    expect(getMimeType('PHOTO.JPG')).toBe('image/jpeg');
  });

  it('falls back to application/octet-stream for unknown or missing extensions', () => {
    expect(getMimeType('mystery.xyz')).toBe('application/octet-stream');
    expect(getMimeType('Makefile')).toBe('application/octet-stream');
  });
});

describe('isTextMime', () => {
  it('returns true for text/*, application/json, application/yaml, and image/svg+xml', () => {
    expect(isTextMime('text/markdown')).toBe(true);
    expect(isTextMime('text/plain')).toBe(true);
    expect(isTextMime('application/json')).toBe(true);
    expect(isTextMime('application/yaml')).toBe(true);
    expect(isTextMime('image/svg+xml')).toBe(true);
  });

  it('returns false for binary mimes', () => {
    expect(isTextMime('image/png')).toBe(false);
    expect(isTextMime('application/pdf')).toBe(false);
    expect(isTextMime('application/octet-stream')).toBe(false);
  });
});

const VAULT = '/tmp/vault';

function uri(s: string): URL { return new URL(s); }

describe('parseVaultUri', () => {
  it('returns the validated relative path for a plain URI', () => {
    expect(parseVaultUri(uri('obsidian://vault/notes/foo.md'), { path: 'notes/foo.md' }, VAULT))
      .toBe('notes/foo.md');
  });

  it('handles unicode paths', () => {
    expect(parseVaultUri(uri('obsidian://vault/Notizen/%C3%9Cbersicht.md'), { path: 'Notizen/Übersicht.md' }, VAULT))
      .toBe('Notizen/Übersicht.md');
  });

  it('rejects traversal', () => {
    expect(() => parseVaultUri(uri('obsidian://vault/../etc/passwd'), { path: '../etc/passwd' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects encoded traversal', () => {
    expect(() => parseVaultUri(uri('obsidian://vault/..%2F..'), { path: '..%2F..' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects wrong scheme', () => {
    expect(() => parseVaultUri(uri('file:///foo.md'), { path: 'foo.md' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects wrong host', () => {
    expect(() => parseVaultUri(uri('obsidian://other/foo.md'), { path: 'foo.md' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects empty path', () => {
    expect(() => parseVaultUri(uri('obsidian://vault/'), { path: '' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('accepts a single-string variable form (some SDK paths pass string[])', () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    expect(parseVaultUri(uri('obsidian://vault/notes/foo.md'), { path: ['notes', 'foo.md'] as unknown as string }, VAULT))
      .toBe('notes/foo.md');
  });
});

describe('fileHandler — text', () => {
  it('returns TextResourceContents for a markdown file', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('notes/foo.md', '# Hello');
    const handler = createFileHandler(adapter, makeLogger());

    const result = await handler(
      new URL('obsidian://vault/notes/foo.md'),
      { path: 'notes/foo.md' },
    );

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      uri: 'obsidian://vault/notes/foo.md',
      mimeType: 'text/markdown',
      text: '# Hello',
    });
  });

  it('propagates the adapter not-found error for a missing file', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFileHandler(adapter, makeLogger());

    await expect(handler(
      new URL('obsidian://vault/missing.md'),
      { path: 'missing.md' },
    )).rejects.toThrow(/not found/i);
  });
});

describe('fileHandler — binary', () => {
  it('returns BlobResourceContents (base64) for a small image', async () => {
    const adapter = new MockObsidianAdapter();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    await adapter.writeBinary('img.png', bytes.buffer);
    const handler = createFileHandler(adapter, makeLogger());

    const result = await handler(
      new URL('obsidian://vault/img.png'),
      { path: 'img.png' },
    );

    expect(result.contents).toHaveLength(1);
    const c = result.contents[0] as { uri: string; mimeType: string; blob: string };
    expect(c.uri).toBe('obsidian://vault/img.png');
    expect(c.mimeType).toBe('image/png');
    expect(Buffer.from(c.blob, 'base64')).toEqual(Buffer.from(bytes));
  });

  it('serves a file at exactly 1 MiB', async () => {
    const adapter = new MockObsidianAdapter();
    const bytes = new Uint8Array(1_048_576);
    await adapter.writeBinary('big.png', bytes.buffer);
    const handler = createFileHandler(adapter, makeLogger());

    const result = await handler(
      new URL('obsidian://vault/big.png'),
      { path: 'big.png' },
    );

    const c = result.contents[0] as { blob: string };
    expect(Buffer.from(c.blob, 'base64').byteLength).toBe(1_048_576);
  });

  it('throws BinaryTooLargeError above 1 MiB', async () => {
    const adapter = new MockObsidianAdapter();
    const bytes = new Uint8Array(1_048_577);
    await adapter.writeBinary('big.png', bytes.buffer);
    const handler = createFileHandler(adapter, makeLogger());

    await expect(handler(
      new URL('obsidian://vault/big.png'),
      { path: 'big.png' },
    )).rejects.toBeInstanceOf(BinaryTooLargeError);
  });

  it('throws FileNotFoundError for a missing binary file', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFileHandler(adapter, makeLogger());
    await expect(handler(
      new URL('obsidian://vault/missing.png'),
      { path: 'missing.png' },
    )).rejects.toBeInstanceOf(FileNotFoundError);
  });
});

interface IndexEntry { uri: string; name: string; mimeType: string; size: number }
interface IndexPayload { files: IndexEntry[]; folders: string[]; truncated: boolean }

describe('indexHandler', () => {
  it('returns a flat list with resource entries and folder names', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');
    adapter.addFile('notes/b.md', 'bb');
    adapter.addFile('img.png', 'pngdata');
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const c = result.contents[0] as { uri: string; mimeType: string; text: string };
    expect(c.uri).toBe('obsidian://vault/index');
    expect(c.mimeType).toBe('application/json');

    const payload = JSON.parse(c.text) as IndexPayload;
    expect(payload.truncated).toBe(false);
    expect(payload.folders).toContain('notes');
    expect(payload.files.find((f) => f.name === 'a.md')).toMatchObject({
      uri: 'obsidian://vault/a.md',
      mimeType: 'text/markdown',
      size: 1,
    });
    expect(payload.files.find((f) => f.name === 'b.md')).toMatchObject({
      uri: 'obsidian://vault/notes/b.md',
      mimeType: 'text/markdown',
    });
    expect(payload.files.find((f) => f.name === 'img.png')).toMatchObject({
      mimeType: 'image/png',
    });
  });

  it('returns an empty payload for an empty vault', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const payload = JSON.parse((result.contents[0] as { text: string }).text) as IndexPayload;
    expect(payload).toEqual({ files: [], folders: [], truncated: false });
  });

  it('truncates files past the 25 000-character cap', async () => {
    const adapter = new MockObsidianAdapter();
    // Each entry is roughly 90+ chars in JSON. 400 entries blow past 25k.
    for (let i = 0; i < 400; i++) {
      adapter.addFile(`note-${String(i).padStart(4, '0')}.md`, 'x');
    }
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const text = (result.contents[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const payload = JSON.parse(text) as IndexPayload;
    expect(payload.truncated).toBe(true);
    expect(payload.files.length).toBeLessThan(400);
  });

  it('produces URIs that round-trip through parseVaultUri', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('Notizen/Übersicht.md', 'x');
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const payload = JSON.parse((result.contents[0] as { text: string }).text) as IndexPayload;
    const entry = payload.files[0];

    const parsedPath = parseVaultUri(
      new URL(entry.uri),
      // The SDK populates `variables.path` by decoding the URI; emulate by
      // decoding entry.uri's pathname after the host segment.
      { path: decodeURIComponent(new URL(entry.uri).pathname.replace(/^\//, '')) },
      adapter.getVaultPath(),
    );
    expect(parsedPath).toBe('Notizen/Übersicht.md');
  });
});

describe('registerResources', () => {
  it('registers vault-index (static) and vault-file (template)', () => {
    const adapter = new MockObsidianAdapter();

    interface Capture { name: string; uriOrTemplate: unknown; metadata: Record<string, unknown> }
    const calls: Capture[] = [];
    const fakeServer = {
      registerResource(name: string, uriOrTemplate: unknown, metadata: Record<string, unknown>): void {
        calls.push({ name, uriOrTemplate, metadata });
      },
    };

    registerResources(fakeServer as never, adapter, makeLogger());

    expect(calls.map((c) => c.name)).toEqual(['vault-index', 'vault-file']);
    expect(calls[0].uriOrTemplate).toBe('obsidian://vault/index');
    // Template is a class instance from the SDK — we just verify shape.
    expect(typeof calls[1].uriOrTemplate).toBe('object');
  });
});
