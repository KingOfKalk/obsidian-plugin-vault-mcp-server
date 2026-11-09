import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
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
    const data = JSON.parse(getText(result)) as { files: string[] };
    expect(data.files).toHaveLength(2);
  });

  describe('template_list error handling', () => {
    // (a) Folder missing → handler returns [].
    it('returns [] when the templates folder is missing', async () => {
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      expect(result.isError).toBeUndefined();
      expect(getText(result)).toBe('{"files":[]}');
    });

    // (b) Folder present + empty → handler returns [].
    it('returns [] when the templates folder exists but is empty', async () => {
      adapter.addFolder('templates');
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_list')!;
      const result = await tool.handler({});
      expect(result.isError).toBeUndefined();
      expect(getText(result)).toBe('{"files":[]}');
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
      const data = JSON.parse(getText(result)) as { files: string[] };
      expect(data.files).toEqual(['templates/a.md', 'templates/b.md']);
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
    // The missing destination folder is created (#405).
    expect(await adapter.exists('notes')).toBe(true);
    const content = await adapter.readFile('notes/new.md');
    expect(content).toContain('# My Note');
    expect(content).toContain('Created:');
    expect(content).not.toContain('{{title}}');
  });

  describe('template_create_from with frontmatter (#431)', () => {
    function createTool(): ReturnType<ReturnType<typeof createTemplatesModule>['tools']>[number] {
      return createTemplatesModule(adapter).tools().find((t) => t.name === 'template_create_from')!;
    }

    it('sets frontmatter on the new note in the same call, keeping template keys', async () => {
      adapter.addFolder('templates');
      adapter.addFile('templates/person.md', '---\ntype: person\nemail: tbd\n---\n# {{title}}\n');
      const result = await createTool().handler({
        templatePath: 'templates/person.md',
        destPath: 'people/ada.md',
        variables: { title: 'Ada' },
        frontmatter: { eid: 42, email: 'ada@example.com', tags: ['team'] },
      });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
      expect(result.structuredContent).toEqual({
        path: 'people/ada.md',
        templatePath: 'templates/person.md',
        frontmatter: { type: 'person', email: 'ada@example.com', eid: 42, tags: ['team'] },
        modified: expect.any(String) as unknown,
      });
      expect(adapter.getFrontmatter('people/ada.md')).toEqual({
        type: 'person',
        email: 'ada@example.com',
        eid: 42,
        tags: ['team'],
      });
      const content = await adapter.readFile('people/ada.md');
      expect(content).toContain('# Ada');
      expect(content).toContain('email: ada@example.com');
    });

    it('creates the frontmatter block when the template has none', async () => {
      adapter.addFile('templates/plain.md', 'Body');
      const result = await createTool().handler({
        templatePath: 'templates/plain.md',
        destPath: 'plain.md',
        frontmatter: { status: 'new' },
      });
      expect(result.isError).toBeUndefined();
      expect(await adapter.readFile('plain.md')).toBe('---\nstatus: new\n---\nBody');
    });

    it('omits frontmatter from the result when none (or {}) is given', async () => {
      adapter.addFile('templates/plain.md', 'Body');
      const result = await createTool().handler({
        templatePath: 'templates/plain.md',
        destPath: 'plain.md',
        frontmatter: {},
      });
      expect(result.structuredContent).toEqual({
        path: 'plain.md',
        templatePath: 'templates/plain.md',
        modified: expect.any(String) as unknown,
      });
      expect(await adapter.readFile('plain.md')).toBe('Body');
    });

    it('rejects frontmatter for a non-Markdown destination without creating the file', async () => {
      adapter.addFile('templates/data.txt', 'x');
      const result = await createTool().handler({
        templatePath: 'templates/data.txt',
        destPath: 'out.txt',
        frontmatter: { a: 1 },
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Frontmatter can only be set on Markdown (.md) files');
      expect(await adapter.exists('out.txt')).toBe(false);
    });

    it('rejects prototype keys without creating the file', async () => {
      adapter.addFile('templates/plain.md', 'Body');
      const result = await createTool().handler({
        templatePath: 'templates/plain.md',
        destPath: 'plain.md',
        frontmatter: JSON.parse('{"__proto__": 1}') as Record<string, unknown>,
      });
      expect(result.isError).toBe(true);
      expect(getText(result)).toContain('Invalid frontmatter key: __proto__');
      expect(await adapter.exists('plain.md')).toBe(false);
    });

    it('declares the frontmatter field in its outputSchema', async () => {
      adapter.addFile('templates/plain.md', 'Body');
      const tool = createTool();
      const result = await tool.handler({
        templatePath: 'templates/plain.md',
        destPath: 'plain.md',
        frontmatter: { status: 'new' },
      });
      const schema = z.object(tool.outputSchema as z.ZodRawShape).strict();
      expect(schema.parse(result.structuredContent)).toEqual({
        path: 'plain.md',
        templatePath: 'templates/plain.md',
        frontmatter: { status: 'new' },
        modified: expect.any(String) as unknown,
      });
    });
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

  describe('result formats (#467)', () => {
    it('takes no responseFormat', () => {
      for (const tool of createTemplatesModule(adapter).tools()) {
        expect(Object.keys(tool.schema), tool.name).not.toContain('responseFormat');
      }
    });

    it('template_expand returns only the expanded text, without structuredContent', async () => {
      const module = createTemplatesModule(adapter);
      const tool = module.tools().find((t) => t.name === 'template_expand')!;
      expect(tool.outputSchema).toBeUndefined();
      const result = await tool.handler({
        template: 'Hello {{name}}\n"quoted"',
        variables: { name: 'World' },
      });
      expect(result.content).toEqual([{ type: 'text', text: 'Hello World\n"quoted"' }]);
      expect(result.structuredContent).toBeUndefined();
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

    const result = await tool.handler({});
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.files).toEqual(
      expect.arrayContaining(['templates/daily.md', 'templates/meeting.md']),
    );
  });

  it('template_list parses cleanly when templates folder is missing', async () => {
    const adapter = new MockObsidianAdapter();
    const tool = createTemplatesModule(adapter).tools().find((t) => t.name === 'template_list')!;
    const schema = getStructured(tool);

    const result = await tool.handler({});
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.files).toEqual([]);
  });


});
