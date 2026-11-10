import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  callTool,
  callToolError,
  connectClient,
  startMcpServer,
  waitForLinks,
  writeNotes,
} from '../helpers';
import { resolveLinkpath } from '../../tests/helpers/link-resolver';

/**
 * `vault_get_aspect` with aspect=backlinks on a path that does not exist
 * answers "File not found" like the other aspects, even while other notes
 * hold an unresolved link with that name (#447).
 */
describe('vault_get_aspect backlinks', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({
      'aspects/Target.md': '# Target\n',
      'aspects/Linker.md': 'See [[Target]] and [[Missing]].\n',
    });
    await waitForLinks({ 'aspects/Linker.md': { 'aspects/Target.md': 1 } });
  });

  after(async function () {
    await client.close();
  });

  it('lists the backlinks of an existing note', async function () {
    const result = await callTool<{ backlinks: string[] }>(client, 'vault_get_aspect', {
      path: 'aspects/Target.md',
      aspect: 'backlinks',
    });
    expect(result.backlinks).toEqual(['aspects/Linker.md']);
  });

  for (const includeContext of [false, true]) {
    it(`reports "File not found" for a missing path (includeContext=${String(includeContext)})`, async function () {
      const text = await callToolError(client, 'vault_get_aspect', {
        path: 'aspects/Missing.md',
        aspect: 'backlinks',
        includeContext,
      });
      expect(text).toContain('File not found: aspects/Missing.md');
    });
  }
});

/**
 * Outgoing links and embeds carry the path Obsidian resolves them to and
 * their `#subpath` (#485). A note name that exists in two folders resolves
 * like Obsidian: the copy under the source note's folder first, else the
 * shortest path.
 */
describe('vault_get_aspect link targets', function () {
  let client: Client;

  interface LinkTarget {
    link: string;
    path: string | null;
    subpath?: string;
    displayText?: string;
  }

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({
      'targets/notes/Dup.md': '# Dup\n\nA line ^blk\n',
      'targets/archive/old/Dup.md': '# Old dup\n',
      'targets/reference/Field Protocol.md': '# Field Protocol\n\n## Calibration\n',
      'targets/assets/diagram.png': 'not really a png',
      'targets/notes/Source.md':
        'See [[Dup]], [[Field Protocol#Calibration|calibration]], [[Dup#^blk]] and [[Nowhere#Intro]].\n\n' +
        '![[diagram.png]]\n![[Field Protocol#Calibration]]\n',
      'targets/archive/Linker.md': 'See [[Dup]].\n',
      'targets/other/Far.md': 'See [[Dup]].\n',
    });
    await waitForLinks({
      'targets/notes/Source.md': {
        'targets/notes/Dup.md': 2,
        'targets/reference/Field Protocol.md': 2,
        'targets/assets/diagram.png': 1,
      },
      'targets/archive/Linker.md': { 'targets/archive/old/Dup.md': 1 },
      'targets/other/Far.md': { 'targets/notes/Dup.md': 1 },
    });
  });

  after(async function () {
    await client.close();
  });

  it('adds the resolved path and the subpath to outgoing links', async function () {
    const result = await callTool<{ links: LinkTarget[] }>(client, 'vault_get_aspect', {
      path: 'targets/notes/Source.md',
      aspect: 'outgoing_links',
    });
    expect(result.links.map(({ displayText: _d, ...rest }) => rest)).toEqual([
      { link: 'Dup', path: 'targets/notes/Dup.md' },
      { link: 'Field Protocol#Calibration', path: 'targets/reference/Field Protocol.md', subpath: '#Calibration' },
      { link: 'Dup#^blk', path: 'targets/notes/Dup.md', subpath: '#^blk' },
      { link: 'Nowhere#Intro', path: null, subpath: '#Intro' },
    ]);
    expect(result.links[1].displayText).toBe('calibration');
  });

  it('resolves embeds, including a non-Markdown file', async function () {
    const result = await callTool<{ embeds: LinkTarget[] }>(client, 'vault_get_aspect', {
      path: 'targets/notes/Source.md',
      aspect: 'embeds',
    });
    expect(result.embeds.map(({ link, path, subpath }) => ({ link, path, subpath }))).toEqual([
      { link: 'diagram.png', path: 'targets/assets/diagram.png', subpath: undefined },
      { link: 'Field Protocol#Calibration', path: 'targets/reference/Field Protocol.md', subpath: '#Calibration' },
    ]);
  });

  it('resolves a name in two folders like Obsidian and the mock adapters', async function () {
    const paths = await browser.executeObsidian(({ app }) =>
      app.vault.getFiles().map((f) => f.path).filter((p) => p.startsWith('targets/')),
    );
    for (const [source, expected] of [
      // Under the source folder wins, though notes/Dup.md is shorter.
      ['targets/archive/Linker.md', 'targets/archive/old/Dup.md'],
      // Otherwise the shortest path.
      ['targets/other/Far.md', 'targets/notes/Dup.md'],
    ]) {
      const result = await callTool<{ links: LinkTarget[] }>(client, 'vault_get_aspect', {
        path: source,
        aspect: 'outgoing_links',
      });
      expect(result.links.map((l) => l.path)).toEqual([expected]);
      expect(resolveLinkpath('Dup', source, paths)).toBe(expected);
    }
  });
});
