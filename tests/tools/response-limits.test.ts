/**
 * Paging and size caps of single tools (#464). The large-vault run through
 * the SDK client is in tests/integration/large-vault.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../helpers/mock-adapter';
import type { ToolModule } from '../../src/registry/types';
import { createVaultModule } from '../../src/tools/vault/index';
import { createEditorModule } from '../../src/tools/editor/index';
import { createPluginInteropModule } from '../../src/tools/plugin-interop/index';
import { createWorkspaceModule } from '../../src/tools/workspace/index';
import { CHARACTER_LIMIT } from '../../src/constants';
import { parseDocument, windowOf } from '../helpers/result';

function textOf(result: CallToolResult): string {
  return result.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

async function run(
  module: ToolModule,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const tool = module.tools().find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(args);
}

let adapter: MockObsidianAdapter;

beforeEach(() => {
  adapter = new MockObsidianAdapter();
});

describe('vault_list paging (#464)', () => {
  beforeEach(() => {
    adapter.addFolder('box');
    adapter.addFolder('box/sub');
    for (const n of ['a', 'b', 'c']) adapter.addFile(`box/${n}.md`, n);
  });

  it('lists folders first, then files, one page at a time', async () => {
    const vault = createVaultModule(adapter);
    const first = await run(vault, 'vault_list', { path: 'box', limit: 2, offset: 0 });
    expect(first.structuredContent).toEqual({
      folders: ['box/sub'],
      files: ['box/a.md'],
      total: 4,
      count: 2,
      offset: 0,
      hasMore: true,
      nextOffset: 2,
    });
    expect(JSON.parse(textOf(first))).toEqual(first.structuredContent);
    const second = await run(vault, 'vault_list', { path: 'box', limit: 2, offset: 2 });
    expect(second.structuredContent).toMatchObject({
      folders: [],
      files: ['box/b.md', 'box/c.md'],
      hasMore: false,
    });
  });

  it('returns the whole folder by default', async () => {
    const result = await run(createVaultModule(adapter), 'vault_list', { path: 'box' });
    expect(result.structuredContent).toMatchObject({ count: 4, hasMore: false });
    expect(result.structuredContent).not.toHaveProperty('nextOffset');
  });
});

describe('vault_list_recursive folders (#464)', () => {
  it('pages folders with the same window as files', async () => {
    for (let i = 0; i < 5; i++) adapter.addFolder(`f${String(i)}`);
    adapter.addFile('one.md', '1');
    const vault = createVaultModule(adapter);
    const first = await run(vault, 'vault_list_recursive', { path: '', limit: 2, offset: 0 });
    expect(first.structuredContent).toEqual({
      folders: ['f0', 'f1'],
      folderTotal: 5,
      total: 1,
      count: 1,
      offset: 0,
      items: ['one.md'],
      hasMore: true,
      nextOffset: 2,
    });
    expect(JSON.parse(textOf(first))).toEqual(first.structuredContent);
    const last = await run(vault, 'vault_list_recursive', { path: '', limit: 2, offset: 4 });
    expect(last.structuredContent).toMatchObject({ folders: ['f4'], items: [], hasMore: false });
  });
});

describe('editor_get_content window (#464)', () => {
  it('returns the window from offset with paging fields', async () => {
    adapter.setActiveEditor('a.md', 'abcdefghij');
    const result = await run(createEditorModule(adapter), 'editor_get_content', {
      offset: 2,
      length: 3,
    });
    expect(result.structuredContent).toBeUndefined();
    expect(textOf(result)).toBe(
      'totalLength: 10\noffset: 2\nhasMore: true\nnextOffset: 5\n\n' +
        'cde\n\n[TRUNCATED: Showing characters 2-5 of 10. Call editor_get_content again with offset=5 to continue.]',
    );
  });

  it('returns a short note whole, as before', async () => {
    adapter.setActiveEditor('a.md', 'short');
    const result = await run(createEditorModule(adapter), 'editor_get_content', {});
    expect(textOf(result)).toBe('totalLength: 5\noffset: 0\nhasMore: false\n\nshort');
  });

  it('returns a full raw window for escape-heavy text (#467)', async () => {
    const text = '"\n'.repeat(20_000);
    adapter.setActiveEditor('a.md', text);
    const result = await run(createEditorModule(adapter), 'editor_get_content', {});
    expect(textOf(result).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const w = windowOf(result);
    expect(w.content).toBe(text.slice(0, 24_000));
    expect(w.nextOffset).toBe(24_000);
  });
});

describe('plugin_dataview_query cap (#464)', () => {
  it('leaves a result that fits unchanged', async () => {
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.setDataviewApi({
      queryMarkdown: () => Promise.resolve({ successful: true, value: '- a\n- b' }),
    });
    const module = createPluginInteropModule(adapter);
    const result = await run(module, 'plugin_dataview_query', { query: 'LIST' });
    expect(result.structuredContent).toBeUndefined();
    expect(textOf(result)).toBe('- a\n- b');
  });

  it('returns fewer whole lines with a header and footer when the result is too large', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => `| row ${String(i)} | ${'x'.repeat(40)} |`);
    adapter.addInstalledPlugin('dataview', 'Dataview', true);
    adapter.setDataviewApi({
      queryMarkdown: () => Promise.resolve({ successful: true, value: rows.join('\n') }),
    });
    const result = await run(createPluginInteropModule(adapter), 'plugin_dataview_query', {
      query: 'TABLE x',
    });
    const text = textOf(result);
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const doc = parseDocument(result);
    expect(doc.meta.truncated).toBe('true');
    const [shown, total] = doc.meta.lines.split(' of ').map(Number);
    expect(total).toBe(2000);
    expect(doc.body.startsWith(rows.slice(0, shown).join('\n'))).toBe(true);
    expect(doc.body).toContain(`[TRUNCATED: Showing ${String(shown)} of 2000 lines.`);
  });
});

describe('workspace_get_layout cap (#464)', () => {
  it('leaves a layout that fits unchanged', async () => {
    adapter.addOpenLeaf('a.md', 'leaf-1');
    const result = await run(createWorkspaceModule(adapter), 'workspace_get_layout', {});
    expect(result.structuredContent).not.toHaveProperty('truncated');
  });

  it('gives up on a layout without lists to shorten', async () => {
    const layout = { main: { blob: 'x'.repeat(CHARACTER_LIMIT) } };
    adapter.getWorkspaceLayout = (): Record<string, unknown> => layout;
    const result = await run(createWorkspaceModule(adapter), 'workspace_get_layout', {
    });
    // The dispatcher's safety net caps this one.
    expect(textOf(result).length).toBeGreaterThan(CHARACTER_LIMIT);
    expect(result.structuredContent).not.toHaveProperty('truncated');
  });
});
