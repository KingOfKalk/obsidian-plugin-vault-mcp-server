import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { connectClient, startMcpServer, waitForCache, writeNotes } from '../helpers';

/**
 * Reading vault files through `obsidian://vault/{+path}` resources (#473).
 *
 * Obsidian 1.5.3 ships an older Electron whose `URL` parser does not give
 * `obsidian://vault/...` a host: the host is empty and the path starts with
 * `//vault/`. Newer Electron (Obsidian 1.15.0) gives the host `vault`. The
 * server must read the same file on both.
 */
describe('vault file resources (#473)', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({
      'resources/plain.md': '# Plain\n\nbody\n',
      'resources/Mit Leerzeichen/Übersicht.md': 'umlaut\n',
    });
    await waitForCache(['resources/plain.md', 'resources/Mit Leerzeichen/Übersicht.md']);
  });

  after(async function () {
    await client.close();
  });

  async function readText(uri: string): Promise<string> {
    const result = await client.readResource({ uri });
    const first = result.contents[0];
    if (!('text' in first)) throw new Error(`expected text contents for ${uri}`);
    return first.text;
  }

  it('reads a plain note', async function () {
    expect(await readText('obsidian://vault/resources/plain.md')).toBe('# Plain\n\nbody\n');
  });

  it('reads a note whose path is percent-encoded', async function () {
    expect(
      await readText('obsidian://vault/resources/Mit%20Leerzeichen/%C3%9Cbersicht.md'),
    ).toBe('umlaut\n');
  });

  it('reads a note by the URI the index lists for it', async function () {
    const index = JSON.parse(await readText('obsidian://vault/index')) as {
      files?: { uri: string; name: string }[];
    };
    const entry = (index.files ?? []).find((f) => f.name.endsWith('Übersicht.md'));
    expect(entry).toBeDefined();
    expect(await readText(entry?.uri ?? '')).toBe('umlaut\n');
  });

  it('rejects traversal out of the vault', async function () {
    await expect(
      client.readResource({ uri: 'obsidian://vault/..%2F..%2Fetc%2Fpasswd' }),
    ).rejects.toThrow(/traversal|outside/i);
  });

  it('the runtime URL parser is the one the fix has to cope with', async function () {
    // Records which parse shape this Electron produces, so a failure above
    // can be told apart from a change in Electron.
    const shape = await browser.execute(() => {
      const url = new URL('obsidian://vault/a%20b.md');
      return { host: url.host, pathname: url.pathname, href: url.href };
    });
    expect(shape.href).toBe('obsidian://vault/a%20b.md');
    expect([
      { host: 'vault', pathname: '/a%20b.md' },
      { host: '', pathname: '//vault/a%20b.md' },
    ]).toContainEqual({ host: shape.host, pathname: shape.pathname });
  });
});
