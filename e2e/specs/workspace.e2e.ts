import { browser, expect } from '@wdio/globals';
import type { Client } from '@modelcontextprotocol/client';
import {
  callTool,
  callToolError,
  connectClient,
  enableModules,
  startMcpServer,
  waitForCache,
  writeNotes,
} from '../helpers';

interface ActiveView {
  type: string;
  file: string | null;
  mode: unknown;
  source: unknown;
}

/** The active leaf's view type, file and Markdown view mode. */
async function activeView(): Promise<ActiveView> {
  return browser.executeObsidian(({ app }) => {
    const state = app.workspace.activeLeaf?.getViewState();
    const inner = (state?.state ?? {}) as { file?: string; mode?: unknown; source?: unknown };
    return {
      type: state?.type ?? '',
      file: inner.file ?? null,
      mode: inner.mode,
      source: inner.source,
    };
  });
}

/**
 * `workspace_open_file` opens the note in the requested view mode (#447);
 * it used to ignore `mode` and echo it back.
 */
describe('workspace_open_file mode', function () {
  let client: Client;

  before(async function () {
    await enableModules('editor', 'workspace');
    await startMcpServer();
    client = await connectClient();
    await writeNotes({ 'ws/a.md': '# A\n', 'ws/b.md': '# B\n' });
    await waitForCache(['ws/a.md', 'ws/b.md']);
  });

  after(async function () {
    await client.close();
  });

  it('mode=preview opens the Reading view', async function () {
    const result = await callTool(client, 'workspace_open_file', { path: 'ws/a.md', mode: 'preview' });
    expect(result).toEqual({ path: 'ws/a.md', mode: 'preview' });
    expect(await activeView()).toMatchObject({ type: 'markdown', file: 'ws/a.md', mode: 'preview' });
  });

  it('mode=source opens Source mode, also for the file already shown', async function () {
    await callTool(client, 'workspace_open_file', { path: 'ws/a.md', mode: 'source' });
    expect(await activeView()).toMatchObject({ file: 'ws/a.md', mode: 'source', source: true });
  });

  it('mode=live opens Live Preview', async function () {
    await callTool(client, 'workspace_open_file', { path: 'ws/b.md', mode: 'live' });
    expect(await activeView()).toMatchObject({ file: 'ws/b.md', mode: 'source', source: false });
  });

  it('switches an open note from Live Preview to the Reading view', async function () {
    await callTool(client, 'workspace_open_file', { path: 'ws/b.md', mode: 'preview' });
    expect(await activeView()).toMatchObject({ file: 'ws/b.md', mode: 'preview' });
  });

  it('opens without a mode and makes the note the active file', async function () {
    const result = await callTool(client, 'workspace_open_file', { path: 'ws/a.md' });
    expect(result).toEqual({ path: 'ws/a.md' });
    expect((await activeView()).file).toBe('ws/a.md');
    const active = await callTool<{ path: string | null }>(client, 'editor_get_active_file');
    expect(active.path).toBe('ws/a.md');
  });

  it('reports "File not found" for a missing file', async function () {
    const text = await callToolError(client, 'workspace_open_file', { path: 'ws/missing.md' });
    expect(text).toContain('File not found: ws/missing.md');
  });
});
