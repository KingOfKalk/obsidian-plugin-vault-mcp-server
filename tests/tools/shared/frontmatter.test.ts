import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../helpers/mock-adapter';
import {
  applyFrontmatter,
  assertMarkdownPath,
} from '../../../src/tools/shared/frontmatter';

describe('assertMarkdownPath', () => {
  it('accepts .md in any case', () => {
    expect(() => assertMarkdownPath('notes/a.md')).not.toThrow();
    expect(() => assertMarkdownPath('notes/A.MD')).not.toThrow();
  });

  it('rejects other files', () => {
    expect(() => assertMarkdownPath('data.json')).toThrow(
      'Frontmatter can only be set on Markdown (.md) files',
    );
  });
});

describe('applyFrontmatter', () => {
  it('sets and removes keys and returns the whole frontmatter', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', '---\ntitle: Note\ndraft: true\n---\nBody');
    const frontmatter = await applyFrontmatter(adapter, 'note.md', { status: 'done' }, ['draft']);
    expect(frontmatter).toEqual({ title: 'Note', status: 'done' });
    expect(await adapter.readFile('note.md')).toContain('status: done');
  });

  it('only sets keys when remove is omitted', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('note.md', 'Body');
    expect(await applyFrontmatter(adapter, 'note.md', { tags: ['a', 'b'] })).toEqual({
      tags: ['a', 'b'],
    });
  });
});
