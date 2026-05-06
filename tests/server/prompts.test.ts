import { describe, it, expect } from 'vitest';
import { extractPlaceholders } from '../../src/server/prompts';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { PathTraversalError } from '../../src/utils/path-guard';
import {
  createSummarizeNoteHandler,
  createFindRelatedHandler,
  createExpandTemplateHandler,
  createTemplateCompleter,
  createDailyNoteHandler,
  createFixBrokenLinksHandler,        // NEW
  createUnresolvedSourcesCompleter,   // NEW (used by Task 4 — adding here keeps the import block edited once)
} from '../../src/server/prompts';
describe('extractPlaceholders', () => {
  it('returns [] for an empty body', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });

  it('returns [] when no placeholders are present', () => {
    expect(extractPlaceholders('# Hello world\n\nNo placeholders here.')).toEqual([]);
  });

  it('extracts a single placeholder', () => {
    expect(extractPlaceholders('# {{name}}')).toEqual(['name']);
  });

  it('dedupes repeated placeholders, preserving first-seen order', () => {
    expect(extractPlaceholders('{{a}}{{a}}{{b}}{{a}}')).toEqual(['a', 'b']);
  });

  it('preserves first-seen order across distinct placeholders', () => {
    expect(extractPlaceholders('{{b}} then {{a}} then {{c}}')).toEqual(['b', 'a', 'c']);
  });

  it('strips the built-ins date, time, title that template_expand auto-resolves', () => {
    expect(extractPlaceholders('{{date}} {{title}} {{author}} {{time}}')).toEqual(['author']);
  });

  it('does not match placeholders with whitespace inside the braces', () => {
    expect(extractPlaceholders('{{ name }}')).toEqual([]);
  });

  it('does not match unbalanced or empty braces', () => {
    expect(extractPlaceholders('{{name')).toEqual([]);
    expect(extractPlaceholders('{{}}')).toEqual([]);
    expect(extractPlaceholders('{name}')).toEqual([]);
  });

  it('matches identifier-style names (letters, digits, underscore; must start with letter or underscore)', () => {
    expect(extractPlaceholders('{{a1}} {{_b}} {{c_d}}')).toEqual(['a1', '_b', 'c_d']);
    // leading digit is invalid
    expect(extractPlaceholders('{{1foo}}')).toEqual([]);
  });
});

describe('summarize-note handler', () => {
  it('returns a single user-role text message naming vault_read and the path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createSummarizeNoteHandler(adapter);

    const result = await handler({ path: 'notes/foo.md' });

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = (message.content as { type: 'text'; text: string }).text;
    expect(text).toContain('notes/foo.md');
    expect(text).toContain('vault_read');
  });

  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createSummarizeNoteHandler(adapter);

    await expect(handler({ path: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
});

describe('find-related handler', () => {
  it('returns a single user-role text message naming search_fulltext and vault_get_aspect', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFindRelatedHandler(adapter);

    const result = await handler({ path: 'notes/foo.md' });

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = (message.content as { type: 'text'; text: string }).text;
    expect(text).toContain('notes/foo.md');
    expect(text).toContain('search_fulltext');
    expect(text).toContain('vault_get_aspect');
    expect(text).toContain('backlinks');
  });

  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFindRelatedHandler(adapter);

    await expect(handler({ path: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
});

describe('expand-template handler', () => {
  it('lists user-fillable placeholders from a template', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/weekly.md', '# {{title}} for {{week}}\n\n{{notes}}');
    const handler = createExpandTemplateHandler(adapter);

    const result = await handler({ template: 'templates/weekly.md' });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text).toContain('templates/weekly.md');
    expect(text).toContain('week');
    expect(text).toContain('notes');
    // built-in `title` must not be listed as a user-fillable placeholder
    expect(text).not.toMatch(/placeholders[^.]*title/);
    expect(text).toContain('template_expand');
    expect(text).toContain('template_create_from');
  });

  it('handles templates with only built-ins by saying there are no user-fillable placeholders', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/today.md', '{{date}} {{time}}');
    const handler = createExpandTemplateHandler(adapter);

    const result = await handler({ template: 'templates/today.md' });

    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text.toLowerCase()).toContain('no user-fillable placeholders');
  });

  it('dedupes placeholders mentioned multiple times', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/dup.md', '{{a}}{{a}}{{b}}');
    const handler = createExpandTemplateHandler(adapter);

    const result = await handler({ template: 'templates/dup.md' });

    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    // Look for the placeholders list "a, b" (with no extra "a")
    expect(text).toMatch(/`a, b`/);
  });

  it('propagates an error when the template is missing', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    const handler = createExpandTemplateHandler(adapter);

    // MockObsidianAdapter.readFile throws plain Error on missing files.
    // The handler shouldn't transform the error; the SDK maps whatever
    // throws into a prompts/get error response. We assert the throw, not
    // the type, because the real adapter may throw FileNotFoundError
    // while the mock throws plain Error — both surface as errors to MCP.
    await expect(handler({ template: 'templates/missing.md' })).rejects.toThrow();
  });

  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createExpandTemplateHandler(adapter);

    await expect(handler({ template: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
});

describe('templateCompleter', () => {
  it('returns up to 100 entries from templates/ for an empty partial', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    for (let i = 0; i < 150; i++) {
      adapter.addFile(`templates/t${String(i)}.md`, `body ${String(i)}`);
    }
    const completer = createTemplateCompleter(adapter);

    const result = await completer('');

    expect(result.length).toBe(100);
  });

  it('filters by case-insensitive substring match', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/Weekly.md', '');
    adapter.addFile('templates/Daily.md', '');
    adapter.addFile('templates/Monthly.md', '');
    const completer = createTemplateCompleter(adapter);

    const result = await completer('weEK');

    expect(result).toEqual(['templates/Weekly.md']);
  });

  it('returns [] when the templates folder is missing (no throw)', async () => {
    const adapter = new MockObsidianAdapter();
    // No `templates` folder added.
    const completer = createTemplateCompleter(adapter);

    const result = await completer('anything');

    expect(result).toEqual([]);
  });
});

