import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return { content: [{ type: 'text', text: `Error: ${m}` }], isError: true }; }

function createHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  return {
    getContent: (): Promise<CallToolResult> => {
      const content = adapter.getActiveFileContent();
      if (content === null) return Promise.resolve(err('No active editor'));
      return Promise.resolve(text(content));
    },
    getActivePath: (): Promise<CallToolResult> => {
      const path = adapter.getActiveFilePath();
      if (path === null) return Promise.resolve(err('No active file'));
      return Promise.resolve(text(path));
    },
    insert: (params): Promise<CallToolResult> => {
      const ok = adapter.insertTextAt(params.line as number, params.ch as number, params.text as string);
      return Promise.resolve(ok ? text('Text inserted') : err('No active editor'));
    },
    replace: (params): Promise<CallToolResult> => {
      const ok = adapter.replaceRange(
        params.fromLine as number, params.fromCh as number,
        params.toLine as number, params.toCh as number, params.text as string,
      );
      return Promise.resolve(ok ? text('Text replaced') : err('No active editor'));
    },
    deleteRange: (params): Promise<CallToolResult> => {
      const ok = adapter.deleteRange(
        params.fromLine as number, params.fromCh as number,
        params.toLine as number, params.toCh as number,
      );
      return Promise.resolve(ok ? text('Text deleted') : err('No active editor'));
    },
    getCursor: (): Promise<CallToolResult> => {
      const pos = adapter.getCursorPosition();
      if (!pos) return Promise.resolve(err('No active editor'));
      return Promise.resolve(text(JSON.stringify(pos)));
    },
    setCursor: (params): Promise<CallToolResult> => {
      const ok = adapter.setCursorPosition(params.line as number, params.ch as number);
      return Promise.resolve(ok ? text('Cursor set') : err('No active editor'));
    },
    getSelection: (): Promise<CallToolResult> => {
      const sel = adapter.getSelection();
      if (!sel) return Promise.resolve(err('No active editor or selection'));
      return Promise.resolve(text(JSON.stringify(sel)));
    },
    setSelection: (params): Promise<CallToolResult> => {
      const ok = adapter.setSelection(
        params.fromLine as number, params.fromCh as number,
        params.toLine as number, params.toCh as number,
      );
      return Promise.resolve(ok ? text('Selection set') : err('No active editor'));
    },
    getLineCount: (): Promise<CallToolResult> => {
      const count = adapter.getActiveLineCount();
      if (count === null) return Promise.resolve(err('No active editor'));
      return Promise.resolve(text(String(count)));
    },
  };
}

export function createEditorModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'editor', name: 'Editor Operations', description: 'Access and manipulate the active editor', supportsReadOnly: true },
    tools(): ToolDefinition[] {
      return [
        { name: 'editor_get_content', description: 'Get content of active editor', schema: {}, handler: h.getContent, isReadOnly: true },
        { name: 'editor_get_active_file', description: 'Get active file path', schema: {}, handler: h.getActivePath, isReadOnly: true },
        { name: 'editor_insert', description: 'Insert text at position', schema: { line: z.number(), ch: z.number(), text: z.string() }, handler: h.insert, isReadOnly: false },
        { name: 'editor_replace', description: 'Replace text in range', schema: { fromLine: z.number(), fromCh: z.number(), toLine: z.number(), toCh: z.number(), text: z.string() }, handler: h.replace, isReadOnly: false },
        { name: 'editor_delete', description: 'Delete text in range', schema: { fromLine: z.number(), fromCh: z.number(), toLine: z.number(), toCh: z.number() }, handler: h.deleteRange, isReadOnly: false },
        { name: 'editor_get_cursor', description: 'Get cursor position', schema: {}, handler: h.getCursor, isReadOnly: true },
        { name: 'editor_set_cursor', description: 'Set cursor position', schema: { line: z.number(), ch: z.number() }, handler: h.setCursor, isReadOnly: false },
        { name: 'editor_get_selection', description: 'Get current selection', schema: {}, handler: h.getSelection, isReadOnly: true },
        { name: 'editor_set_selection', description: 'Set selection range', schema: { fromLine: z.number(), fromCh: z.number(), toLine: z.number(), toCh: z.number() }, handler: h.setSelection, isReadOnly: false },
        { name: 'editor_get_line_count', description: 'Get line count of active editor', schema: {}, handler: h.getLineCount, isReadOnly: true },
      ];
    },
  };
}
