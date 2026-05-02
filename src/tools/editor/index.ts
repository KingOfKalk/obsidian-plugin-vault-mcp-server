import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
  type InferredParams,
} from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';
import {
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

/**
 * Require a value to be a non-negative safe integer. Kept as a runtime guard
 * alongside the Zod schema; the dispatcher has already parsed numbers by the
 * time the handler is called, but the helper is useful in other call sites.
 */
function isNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/**
 * Validate a `(line, ch)` position against the editor's current line count.
 * `allowEnd` extends the upper line bound by one to cover operations that can
 * legitimately target EOF (e.g. inserting at the end of the last line).
 */
function assertEditorPosition(
  line: unknown,
  ch: unknown,
  lineCount: number,
  { allowEnd = false }: { allowEnd?: boolean } = {},
): void {
  if (!isNonNegativeInt(line) || !isNonNegativeInt(ch)) {
    throw new RangeError('Position must be a non-negative integer pair');
  }
  const maxLine = allowEnd ? lineCount : lineCount - 1;
  if (line > maxLine) {
    throw new RangeError('Position is out of range for the active editor');
  }
}

// Schemas as module-level consts so handler signatures can reference them
// via `typeof <schema>` for automatic parameter typing through
// `InferredParams<Shape>`.

const readOnlySchema = { ...responseFormatField };

const insertSchema = {
  line: z.number().int().min(0).describe('Zero-based line index'),
  ch: z.number().int().min(0).describe('Zero-based column index'),
  text: z
    .string()
    .max(5_000_000)
    .describe('Text to insert at (line, ch)'),
};

const replaceSchema = {
  fromLine: z.number().int().min(0).describe('Start line (inclusive, zero-based)'),
  fromCh: z.number().int().min(0).describe('Start column (inclusive, zero-based)'),
  toLine: z.number().int().min(0).describe('End line (exclusive, zero-based)'),
  toCh: z.number().int().min(0).describe('End column (exclusive, zero-based)'),
  text: z
    .string()
    .max(5_000_000)
    .describe('Replacement text for the range'),
};

const deleteRangeSchema = {
  fromLine: z.number().int().min(0).describe('Start line (inclusive)'),
  fromCh: z.number().int().min(0).describe('Start column (inclusive)'),
  toLine: z.number().int().min(0).describe('End line (exclusive)'),
  toCh: z.number().int().min(0).describe('End column (exclusive)'),
};

const setCursorSchema = {
  line: z.number().int().min(0).describe('Zero-based line index'),
  ch: z.number().int().min(0).describe('Zero-based column index'),
};

const setSelectionSchema = {
  fromLine: z.number().int().min(0).describe('Start line (inclusive)'),
  fromCh: z.number().int().min(0).describe('Start column (inclusive)'),
  toLine: z.number().int().min(0).describe('End line (exclusive)'),
  toCh: z.number().int().min(0).describe('End column (exclusive)'),
};

interface EditorHandlers {
  getContent: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  getActivePath: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  insert: (params: InferredParams<typeof insertSchema>) => Promise<CallToolResult>;
  replace: (params: InferredParams<typeof replaceSchema>) => Promise<CallToolResult>;
  deleteRange: (params: InferredParams<typeof deleteRangeSchema>) => Promise<CallToolResult>;
  getCursor: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  setCursor: (params: InferredParams<typeof setCursorSchema>) => Promise<CallToolResult>;
  getSelection: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  setSelection: (params: InferredParams<typeof setSelectionSchema>) => Promise<CallToolResult>;
  getLineCount: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): EditorHandlers {
  return {
    getContent: (params): Promise<CallToolResult> => {
      const content = adapter.getActiveFileContent();
      if (content === null) return Promise.resolve(err('No active editor'));
      return Promise.resolve(
        makeResponse(
          { content },
          (v) => v.content,
          readResponseFormat(params),
        ),
      );
    },
    getActivePath: (params): Promise<CallToolResult> => {
      const path = adapter.getActiveFilePath();
      if (path === null) return Promise.resolve(err('No active file'));
      return Promise.resolve(
        makeResponse(
          { path },
          (v) => v.path,
          readResponseFormat(params),
        ),
      );
    },
    insert: (params): Promise<CallToolResult> => {
      const lineCount = adapter.getActiveLineCount();
      if (lineCount === null) return Promise.resolve(err('No active editor'));
      try {
        assertEditorPosition(params.line, params.ch, lineCount, {
          allowEnd: true,
        });
      } catch (error) {
        return Promise.resolve(
          err(error instanceof Error ? error.message : String(error)),
        );
      }
      const ok = adapter.insertTextAt(params.line, params.ch, params.text);
      return Promise.resolve(ok ? text('Text inserted') : err('No active editor'));
    },
    replace: (params): Promise<CallToolResult> => {
      const lineCount = adapter.getActiveLineCount();
      if (lineCount === null) return Promise.resolve(err('No active editor'));
      try {
        assertEditorPosition(params.fromLine, params.fromCh, lineCount);
        assertEditorPosition(params.toLine, params.toCh, lineCount, {
          allowEnd: true,
        });
      } catch (error) {
        return Promise.resolve(
          err(error instanceof Error ? error.message : String(error)),
        );
      }
      const ok = adapter.replaceRange(
        params.fromLine,
        params.fromCh,
        params.toLine,
        params.toCh,
        params.text,
      );
      return Promise.resolve(ok ? text('Text replaced') : err('No active editor'));
    },
    deleteRange: (params): Promise<CallToolResult> => {
      const lineCount = adapter.getActiveLineCount();
      if (lineCount === null) return Promise.resolve(err('No active editor'));
      try {
        assertEditorPosition(params.fromLine, params.fromCh, lineCount);
        assertEditorPosition(params.toLine, params.toCh, lineCount, {
          allowEnd: true,
        });
      } catch (error) {
        return Promise.resolve(
          err(error instanceof Error ? error.message : String(error)),
        );
      }
      const ok = adapter.deleteRange(
        params.fromLine,
        params.fromCh,
        params.toLine,
        params.toCh,
      );
      return Promise.resolve(ok ? text('Text deleted') : err('No active editor'));
    },
    getCursor: (params): Promise<CallToolResult> => {
      const pos = adapter.getCursorPosition();
      if (!pos) return Promise.resolve(err('No active editor'));
      return Promise.resolve(
        makeResponse(
          pos,
          (v) => `line ${String(v.line)}, ch ${String(v.ch)}`,
          readResponseFormat(params),
        ),
      );
    },
    setCursor: (params): Promise<CallToolResult> => {
      const lineCount = adapter.getActiveLineCount();
      if (lineCount === null) return Promise.resolve(err('No active editor'));
      try {
        assertEditorPosition(params.line, params.ch, lineCount);
      } catch (error) {
        return Promise.resolve(
          err(error instanceof Error ? error.message : String(error)),
        );
      }
      const ok = adapter.setCursorPosition(params.line, params.ch);
      return Promise.resolve(ok ? text('Cursor set') : err('No active editor'));
    },
    getSelection: (params): Promise<CallToolResult> => {
      const sel = adapter.getSelection();
      if (!sel) return Promise.resolve(err('No active editor or selection'));
      return Promise.resolve(
        makeResponse(
          sel,
          (v) =>
            `${String(v.from.line)}:${String(v.from.ch)} → ${String(v.to.line)}:${String(v.to.ch)}\n\n${v.text}`,
          readResponseFormat(params),
        ),
      );
    },
    setSelection: (params): Promise<CallToolResult> => {
      const lineCount = adapter.getActiveLineCount();
      if (lineCount === null) return Promise.resolve(err('No active editor'));
      try {
        assertEditorPosition(params.fromLine, params.fromCh, lineCount);
        assertEditorPosition(params.toLine, params.toCh, lineCount, {
          allowEnd: true,
        });
      } catch (error) {
        return Promise.resolve(
          err(error instanceof Error ? error.message : String(error)),
        );
      }
      const ok = adapter.setSelection(
        params.fromLine,
        params.fromCh,
        params.toLine,
        params.toCh,
      );
      return Promise.resolve(ok ? text('Selection set') : err('No active editor'));
    },
    getLineCount: (params): Promise<CallToolResult> => {
      const count = adapter.getActiveLineCount();
      if (count === null) return Promise.resolve(err('No active editor'));
      return Promise.resolve(
        makeResponse(
          { lineCount: count },
          (v) => String(v.lineCount),
          readResponseFormat(params),
        ),
      );
    },
  };
}

export function createEditorModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'editor', name: 'Editor Operations', description: 'Access and manipulate the active editor' },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'editor_get_content',
          description: describeTool({
            summary: 'Get the full text content of the currently active editor.',
            returns: 'Plain text: the editor\'s current content.',
            errors: ['"No active editor" if no markdown view is focused.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          handler: h.getContent,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_get_active_file',
          description: describeTool({
            summary: 'Get the vault-relative path of the currently active file.',
            returns: 'Plain text: the path, e.g. "notes/today.md".',
            errors: ['"No active file" if no file is open.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          handler: h.getActivePath,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_insert',
          description: describeTool({
            summary: 'Insert text at a (line, ch) position in the active editor.',
            args: [
              'line (integer, ≥0): Zero-based line index.',
              'ch (integer, ≥0): Zero-based column index within the line.',
              'text (string): Text to insert (may contain newlines).',
            ],
            returns: 'Plain text "Text inserted" on success.',
            examples: ['Use when: inserting a heading at the top of the file (line 0, ch 0).'],
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if (line, ch) is outside the document.',
            ],
          }),
          schema: insertSchema,
          handler: h.insert,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_replace',
          description: describeTool({
            summary: 'Replace text in a (fromLine, fromCh)→(toLine, toCh) range.',
            args: [
              'fromLine / fromCh (integers, ≥0): Start of range (inclusive).',
              'toLine / toCh (integers, ≥0): End of range (exclusive).',
              'text (string): Replacement text.',
            ],
            returns: 'Plain text "Text replaced" on success.',
            examples: ['Use when: replacing a paragraph after locating it with search_fulltext.'],
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if either endpoint is outside the document.',
            ],
          }),
          schema: replaceSchema,
          handler: h.replace,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'editor_delete',
          description: describeTool({
            summary: 'Delete text in a (fromLine, fromCh)→(toLine, toCh) range.',
            args: [
              'fromLine / fromCh (integers, ≥0): Start of range (inclusive).',
              'toLine / toCh (integers, ≥0): End of range (exclusive).',
            ],
            returns: 'Plain text "Text deleted" on success.',
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if either endpoint is outside the document.',
            ],
          }),
          schema: deleteRangeSchema,
          handler: h.deleteRange,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'editor_get_cursor',
          description: describeTool({
            summary: 'Get the current cursor position in the active editor.',
            returns: 'JSON: { line, ch } (zero-based).',
            errors: ['"No active editor" if no markdown view is focused.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          handler: h.getCursor,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_set_cursor',
          description: describeTool({
            summary: 'Move the cursor to a (line, ch) position in the active editor.',
            args: [
              'line (integer, ≥0): Zero-based line index.',
              'ch (integer, ≥0): Zero-based column index.',
            ],
            returns: 'Plain text "Cursor set" on success.',
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if (line, ch) is outside the document.',
            ],
          }),
          schema: setCursorSchema,
          handler: h.setCursor,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_get_selection',
          description: describeTool({
            summary: 'Get the current text selection in the active editor.',
            returns: 'JSON: { from: {line, ch}, to: {line, ch}, text }.',
            errors: ['"No active editor or selection" if nothing is selected.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          handler: h.getSelection,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_set_selection',
          description: describeTool({
            summary: 'Select a (fromLine, fromCh)→(toLine, toCh) range in the active editor.',
            args: [
              'fromLine / fromCh (integers, ≥0): Start of selection (inclusive).',
              'toLine / toCh (integers, ≥0): End of selection (exclusive).',
            ],
            returns: 'Plain text "Selection set" on success.',
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if either endpoint is outside the document.',
            ],
          }),
          schema: setSelectionSchema,
          handler: h.setSelection,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_get_line_count',
          description: describeTool({
            summary: 'Get the number of lines in the active editor.',
            returns: 'Plain text: the line count as a decimal integer.',
            errors: ['"No active editor" if no markdown view is focused.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          handler: h.getLineCount,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