describe('daily-note handler', () => {
  it('returns one user-role text message naming vault_daily_note and workspace_open_file', async () => {
    const handler = createDailyNoteHandler();
    const result = await handler({});
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = (message.content as { type: 'text'; text: string }).text;
    expect(text).toContain('vault_daily_note');
    expect(text).toContain('workspace_open_file');
    expect(text.toLowerCase()).toContain('daily note');
  });

  it('threads the date argument into the message text', async () => {
    const handler = createDailyNoteHandler();
    const result = await handler({ date: '2026-05-05' });
    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text).toContain('2026-05-05');
  });

  it('rejects malformed date arguments', async () => {
    const handler = createDailyNoteHandler();
    await expect(handler({ date: 'not-a-date' })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('fix-broken-links handler', () => {
  it('returns the vault-wide body when called with no path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFixBrokenLinksHandler(adapter);

    const result = await handler({});

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = (message.content as { type: 'text'; text: string }).text;
    expect(text).toContain('Fix broken links across the vault');
    expect(text).toContain('search_unresolved_links');
    expect(text).toContain('vault_create');
    expect(text).toContain('vault_update');
    expect(text).toContain('Retarget');
    expect(text).toContain('Create a stub');
    expect(text).toContain('Delete the link');
    expect(text).toContain('Leave as-is');
    expect(text).toContain('~20');
    expect(text).toContain('one at a time');
    // Single-note opener must NOT appear in the vault-wide body
    expect(text).not.toContain('Fix broken links in `');
  });

  it('returns the single-note body when called with a path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFixBrokenLinksHandler(adapter);

    const result = await handler({ path: 'notes/foo.md' });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text).toContain('Fix broken links in `notes/foo.md`');
    expect(text).toContain('search_unresolved_links');
    expect(text).toContain('pull out the entry whose source matches');
    expect(text).toContain('tell the user the note has no unresolved links and stop');
    expect(text).toContain('Retarget');
    expect(text).toContain('Create a stub');
    expect(text).toContain('Delete the link');
    expect(text).toContain('Leave as-is');
    expect(text).toContain('one at a time');
    // Vault-wide opener must NOT appear in the single-note body
    expect(text).not.toContain('Fix broken links across the vault');
  });

  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFixBrokenLinksHandler(adapter);

    await expect(handler({ path: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
});

describe('unresolvedSourcesCompleter', () => {
  it('returns [] when the adapter reports no unresolved links', async () => {
    const adapter = new MockObsidianAdapter();
    // No files, so getUnresolvedLinks() returns {}.
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('');

    expect(result).toEqual([]);
  });

  it('filters by case-insensitive substring match on the source path', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('notes/Weekly.md', '');
    adapter.setMetadata('notes/Weekly.md', { links: [{ link: 'missing-target' }] });
    adapter.addFile('notes/Daily.md', '');
    adapter.setMetadata('notes/Daily.md', { links: [{ link: 'also-missing' }] });
    adapter.addFile('notes/Monthly.md', '');
    adapter.setMetadata('notes/Monthly.md', { links: [{ link: 'still-missing' }] });
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('weEK');

    expect(result).toEqual(['notes/Weekly.md']);
  });

  it('caps results at 100', async () => {
    const adapter = new MockObsidianAdapter();
    for (let i = 0; i < 150; i++) {
      const path = `notes/n${String(i)}.md`;
      adapter.addFile(path, '');
      adapter.setMetadata(path, { links: [{ link: `missing-${String(i)}` }] });
    }
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('');

    expect(result.length).toBe(100);
  });

  it('returns [] when getUnresolvedLinks throws (no propagation)', async () => {
    const adapter = new MockObsidianAdapter();
    // Replace getUnresolvedLinks with a throwing stub. Cast through unknown
    // to satisfy strict typing without modifying the real adapter surface.
    (adapter as unknown as { getUnresolvedLinks: () => never }).getUnresolvedLinks = (): never => {
      throw new Error('boom');
    };
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('anything');

    expect(result).toEqual([]);
  });
});
