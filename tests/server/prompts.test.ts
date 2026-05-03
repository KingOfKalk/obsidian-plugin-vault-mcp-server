import { describe, it, expect } from 'vitest';
import { extractPlaceholders } from '../../src/server/prompts';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { PathTraversalError } from '../../src/utils/path-guard';
import {
  createSummarizeNoteHandler,
  createFindRelatedHandler,
  createExpandTemplateHandler,
  createTemplateCompleter,
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
  it('returns a single user-role text message naming search_fulltext and vault_get_backlinks', async () => {
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
    expect(text).toContain('vault_get_backlinks');
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
