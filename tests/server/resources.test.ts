import { describe, it, expect } from 'vitest';
import { getMimeType, isTextMime, parseVaultUri, vaultUri, createFileHandler, createIndexHandler, registerResources } from '../../src/server/resources';
import { CHARACTER_LIMIT } from '../../src/constants';
import { ConfigDirError, PathTraversalError } from '../../src/utils/path-guard';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { BinaryTooLargeError, FileNotFoundError } from '../../src/tools/shared/errors';

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
const CONFIG_DIR = '.obsidian';

function uri(s: string): URL { return new URL(s); }

/**
 * The shape older Electron (Obsidian 1.5.3) gives `obsidian://vault/...`:
 * no host, the path starts with `//vault/`, `href` unchanged (#473).
 */
function hostlessUri(href: string): URL {
  const rest = href.slice('obsidian:'.length);
  return {
    href,
    protocol: 'obsidian:',
    host: '',
    hostname: '',
    pathname: rest.replace(/[?#][\s\S]*$/, ''),
    toString: () => href,
  } as unknown as URL;
}

function parse(u: URL): string {
  return parseVaultUri(u, VAULT, CONFIG_DIR);
}

describe('parseVaultUri', () => {
  it('returns the validated relative path for a plain URI', () => {
    expect(parse(uri('obsidian://vault/notes/foo.md'))).toBe('notes/foo.md');
  });

  describe('both URL parse shapes (#473)', () => {
    it('Node gives the host "vault"', () => {
      const u = uri('obsidian://vault/notes/foo.md');
      expect([u.host, u.pathname]).toEqual(['vault', '/notes/foo.md']);
    });

    it('reads the path when the host is "vault"', () => {
      expect(parse(uri('obsidian://vault/notes/foo.md'))).toBe('notes/foo.md');
    });

    it('reads the path when there is no host and the path is //vault/...', () => {
      expect(parse(hostlessUri('obsidian://vault/notes/foo.md'))).toBe('notes/foo.md');
      expect(parse(hostlessUri('obsidian://vault/Notizen/%C3%9Cbersicht.md'))).toBe('Notizen/Übersicht.md');
    });

    it('rejects traversal and the config folder in the hostless shape', () => {
      expect(() => parse(hostlessUri('obsidian://vault/../etc/passwd'))).toThrow(PathTraversalError);
      expect(() => parse(hostlessUri('obsidian://vault/.obsidian/plugins/x/data.json'))).toThrow(
        ConfigDirError,
      );
    });

    it('rejects another host in the hostless shape', () => {
      expect(() => parse(hostlessUri('obsidian://other/foo.md'))).toThrow(PathTraversalError);
    });
  });

  describe('percent-encoding', () => {
    it('decodes unicode paths', () => {
      expect(parse(uri('obsidian://vault/Notizen/%C3%9Cbersicht.md'))).toBe('Notizen/Übersicht.md');
    });

    it('decodes spaces, whether the client encoded them or not', () => {
      expect(parse(uri('obsidian://vault/My%20Notes/a%20b.md'))).toBe('My Notes/a b.md');
      expect(parse(uri('obsidian://vault/My Notes/a b.md'))).toBe('My Notes/a b.md');
    });

    it('decodes reserved characters inside a segment', () => {
      expect(parse(uri('obsidian://vault/weird%3Fname%23x.md'))).toBe('weird?name#x.md');
    });

    it('rejects encoded traversal', () => {
      expect(() => parse(uri('obsidian://vault/..%2F..'))).toThrow(PathTraversalError);
      expect(() => parse(uri('obsidian://vault/notes%2F..%2F..%2Fetc%2Fpasswd'))).toThrow(
        PathTraversalError,
      );
    });

    it('rejects an encoded config folder (#462)', () => {
      expect(() => parse(uri('obsidian://vault/%2Eobsidian/plugins/x/data.json'))).toThrow(
        ConfigDirError,
      );
    });

    it('rejects malformed percent-encoding', () => {
      expect(() => parse(uri('obsidian://vault/bad%E0%A4%A.md'))).toThrow(
        /Invalid percent-encoding/,
      );
      expect(() => parse(hostlessUri('obsidian://vault/bad%ZZ.md'))).toThrow(PathTraversalError);
    });
  });

  it('ignores query and fragment', () => {
    expect(parse(uri('obsidian://vault/notes/foo.md?x=1#top'))).toBe('notes/foo.md');
    expect(parse(hostlessUri('obsidian://vault/notes/foo.md#top'))).toBe('notes/foo.md');
  });

  it('accepts the scheme and host in any case', () => {
    expect(parse(uri('OBSIDIAN://Vault/notes/foo.md'))).toBe('notes/foo.md');
  });

  it('keeps a literal ../ inside the vault (the URL parser resolves it)', () => {
    expect(parse(uri('obsidian://vault/../etc/passwd'))).toBe('etc/passwd');
  });

  it('rejects a path inside the config folder (#462)', () => {
    expect(() => parse(uri('obsidian://vault/.obsidian/plugins/vault-mcp-server/data.json'))).toThrow(
      ConfigDirError,
    );
  });

  describe('invalid URIs', () => {
    it.each([
      ['wrong scheme', 'file:///foo.md'],
      ['wrong host', 'obsidian://other/foo.md'],
      ['host that only starts with vault', 'obsidian://vaultx/foo.md'],
      ['no slashes after the scheme', 'obsidian:vault/foo.md'],
      ['empty host', 'obsidian:///vault/foo.md'],
      ['no path', 'obsidian://vault'],
      ['empty path', 'obsidian://vault/'],
      ['only a query', 'obsidian://vault/?x=1'],
    ])('rejects %s', (_label, value) => {
      expect(() => parse(uri(value))).toThrow(PathTraversalError);
    });
  });
});

describe('fileHandler — text', () => {
  it('returns TextResourceContents for a markdown file', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('notes/foo.md', '# Hello');
    const handler = createFileHandler(adapter);

    const result = await handler(
      new URL('obsidian://vault/notes/foo.md'),
    );

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      uri: 'obsidian://vault/notes/foo.md',
      mimeType: 'text/markdown',
      text: '# Hello',
    });
  });

  it('reads a file when the runtime URL has no host (Obsidian 1.5.3, #473)', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('My Notes/a b.md', 'spaced');
    const handler = createFileHandler(adapter);

    const result = await handler(hostlessUri('obsidian://vault/My%20Notes/a%20b.md'));

    expect(result.contents[0]).toEqual({
      uri: 'obsidian://vault/My%20Notes/a%20b.md',
      mimeType: 'text/markdown',
      text: 'spaced',
    });
  });

  it('propagates the adapter not-found error for a missing file', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFileHandler(adapter);

    await expect(handler(
      new URL('obsidian://vault/missing.md'),
    )).rejects.toThrow(/not found/i);
  });
});

