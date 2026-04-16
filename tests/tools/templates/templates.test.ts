import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createTemplatesModule } from '../../../src/tools/templates/index';

function getText(r: CallToolResult): string {
  return r.content[0].type === 'text' ? r.content[0].text : '';
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
