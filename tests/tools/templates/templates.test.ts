import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
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

  describe('response_format support', () => {
    it('documents response_format on template_list and template_expand', () => {
      const module = createTemplatesModule(adapter);
      const tools = module.tools();
      for (const name of ['template_list', 'template_expand']) {
        const tool = tools.find((t) => t.name === name)!;
        expect(tool.description).toContain('response_format (enum');
      }
    });

    it('template_list returns structuredContent with files when response_format=json', async () => {
      adapter.addFolder('templates');
      adapter.addFile('templates/a.md', 'a');
      adapter.addFile('templates/b.md', 'b');
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({ response_format: 'json' });
      expect(result.structuredContent).toEqual({
        files: ['templates/a.md', 'templates/b.md'],
      });
      const data = JSON.parse(getText(result)) as { files: string[] };
      expect(data.files).toEqual(['templates/a.md', 'templates/b.md']);
    });

    it('template_list markdown path stays a JSON array string for back-compat', async () => {
      adapter.addFolder('templates');
      adapter.addFile('templates/a.md', 'a');
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      const data = JSON.parse(getText(result)) as string[];
      expect(data).toEqual(['templates/a.md']);
      expect(result.structuredContent).toEqual({ files: ['templates/a.md'] });
    });

    it('template_list returns empty list with structuredContent when folder missing and json', async () => {
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({ response_format: 'json' });
      expect(result.structuredContent).toEqual({ files: [] });
    });

    it('template_expand returns structuredContent.expanded when response_format=json', async () => {
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_expand')!;
      const result = await tool.handler({
        template: 'Hello {{name}}',
        variables: { name: 'World' },
        response_format: 'json',
      });
      expect(result.structuredContent).toEqual({ expanded: 'Hello World' });
      const data = JSON.parse(getText(result)) as { expanded: string };
      expect(data.expanded).toBe('Hello World');
    });

    it('template_expand markdown path still returns the raw expanded string', async () => {
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_expand')!;
      const result = await tool.handler({
        template: 'Hello {{name}}',
        variables: { name: 'World' },
      });
      expect(getText(result)).toBe('Hello World');
      expect(result.structuredContent).toEqual({ expanded: 'Hello World' });
    });
  });
});

/**
 * Batch D of #248: every templates read tool that emits `structuredContent`
 * must declare an `outputSchema`. Strict-mode parsing catches drift between
 * the markdown renderer and the structured payload.
 */
describe('templates read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape | z.ZodTypeAny },
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    if (tool.outputSchema instanceof z.ZodType) {
      throw new Error('expected outputSchema to be a raw shape, not a full Zod schema');
    }
    return z.object(tool.outputSchema).strict();
  }

  it('template_list declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/daily.md', '# {{title}}');
    adapter.addFile('templates/meeting.md', '# Meeting on {{date}}');
    const tool = createTemplatesModule(adapter).tools().find((t) => t.name === 'template_list')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.files).toEqual(
      expect.arrayContaining(['templates/daily.md', 'templates/meeting.md']),
    );
  });

  it('template_list parses cleanly when templates folder is missing', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createTemplatesModule(adapter).tools().find((t) => t.name === 'template_list')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.files).toEqual([]);
  });

  it('template_expand declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createTemplatesModule(adapter).tools().find((t) => t.name === 'template_expand')!;
    const schema = getStructured(tool);

    const result = await tool.handler({
      template: 'Hello, {{name}}!',
      variables: { name: 'World' },
      response_format: 'json',
    });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.expanded).toBe('Hello, World!');
  });
});