describe('fileHandler — binary', () => {
  it('returns BlobResourceContents (base64) for a small image', async () => {
    const adapter = new MockObsidianAdapter();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    await adapter.writeBinary('img.png', bytes.buffer);
    const handler = createFileHandler(adapter);

    const result = await handler(
      new URL('obsidian://vault/img.png'),
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
    const handler = createFileHandler(adapter);

    const result = await handler(
      new URL('obsidian://vault/big.png'),
    );

    const c = result.contents[0] as { blob: string };
    expect(Buffer.from(c.blob, 'base64').byteLength).toBe(1_048_576);
  });

  it('throws BinaryTooLargeError above 1 MiB', async () => {
    const adapter = new MockObsidianAdapter();
    const bytes = new Uint8Array(1_048_577);
    await adapter.writeBinary('big.png', bytes.buffer);
    const handler = createFileHandler(adapter);

    await expect(handler(
      new URL('obsidian://vault/big.png'),
    )).rejects.toBeInstanceOf(BinaryTooLargeError);
  });

  it('throws FileNotFoundError for a missing binary file', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFileHandler(adapter);
    await expect(handler(
      new URL('obsidian://vault/missing.png'),
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
    const handler = createIndexHandler(adapter);

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
    const handler = createIndexHandler(adapter);

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
    const handler = createIndexHandler(adapter);

    const result = await handler(new URL('obsidian://vault/index'));
    const text = (result.contents[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const payload = JSON.parse(text) as IndexPayload;
    expect(payload.truncated).toBe(true);
    expect(payload.files.length).toBeLessThan(400);
  });

  it('keeps the longest prefix of files that fits, folders included', async () => {
    const adapter = new MockObsidianAdapter();
    const paths: string[] = [];
    for (let i = 0; i < 400; i++) {
      const path = `dir/note-${String(i).padStart(4, '0')}-${'x'.repeat(i % 7)}.md`;
      paths.push(path);
      adapter.addFile(path, 'x');
    }
    const handler = createIndexHandler(adapter);

    const result = await handler(new URL('obsidian://vault/index'));
    const text = (result.contents[0] as { text: string }).text;
    const payload = JSON.parse(text) as IndexPayload;
    expect(payload.truncated).toBe(true);
    expect(payload.folders).toEqual(['dir']);
    const kept = payload.files.length;
    expect(payload.files.map((f) => f.uri)).toEqual(paths.slice(0, kept).map(vaultUri));
    // One more file would not have fitted.
    const next = { ...payload.files[0], uri: vaultUri(paths[kept]), name: paths[kept].slice(4) };
    const longer = JSON.stringify({ files: [...payload.files, next], folders: ['dir'], truncated: true });
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(longer.length).toBeGreaterThan(CHARACTER_LIMIT);
  });

  it('produces URIs that round-trip through parseVaultUri', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('Notizen/Übersicht.md', 'x');
    const handler = createIndexHandler(adapter);

    const result = await handler(new URL('obsidian://vault/index'));
    const payload = JSON.parse((result.contents[0] as { text: string }).text) as IndexPayload;
    const entry = payload.files[0];

    const parsedPath = parseVaultUri(
      new URL(entry.uri),
      adapter.getVaultPath(),
      adapter.getConfigDir(),
    );
    expect(parsedPath).toBe('Notizen/Übersicht.md');
  });

  it('escapes reserved URI characters in filenames (? # etc.)', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('weird?name.md', 'x');
    const handler = createIndexHandler(adapter);

    const result = await handler(new URL('obsidian://vault/index'));
    const payload = JSON.parse((result.contents[0] as { text: string }).text) as {
      files: Array<{ uri: string; name: string }>;
    };
    const entry = payload.files[0];

    // ? must be percent-encoded to round-trip through URL parsing
    expect(entry.uri).toBe('obsidian://vault/weird%3Fname.md');
    expect(entry.name).toBe('weird?name.md');

    // Round-trip: parsing the emitted URI yields the original path
    const url = new URL(entry.uri);
    const parsedPath = parseVaultUri(
      url,
      adapter.getVaultPath(),
      adapter.getConfigDir(),
    );
    expect(parsedPath).toBe('weird?name.md');
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

    registerResources(fakeServer as never, adapter);

    expect(calls.map((c) => c.name)).toEqual(['vault-index', 'vault-file']);
    expect(calls[0].uriOrTemplate).toBe('obsidian://vault/index');
    // Template is a class instance from the SDK — we just verify shape.
    expect(typeof calls[1].uriOrTemplate).toBe('object');
  });
});
