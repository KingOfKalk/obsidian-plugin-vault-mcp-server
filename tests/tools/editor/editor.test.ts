import { describe, it, expect, beforeEach } from 'vitest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createEditorModule } from '../../../src/tools/editor/index';

function getText(r: CallToolResult): string {
  return r.content[0].type === 'text' ? r.content[0].text : '';
}

describe('editor module', () => {
  let adapter: MockObsidianAdapter;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
  });

  it('should register 10 tools', () => {
    const module = createEditorModule(adapter);
    expect(module.tools()).toHaveLength(10);
  });

  it('should have 5 read-only tools', () => {
    const module = createEditorModule(adapter);
    expect(module.tools().filter((t) => t.isReadOnly)).toHaveLength(5);
  });

  describe('handlers', () => {
    it('should return error when no editor is active', async () => {
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_get_content')!;
      const result = await tool.handler({});
      expect(result.isError).toBe(true);
    });

    it('should get editor content', async () => {
      adapter.setActiveEditor('test.md', '# Hello\nWorld');
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_get_content')!;
      const result = await tool.handler({});
      expect(getText(result)).toBe('# Hello\nWorld');
    });

    it('should get active file path', async () => {
      adapter.setActiveEditor('notes/test.md', 'content');
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_get_active_file')!;
      const result = await tool.handler({});
      expect(getText(result)).toBe('notes/test.md');
    });

    it('should get line count', async () => {
      adapter.setActiveEditor('test.md', 'line1\nline2\nline3');
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_get_line_count')!;
      const result = await tool.handler({});
      expect(getText(result)).toBe('3');
    });

    it('should insert text', async () => {
      adapter.setActiveEditor('test.md', 'Hello World');
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_insert')!;
      await tool.handler({ line: 0, ch: 5, text: ' Beautiful' });
      expect(adapter.getActiveFileContent()).toBe('Hello Beautiful World');
    });

    it('should get and set cursor', async () => {
      adapter.setActiveEditor('test.md', 'Hello');
      const module = createEditorModule(adapter);
      const setCursor = module.tools().find((t) => t.name === 'editor_set_cursor')!;
      await setCursor.handler({ line: 0, ch: 3 });
      const getCursor = module.tools().find((t) => t.name === 'editor_get_cursor')!;
      const result = await getCursor.handler({});
      const pos = JSON.parse(getText(result)) as { line: number; ch: number };
      expect(pos).toEqual({ line: 0, ch: 3 });
    });
  });
});
