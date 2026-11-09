import { expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import { callTool, connectClient, enableModules, startMcpServer, waitForCache, writeNotes } from '../helpers';

async function openWith(client: Client, path: string, content: string): Promise<void> {
  await writeNotes({ [path]: content });
  await waitForCache([path]);
  await callTool(client, 'workspace_open_file', { path });
  const opened = await callTool<{ content: string }>(client, 'editor_get_content');
  expect(opened.content).toBe(content);
}

async function editorContent(client: Client): Promise<string> {
  return (await callTool<{ content: string }>(client, 'editor_get_content')).content;
}

/**
 * How Obsidian's editor treats positions at and past the end, which
 * `MockObsidianAdapter` copies (#447): a line equal to the line count is
 * the end of the document, and `ch` past a line's end runs into the next
 * line.
 */
describe('editor positions at the end of the document', function () {
  let client: Client;

  before(async function () {
    await enableModules('editor', 'workspace');
    await startMcpServer();
    client = await connectClient();
  });

  after(async function () {
    await client.close();
  });

  it('editor_replace with toLine == lineCount replaces up to the end', async function () {
    await openWith(client, 'editor/end.md', 'A\nline2');
    await callTool(client, 'editor_replace', { fromLine: 1, fromCh: 0, toLine: 2, toCh: 0, text: 'Z' });
    expect(await editorContent(client)).toBe('A\nZ');
  });

  it('editor_insert at line == lineCount appends at the end', async function () {
    await openWith(client, 'editor/insert.md', 'A\nZ');
    await callTool(client, 'editor_insert', { line: 2, ch: 0, text: 'Q' });
    expect(await editorContent(client)).toBe('A\nZQ');
  });

  it('editor_delete to (lineCount, 0) removes the trailing lines', async function () {
    await openWith(client, 'editor/delete.md', 'one\ntwo\nthree');
    await callTool(client, 'editor_delete', { fromLine: 0, fromCh: 3, toLine: 3, toCh: 0 });
    expect(await editorContent(client)).toBe('one');
  });

  it('a ch past the line end runs into the next line', async function () {
    await openWith(client, 'editor/spill.md', 'ab\ncd');
    await callTool(client, 'editor_replace', { fromLine: 0, fromCh: 1, toLine: 0, toCh: 4, text: '-' });
    expect(await editorContent(client)).toBe('a-d');
  });
});
