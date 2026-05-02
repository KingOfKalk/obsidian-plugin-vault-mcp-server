import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { ListResult } from '../../../src/obsidian/adapter';
import { createTemplatesModule } from '../../../src/tools/templates/index';
import { PermissionError } from '../../../src/tools/shared/errors';

function getText(r: CallToolResult): string {
  return r.content[0].type === 'text' ? r.content[0].text : '';
}

class ListThrowingAdapter extends MockObsidianAdapter {
  constructor(private readonly toThrow: unknown) {
    super();
  }
  override list(_path: string): ListResult {
    throw this.toThrow;
  }
}

describe('templates module', () => {
  let adapter: MockObsidianAdapter;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
  });

  it('should register 3 tools', () => {
    const module = createTemplatesModule(adapter);
    expect(module.tools()).toHaveLength(3);
  });

  it('should list templates', async () => {
    adapter.addFolder('templates');
    adapter.addFile('templates/daily.md', '# {{date}}');
    adapter.addFile('templates/weekly.md', '# Week of {{date}}');
    const module = createTemplatesModule(adapter);
    const tool = module.tools().find((t) => t.name === 'template_list')!;
    const result = await tool.handler({});
    const data = JSON.parse(getText(result)) as string[];
    expect(data).toHaveLength(2);
  });

  describe('template_list error handling', () => {
    // (a) Folder missing → handler returns [].
    it('returns [] when the templates folder is missing', async () => {
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      expect(result.isError).toBeUndefined();
      expect(getText(result)).toBe('[]');
    });

    // (b) Folder present + empty → handler returns [].
    it('returns [] when the templates folder exists but is empty', async () => {
      adapter.addFolder('templates');
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      expect(result.isError).toBeUndefined();
      expect(getText(result)).toBe(JSON.stringify([]));
    });

    // (c) Folder present + populated → returns the file list as JSON.
    it('returns the file list as JSON when the folder is populated', async () => {
      adapter.addFolder('templates');
      adapter.addFile('templates/a.md', 'a');
      adapter.addFile('templates/b.md', 'b');
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(getText(result)) as string[];
      expect(data).toEqual(['templates/a.md', 'templates/b.md']);
    });

    // (d) Permission denied → handleToolError envelope.
    it('surfaces PermissionError through handleToolError', async () => {
      const throwing = new ListThrowingAdapter(new PermissionError('templates'));
      const module = createTemplatesModule(throwing);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Permission denied');
    });

    // (e) Unexpected error → handleToolError envelope.
    it('surfaces unexpected errors through handleToolError', async () => {
      const throwing = new ListThrowingAdapter(new Error('boom'));
      const module = createTemplatesModule(throwing);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('boom');
    });
  });

  it('should create from template with variable substitution', async () => {
    adapter.addFolder('templates');
    adapter.addFile('templates/note.md', '# {{title}}\nCreated: {{date}}');
    const module = createTemplatesModule(adapter);
    const tool = module.tools().find((t) => t.name === 'template_create_from')!;
    const result = await tool.handler({
      templatePath: 'templates/note.md',
      destPath: 'notes/new.md',
      variables: { title: 'My Note' },
    });
    expect(result.isError).toBeUndefined();
    const content = await adapter.readFile('notes/new.md');
    expect(content).toContain('# My Note');
    expect(content).toContain('Created:');
    expect(content).not.toContain('{{title}}');
  });

  it('should expand template variables', async () => {
    const module = createTemplatesModule(adapter);
    const tool = module.tools().find((t) => t.name === 'template_expand')!;
    const result = await tool.handler({
      template: 'Hello {{name}}, today is {{date}}',
      variables: { name: 'World' },
    });
    const text = getText(result);
    expect(text).toContain('Hello World');
    expect(text).not.toContain('{{name}}');
    expect(text).not.toContain('{{date}}');
  });
});
