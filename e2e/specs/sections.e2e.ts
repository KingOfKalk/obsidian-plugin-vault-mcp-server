import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  callTool,
  connectClient,
  readFromDisk,
  startMcpServer,
  waitForCache,
  writeNotes,
} from '../helpers';

const JOURNAL = [
  '---',
  'tags: [journal]',
  '---',
  '# 2026-11-09',
  '',
  '## Notes',
  '',
  '- one',
  '',
  '### Detail',
  'detail text',
  '',
  '```md',
  '## Not a heading',
  '```',
  '',
  '## Log',
  '- 08:00 coffee',
  '',
].join('\n');

/**
 * `vault_insert` / `vault_read` with `heading` (#428) on a real note: the
 * section is found in the file Obsidian holds and the write goes through
 * `app.vault.process`, so the bytes on disk are checked, not the mock.
 */
describe('vault_insert and vault_read with heading', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
  });

  after(async function () {
    await client.close();
  });

  beforeEach(async function () {
    await writeNotes({ 'sections/Journal.md': JOURNAL });
    await waitForCache(['sections/Journal.md']);
  });

  it('inserts at the end of a section and writes exactly that to disk', async function () {
    const result = await callTool<{ heading: string; position: string; line: number }>(
      client,
      'vault_insert',
      { path: 'sections/Journal.md', heading: 'Log', text: '- 09:30 standup' },
    );
    expect(result).toMatchObject({ heading: '## Log', position: 'end', line: 19 });
    expect(await readFromDisk('sections/Journal.md')).toBe(
      JOURNAL.replace('- 08:00 coffee\n', '- 08:00 coffee\n- 09:30 standup\n'),
    );
  });

  it('inserts at the start of a parent section, before its subsections', async function () {
    const result = await callTool<{ heading: string; line: number }>(client, 'vault_insert', {
      path: 'sections/Journal.md',
      heading: '## Notes',
      position: 'start',
      text: '- zero',
    });
    expect(result).toMatchObject({ heading: '## Notes', line: 8 });
    expect(await readFromDisk('sections/Journal.md')).toBe(
      JOURNAL.replace('## Notes\n\n- one', '## Notes\n\n- zero\n- one'),
    );
  });

  it('reads one section, ignoring headings in code blocks', async function () {
    const section = await callTool<{ heading: string; line: number; content: string }>(
      client,
      'vault_read',
      { path: 'sections/Journal.md', heading: 'Notes' },
    );
    expect(section).toMatchObject({
      heading: '## Notes',
      line: 6,
      content: '## Notes\n\n- one\n\n### Detail\ndetail text\n\n```md\n## Not a heading\n```\n\n',
    });
  });

  it('fails on an unknown heading and leaves the file untouched', async function () {
    const result = await client.callTool({
      name: 'vault_insert',
      arguments: { path: 'sections/Journal.md', heading: 'Nope', text: 'x' },
    });
    expect(result.isError).toBe(true);
    expect(await readFromDisk('sections/Journal.md')).toBe(JOURNAL);
  });
});
