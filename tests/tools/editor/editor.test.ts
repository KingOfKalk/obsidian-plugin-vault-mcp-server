import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
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
    expect(module.tools().filter((t) => t.annotations.readOnlyHint)).toHaveLength(5);
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
      expect(getText(result)).toBe('totalLength: 13\noffset: 0\nhasMore: false\n\n# Hello\nWorld');
      expect(result.structuredContent).toBeUndefined();
    });

    it('should get active file path', async () => {
      adapter.setActiveEditor('notes/test.md', 'content');
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_get_active_file')!;
      const result = await tool.handler({});
      expect(getText(result)).toBe('{"path":"notes/test.md"}');
    });

    it('should get line count', async () => {
      adapter.setActiveEditor('test.md', 'line1\nline2\nline3');
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_get_line_count')!;
      const result = await tool.handler({});
      expect(getText(result)).toBe('{"lineCount":3}');
    });

    it('should insert text', async () => {
      adapter.setActiveEditor('test.md', 'Hello World');
      const module = createEditorModule(adapter);
      const tool = module.tools().find((t) => t.name === 'editor_insert')!;
      await tool.handler({ line: 0, ch: 5, text: ' Beautiful' });
      expect(adapter.getActiveFileContent()).toBe('Hello Beautiful World');
    });

    it('should get and set cursor (json format)', async () => {
      adapter.setActiveEditor('test.md', 'Hello');
      const module = createEditorModule(adapter);
      const setCursor = module.tools().find((t) => t.name === 'editor_set_cursor')!;
      await setCursor.handler({ line: 0, ch: 3 });
      const getCursor = module.tools().find((t) => t.name === 'editor_get_cursor')!;
      const result = await getCursor.handler({});
      const pos = JSON.parse(getText(result)) as { line: number; ch: number };
      expect(pos).toEqual({ line: 0, ch: 3 });
    });

    describe('bounds checking', () => {
      it('rejects negative line in editor_set_cursor', async () => {
        adapter.setActiveEditor('test.md', 'line1\nline2');
        const module = createEditorModule(adapter);
        const tool = module.tools().find((t) => t.name === 'editor_set_cursor')!;
        const result = await tool.handler({ line: -1, ch: 0 });
        expect(result.isError).toBe(true);
        expect(getText(result)).toContain('non-negative');
      });

      it('rejects line beyond EOF in editor_set_cursor', async () => {
        adapter.setActiveEditor('test.md', 'line1\nline2'); // lineCount === 2
        const module = createEditorModule(adapter);
        const tool = module.tools().find((t) => t.name === 'editor_set_cursor')!;
        const result = await tool.handler({ line: 99, ch: 0 });
        expect(result.isError).toBe(true);
        expect(getText(result)).toContain('out of range');
      });

      it('rejects non-integer positions in editor_insert', async () => {
        adapter.setActiveEditor('test.md', 'hello');
        const module = createEditorModule(adapter);
        const tool = module.tools().find((t) => t.name === 'editor_insert')!;
        const result = await tool.handler({ line: 0.5, ch: 0, text: 'x' });
        expect(result.isError).toBe(true);
      });

      it('accepts editor_insert at the last valid line', async () => {
        adapter.setActiveEditor('test.md', 'line1\nline2\nline3');
        const module = createEditorModule(adapter);
        const tool = module.tools().find((t) => t.name === 'editor_insert')!;
        // lineCount === 3 → line index 2 is the last valid line.
        const result = await tool.handler({ line: 2, ch: 0, text: 'x' });
        expect(result.isError).toBeUndefined();
      });

      it('rejects out-of-range fromLine in editor_replace', async () => {
        adapter.setActiveEditor('test.md', 'only');
        const module = createEditorModule(adapter);
        const tool = module.tools().find((t) => t.name === 'editor_replace')!;
        const result = await tool.handler({
          fromLine: 5,
          fromCh: 0,
          toLine: 5,
          toCh: 1,
          text: 'x',
        });
        expect(result.isError).toBe(true);
        expect(getText(result)).toContain('out of range');
      });

      it('rejects negative toCh in editor_delete', async () => {
        adapter.setActiveEditor('test.md', 'hello');
        const module = createEditorModule(adapter);
        const tool = module.tools().find((t) => t.name === 'editor_delete')!;
        const result = await tool.handler({
          fromLine: 0,
          fromCh: 0,
          toLine: 0,
          toCh: -1,
        });
        expect(result.isError).toBe(true);
      });
    });
  });
});

/**
 * Batch C of #248: every editor read tool that emits `structuredContent`
 * must declare an `outputSchema`, and that schema must accurately describe
 * the payload the handler produces. Strict-mode parsing catches drift
 * between the markdown renderer and the structured payload.
 */
describe('editor read tools — outputSchema declarations', () => {
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

  it('editor_get_content is a document tool without outputSchema (#467)', () => {
    const tools = createEditorModule(new MockObsidianAdapter()).tools();
    for (const tool of tools) {
      if (tool.name === 'editor_get_content') expect(tool.outputSchema).toBeUndefined();
      else expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it('editor_get_active_file declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('notes/today.md', 'content');
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_active_file')!;
    const schema = getStructured(tool);

    const result = await tool.handler({});
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.path).toBe('notes/today.md');
  });

  it('editor_get_cursor declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('note.md', 'one\ntwo\nthree');
    adapter.setCursorPosition(1, 2);
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_cursor')!;
    const schema = getStructured(tool);

    const result = await tool.handler({});
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.line).toBe(1);
    expect(parsed.ch).toBe(2);
  });

  it('editor_get_selection declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('note.md', 'one\ntwo\nthree');
    adapter.setSelection(0, 0, 0, 3);
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_selection')!;
    const schema = getStructured(tool);

    const result = await tool.handler({});
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.from).toEqual({ line: 0, ch: 0 });
    expect(parsed.to).toEqual({ line: 0, ch: 3 });
    expect(parsed.text).toBe('one');
  });

  it('editor_get_line_count declares outputSchema and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.setActiveEditor('note.md', 'one\ntwo\nthree');
    const tool = createEditorModule(adapter).tools().find((t) => t.name === 'editor_get_line_count')!;
    const schema = getStructured(tool);

    const result = await tool.handler({});
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.lineCount).toBe(3);
  });
});
