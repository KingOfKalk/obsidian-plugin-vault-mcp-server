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
  confirmWithStructured,
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';

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
  ch: z.number().int().min(0).describe('Zero-based column index within the line'),
  text: z
    .string()
    .max(5_000_000)
    .describe('Text to insert at (line, ch); may contain newlines'),
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

/**
 * Output schemas for the editor read tools that emit `structuredContent`
 * (Batch C of #248). Each shape mirrors what the corresponding handler in
 * this file puts on `result.structuredContent`.
 */
const getContentOutputSchema = {
  content: z.string().describe('Full text content of the active editor.'),
};

const getActiveFileOutputSchema = {
  path: z.string().describe('Vault-relative path of the active file.'),
};

const getCursorOutputSchema = {
  line: z.number().describe('Zero-based line index of the cursor.'),
  ch: z.number().describe('Zero-based column index of the cursor.'),
};

const getSelectionOutputSchema = {
  from: z
    .object({
      line: z.number().describe('Zero-based start line (inclusive).'),
      ch: z.number().describe('Zero-based start column (inclusive).'),
    })
    .describe('Selection start.'),
  to: z
    .object({
      line: z.number().describe('Zero-based end line (exclusive).'),
      ch: z.number().describe('Zero-based end column (exclusive).'),
    })
    .describe('Selection end.'),
  text: z.string().describe('Selected text.'),
};

const getLineCountOutputSchema = {
  lineCount: z.number().describe('Number of lines in the active editor.'),
};

/**
 * Output schemas for the editor write tools (#388): the position or range
 * that was acted on, next to the unchanged plain-text confirmation.
 */
const positionOutputSchema = {
  line: z.number().describe('Zero-based line index.'),
  ch: z.number().describe('Zero-based column index.'),
};

const rangeOutputSchema = {
  from: z.object(positionOutputSchema).describe('Range start (inclusive).'),
  to: z.object(positionOutputSchema).describe('Range end (exclusive).'),
};

function rangeOf(params: {
  fromLine: number;
  fromCh: number;
  toLine: number;
  toCh: number;
}): { from: { line: number; ch: number }; to: { line: number; ch: number } } {
  return {
    from: { line: params.fromLine, ch: params.fromCh },
    to: { line: params.toLine, ch: params.toCh },
  };
}

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
      return Promise.resolve(
        ok
          ? confirmWithStructured('Text inserted', { line: params.line, ch: params.ch })
          : err('No active editor'),
      );
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
      return Promise.resolve(
        ok ? confirmWithStructured('Text replaced', rangeOf(params)) : err('No active editor'),
      );
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
      return Promise.resolve(
        ok ? confirmWithStructured('Text deleted', rangeOf(params)) : err('No active editor'),
      );
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
      return Promise.resolve(
        ok
          ? confirmWithStructured('Cursor set', { line: params.line, ch: params.ch })
          : err('No active editor'),
      );
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
      return Promise.resolve(
        ok ? confirmWithStructured('Selection set', rangeOf(params)) : err('No active editor'),
      );
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
          title: 'Get active file content',
          description: describeTool({
            summary: 'Get the full text content of the currently active editor.',
            errors: ['"No active editor" if no markdown view is focused.'],
            seeAlso: [
              'vault_read — when reading any file by path, not just the active one.',
            ],
          }),
          schema: readOnlySchema,
          outputSchema: getContentOutputSchema,
          handler: h.getContent,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_get_active_file',
          title: 'Get active file path',
          description: describeTool({
            summary: 'Get the vault-relative path of the currently active file.',
            errors: ['"No active file" if no file is open.'],
            seeAlso: [
              'workspace_get_active_leaf — when you need the active pane/leaf (id and view type), not just the file path.',
            ],
          }),
          schema: readOnlySchema,
          outputSchema: getActiveFileOutputSchema,
          handler: h.getActivePath,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_insert',
          title: 'Insert at cursor',
          description: describeTool({
            summary: 'Insert text at a (line, ch) position in the active editor.',
            examples: ['Use when: inserting a heading at the top of the file (line 0, ch 0).'],
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if (line, ch) is outside the document.',
            ],
            seeAlso: [
              'editor_replace — when you want to overwrite an existing range, not insert at a point.',
              'editor_delete — when you want to remove a range without writing anything in its place.',
            ],
          }),
          schema: insertSchema,
          outputSchema: positionOutputSchema,
          handler: h.insert,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_replace',
          title: 'Replace range',
          description: describeTool({
            summary: 'Replace text in a (fromLine, fromCh)→(toLine, toCh) range.',
            examples: ['Use when: replacing a paragraph after locating it with search_fulltext.'],
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if either endpoint is outside the document.',
            ],
            seeAlso: [
              'editor_insert — when you want to add text at a single point without overwriting anything.',
              'editor_delete — when you want to remove a range without writing anything in its place.',
            ],
          }),
          schema: replaceSchema,
          outputSchema: rangeOutputSchema,
          handler: h.replace,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'editor_delete',
          title: 'Delete range',
          description: describeTool({
            summary: 'Delete text in a (fromLine, fromCh)→(toLine, toCh) range.',
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if either endpoint is outside the document.',
            ],
            seeAlso: [
              'editor_insert — when you want to add text at a single point without overwriting anything.',
              'editor_replace — when you want to overwrite an existing range, not just remove it.',
            ],
          }),
          schema: deleteRangeSchema,
          outputSchema: rangeOutputSchema,
          handler: h.deleteRange,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'editor_get_cursor',
          title: 'Get cursor position',
          description: describeTool({
            summary: 'Get the current cursor position in the active editor.',
            errors: ['"No active editor" if no markdown view is focused.'],
          }),
          schema: readOnlySchema,
          outputSchema: getCursorOutputSchema,
          handler: h.getCursor,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_set_cursor',
          title: 'Set cursor position',
          description: describeTool({
            summary: 'Move the cursor to a (line, ch) position in the active editor.',
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if (line, ch) is outside the document.',
            ],
            seeAlso: [
              'editor_set_selection — when you want to select a range, not collapse the caret to a point.',
            ],
          }),
          schema: setCursorSchema,
          outputSchema: positionOutputSchema,
          handler: h.setCursor,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_get_selection',
          title: 'Get selection',
          description: describeTool({
            summary: 'Get the current text selection in the active editor.',
            errors: ['"No active editor or selection" if nothing is selected.'],
          }),
          schema: readOnlySchema,
          outputSchema: getSelectionOutputSchema,
          handler: h.getSelection,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_set_selection',
          title: 'Set selection',
          description: describeTool({
            summary: 'Select a (fromLine, fromCh)→(toLine, toCh) range in the active editor.',
            errors: [
              '"No active editor" if no markdown view is focused.',
              '"Position is out of range" if either endpoint is outside the document.',
            ],
            seeAlso: [
              'editor_set_cursor — when you want to place the caret at a point, not select a range.',
            ],
          }),
          schema: setSelectionSchema,
          outputSchema: rangeOutputSchema,
          handler: h.setSelection,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_get_line_count',
          title: 'Get line count',
          description: describeTool({
            summary: 'Get the number of lines in the active editor.',
            errors: ['"No active editor" if no markdown view is focused.'],
          }),
          schema: readOnlySchema,
          outputSchema: getLineCountOutputSchema,
          handler: h.getLineCount,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
