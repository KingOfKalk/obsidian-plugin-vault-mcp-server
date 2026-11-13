import { describe, it, expect, beforeEach } from 'vitest';
import { MockObsidianAdapter } from '../../helpers/mock-adapter';
import { createHandlers, WriteMutex } from '../../../src/tools/vault/handlers';
import { renameFileSchema } from '../../../src/tools/vault/schemas';
import { z } from 'zod';

describe('vault_rename updateTitle (#520)', () => {
  let adapter: MockObsidianAdapter;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
    handlers = createHandlers(adapter, new WriteMutex());
  });

  it('defaults to false in the schema', () => {
    const parsed = z.object(renameFileSchema).parse({ path: 'a.md', newName: 'b.md' });
    expect(parsed.updateTitle).toBe(false);
  });

  it.each(['a/b.md', 'a\\b.md', 'a\0b.md'])('the schema rejects newName %j (#557)', (newName) => {
    const result = z.object(renameFileSchema).safeParse({ path: 'a.md', newName });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'newName must not contain path separators or null bytes',
    );
  });

  it('leaves the heading alone and adds no field without the flag', async () => {
    adapter.addFile('notes/Draft.md', '# Draft\n\nBody');
    const result = await handlers.renameFile({ path: 'notes/Draft.md', newName: 'Final.md' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).not.toHaveProperty('titleUpdated');
    expect(await adapter.readFile('notes/Final.md')).toBe('# Draft\n\nBody');
  });

  it('replaces the first H1 when it equals the old name', async () => {
    adapter.addFile('notes/Draft.md', '# Draft\n\nBody\n\n# Draft\n');
    const result = await handlers.renameFile({
      path: 'notes/Draft.md',
      newName: 'Final.md',
      updateTitle: true,
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      from: 'notes/Draft.md',
      to: 'notes/Final.md',
      titleUpdated: true,
    });
    expect(await adapter.readFile('notes/Final.md')).toBe('# Final\n\nBody\n\n# Draft\n');
  });

  it('skips the frontmatter and keeps CRLF line endings and closing hashes', async () => {
    adapter.addFile('Old Name.md', '---\ntitle: x\n---\r\nIntro\r\n#  Old Name  ##\r\nText');
    const result = await handlers.renameFile({
      path: 'Old Name.md',
      newName: 'New Name.md',
      updateTitle: true,
    });
    expect(result.structuredContent).toMatchObject({ titleUpdated: true });
    expect(await adapter.readFile('New Name.md')).toBe(
      '---\ntitle: x\n---\r\nIntro\r\n#  New Name  ##\r\nText',
    );
  });

  it('ignores H1 lines inside code fences and lower-level headings', async () => {
    adapter.addFile('a.md', '## a\n```\n# a\n```\n# a\n');
    const result = await handlers.renameFile({ path: 'a.md', newName: 'b.md', updateTitle: true });
    expect(result.structuredContent).toMatchObject({ titleUpdated: true });
    expect(await adapter.readFile('b.md')).toBe('## a\n```\n# a\n```\n# b\n');
  });

  it('reports titleUpdated false and leaves the file when the first H1 differs', async () => {
    adapter.addFile('Draft.md', '# Something else\n\n# Draft\n');
    const result = await handlers.renameFile({ path: 'Draft.md', newName: 'Final.md', updateTitle: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ to: 'Final.md', titleUpdated: false });
    expect(await adapter.readFile('Final.md')).toBe('# Something else\n\n# Draft\n');
  });

  it('compares case-sensitively', async () => {
    adapter.addFile('Draft.md', '# draft\n');
    const result = await handlers.renameFile({ path: 'Draft.md', newName: 'Final.md', updateTitle: true });
    expect(result.structuredContent).toMatchObject({ titleUpdated: false });
    expect(await adapter.readFile('Final.md')).toBe('# draft\n');
  });

  it('reports titleUpdated false for a note without an H1', async () => {
    adapter.addFile('Draft.md', 'No heading');
    const result = await handlers.renameFile({ path: 'Draft.md', newName: 'Final.md', updateTitle: true });
    expect(result.structuredContent).toMatchObject({ titleUpdated: false });
  });

  it('reports titleUpdated false when the file is not Markdown before or after', async () => {
    adapter.addFile('Draft.txt', '# Draft\n');
    const txt = await handlers.renameFile({ path: 'Draft.txt', newName: 'Final.txt', updateTitle: true });
    expect(txt.structuredContent).toMatchObject({ titleUpdated: false });
    expect(await adapter.readFile('Final.txt')).toBe('# Draft\n');

    adapter.addFile('Note.md', '# Note\n');
    const toTxt = await handlers.renameFile({ path: 'Note.md', newName: 'Note.txt', updateTitle: true });
    expect(toTxt.structuredContent).toMatchObject({ titleUpdated: false });
    expect(await adapter.readFile('Note.txt')).toBe('# Note\n');
  });

  it('reports titleUpdated false for a folder', async () => {
    adapter.addFolder('wip');
    adapter.addFile('wip/wip.md', '# wip\n');
    const result = await handlers.renameFile({ path: 'wip', newName: 'done', updateTitle: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ to: 'done', titleUpdated: false });
    expect(await adapter.readFile('done/wip.md')).toBe('# wip\n');
  });

  it('does not rename or touch anything when the rename fails', async () => {
    adapter.addFile('Draft.md', '# Draft\n');
    adapter.addFile('Final.md', '# Final\n');
    const result = await handlers.renameFile({ path: 'Draft.md', newName: 'Final.md', updateTitle: true });
    expect(result.isError).toBe(true);
    expect(await adapter.readFile('Draft.md')).toBe('# Draft\n');
  });
});
