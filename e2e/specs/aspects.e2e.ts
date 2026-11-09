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
