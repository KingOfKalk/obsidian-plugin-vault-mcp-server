import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/server';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { createSearchHandlers } from '../../../src/tools/search/handlers';
import { createTemplatesModule } from '../../../src/tools/templates/index';

/**
 * Every content-writing tool returns `modified`, so conflict-checked
 * writes can be chained with `expectedMtime` (#447).
 */
describe('write tools return modified (#447)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex(), createSearchHandlers(adapter));
  });

  async function mtimeIso(path: string): Promise<string> {
    const stat = await adapter.stat(path);
    return new Date(stat!.mtime).toISOString();
  }

  function modifiedOf(result: CallToolResult): string {
    expect(result.isError).toBeUndefined();
    return (result.structuredContent as { modified: string }).modified;
  }

  /** The returned value must be accepted as expectedMtime by the next write. */
  async function expectChainable(path: string, modified: string): Promise<void> {
    const next = await handlers.updateFile({ path, content: 'next', expectedMtime: modified });
    expect(next.isError).toBeUndefined();
  }

  it('vault_create', async () => {
    const result = await handlers.createFile({ path: 'a.md', content: 'x' });
    expect(result.structuredContent).toEqual({
      path: 'a.md',
      created: true,
      modified: await mtimeIso('a.md'),
    });
    await expectChainable('a.md', modifiedOf(result));
  });

  it('vault_update', async () => {
    adapter.addFile('a.md', 'old', { mtime: 1000 });
    const result = await handlers.updateFile({ path: 'a.md', content: 'new' });
    expect(result.structuredContent).toEqual({
      path: 'a.md',
      updated: true,
      modified: await mtimeIso('a.md'),
    });
    expect(modifiedOf(result)).not.toBe(new Date(1000).toISOString());
    await expectChainable('a.md', modifiedOf(result));
  });

  it('vault_write_binary', async () => {
    const result = await handlers.writeBinary({ path: 'a.bin', data: 'AAEC' });
    expect(result.structuredContent).toEqual({
      path: 'a.bin',
      sizeBytes: 3,
      modified: await mtimeIso('a.bin'),
    });
    const next = await handlers.writeBinary({
      path: 'a.bin',
      data: 'AAE=',
      expectedMtime: modifiedOf(result),
    });
    expect(next.isError).toBeUndefined();
  });

  it.each([false, true])('template_create_from (frontmatter=%s)', async (withFrontmatter) => {
    adapter.addFile('templates/t.md', '# {{title}}\n');
    const tool = createTemplatesModule(adapter)
      .tools()
      .find((t) => t.name === 'template_create_from')!;
    const result = await tool.handler({
      templatePath: 'templates/t.md',
      destPath: 'notes/new.md',
      variables: { title: 'New' },
      ...(withFrontmatter ? { frontmatter: { status: 'draft' } } : {}),
    });
    expect(result.structuredContent).toMatchObject({
      path: 'notes/new.md',
      modified: await mtimeIso('notes/new.md'),
    });
    await expectChainable('notes/new.md', modifiedOf(result));
  });
});
