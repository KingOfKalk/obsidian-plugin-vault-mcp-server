import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  callDocument,
  callTool,
  callToolRaw,
  connectClient,
  startMcpServer,
  vaultBasePath,
  writeNotes,
} from '../helpers';

/** A 1x1 PNG (70 bytes). */
const DOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const NOTE = '---\nstatus: draft\n---\n# Quotes "and" \\ backslashes\n\n\tTabbed line\n';

/**
 * The 5.0 result formats (#467) against real Obsidian: document tools send
 * plain text with a short header, data tools send structuredContent plus
 * the same JSON as text, and vault_read_binary sends an image block.
 */
describe('result formats', function () {
  let client: Client;

  before(async function () {
    await startMcpServer();
    client = await connectClient();
    await writeNotes({ 'formats/Note.md': NOTE });
  });

  after(async function () {
    await client.close();
  });

  it('vault_read returns a header and the raw note, not JSON', async function () {
    const doc = await callDocument(client, 'vault_read', { path: 'formats/Note.md' });
    expect(doc.body).toBe(NOTE);
    expect(doc.meta).toMatchObject({
      path: 'formats/Note.md',
      totalLength: String(NOTE.length),
      offset: '0',
      hasMore: 'false',
    });
    expect(Number.isNaN(Date.parse(doc.meta.modified))).toBe(false);
  });

  it('the modified header works as expectedMtime of a write', async function () {
    const doc = await callDocument(client, 'vault_read', { path: 'formats/Note.md' });
    const written = await callTool<{ modified: string }>(client, 'vault_append', {
      path: 'formats/Note.md',
      content: 'appended\n',
      expectedMtime: doc.meta.modified,
    });
    expect(Date.parse(written.modified)).toBeGreaterThanOrEqual(Date.parse(doc.meta.modified));
  });

  it('a data tool sends its structuredContent as compact JSON text', async function () {
    // callTool checks that the text equals JSON.stringify(structuredContent).
    const meta = await callTool<{ path: string; size: number }>(client, 'vault_get_metadata', {
      path: 'formats/Note.md',
    });
    expect(meta.path).toBe('formats/Note.md');
    expect(meta.size).toBeGreaterThan(0);
  });

  it('vault_read_binary returns an image block for a PNG, without base64 text', async function () {
    await callTool(client, 'vault_write_binary', { path: 'formats/dot.png', data: DOT_PNG });
    const onDisk = await readFile(path.join(await vaultBasePath(), 'formats/dot.png'));
    expect(onDisk.toString('base64')).toBe(DOT_PNG);

    const result = await callToolRaw(client, 'vault_read_binary', { path: 'formats/dot.png' });
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'path: formats/dot.png\nmimeType: image/png\nsizeBytes: 70\ncontent: image',
      },
      { type: 'image', data: DOT_PNG, mimeType: 'image/png' },
    ]);
  });

  it('vault_read_binary returns another type as an embedded resource', async function () {
    const result = await callToolRaw(client, 'vault_read_binary', { path: 'formats/Note.md' });
    const block = result.content[1];
    expect(block.type).toBe('resource');
    if (block.type !== 'resource') return;
    expect(block.resource.uri).toBe('obsidian://vault/formats/Note.md');
    expect(block.resource.mimeType).toBe('text/markdown');
    const blob = 'blob' in block.resource ? block.resource.blob : '';
    expect(Buffer.from(blob, 'base64').toString('utf8').startsWith(NOTE)).toBe(true);
  });
});
