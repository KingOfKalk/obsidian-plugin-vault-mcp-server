import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
  type InferredParams,
} from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { errorResult } from '../shared/errors';
import { describeTool } from '../shared/describe';
import { safeHandlers } from '../shared/handler';
import { noParamsSchema, textInput } from '../shared/schemas';
import { dataResponse, documentResponse } from '../shared/response';
import {
  READ_MAX_LENGTH,
  sliceTextWindow,
  windowBody,
  windowLengthField,
  windowMeta,
  windowOffsetField,
} from '../shared/window';

// Schemas as module-level consts so handler signatures can reference them
// via `typeof <schema>` for automatic parameter typing through
// `InferredParams<Shape>`.

/** `editor_get_content`: a character window like `vault_read` (#464). */
const getContentSchema = {
  offset: windowOffsetField,
  length: windowLengthField('Notes'),
};

/**
 * Range parameters shared by replace, delete and set_selection (#449).
 * The end is a CodeMirror position: the range stops before the character
 * at (toLine, toCh), so an edit within one line has toLine == fromLine.
 */
/** A 0-based line or column. */
const editorIndex = z.number().int().min(0);

const rangeSchema = {
  fromLine: editorIndex.describe('Start line (0-based).'),
  fromCh: editorIndex.describe('Start column (0-based); included.'),
  toLine: editorIndex.describe('End line (0-based); equals fromLine for a range within one line.'),
  toCh: editorIndex.describe('End column (0-based); not included.'),
};

/** A (line, ch) position: editor_insert and editor_set_cursor. */
const pointSchema = {
  line: editorIndex.describe('Line (0-based).'),
  ch: editorIndex.describe('Column (0-based).'),
};

/** One sentence on how ranges work, for the range tools' summaries. */
const RANGE_NOTE =
  'Range: from (fromLine, fromCh) up to but not including (toLine, toCh), 0-based.';

/** "Position is out of range" for the range tools; only lines are checked. */
const RANGE_OUT_OF_RANGE_ERROR =
  '"Position is out of range" if fromLine is past the last line or toLine > line count (columns are not checked; a ch past the line end runs into the next line).';

// "No active editor" is in the server instructions' editor line, sent
// whenever an editor tool is enabled (#457), so the tools do not repeat it.

/** Error when no Markdown view is focused, with the next step (#463). */
const NO_EDITOR_HINT =
  'Open the note in Obsidian (e.g. with workspace_open_file) or use the vault_* tools, which work on any file by path.';
const NO_ACTIVE_EDITOR = `No active editor. ${NO_EDITOR_HINT}`;

const insertSchema = {
  ...pointSchema,
  text: textInput.describe('Text to insert; may contain newlines.'),
};

const replaceSchema = {
  ...rangeSchema,
  text: textInput.describe('Replacement text.'),
};

/**
 * Output schemas of the editor data tools (#467): each shape mirrors what
 * the handler puts on `structuredContent`, which is also the JSON text.
 * editor_get_content is a document tool and has none.
 */
const getActiveFileOutputSchema = {
  path: z.string().describe('Vault-relative path of the active file.'),
};

const getCursorOutputSchema = {
  line: z.number().describe('Cursor line (0-based).'),
  ch: z.number().describe('Cursor column (0-based).'),
};

const getSelectionOutputSchema = {
  from: z
    .object({
      line: z.number().describe('Start line (0-based).'),
      ch: z.number().describe('Start column (0-based; included).'),
    })
    .describe('Selection start.'),
  to: z
    .object({
      line: z.number().describe('End line (0-based).'),
      ch: z.number().describe('End column (0-based; not included).'),
    })
    .describe('Selection end; equals from when nothing is selected.'),
  text: z.string().describe('Selected text; "" when nothing is selected.'),
};

const getLineCountOutputSchema = {
  lineCount: z.number().describe('Number of lines in the active editor.'),
};

/**
 * Output schemas for the editor write tools (#388): the position or range
 * that was acted on, next to the unchanged plain-text confirmation.
 */
const positionOutputSchema = {
  line: z.number().describe('Line (0-based).'),
  ch: z.number().describe('Column (0-based).'),
};

const rangeOutputSchema = {
  from: z.object(positionOutputSchema).describe('Start position (included).'),
  to: z.object(positionOutputSchema).describe('End position (not included).'),
};

/** A range tool's parameters (#449). */
interface RangeParams {
  fromLine: number;
  fromCh: number;
  toLine: number;
  toCh: number;
}

function rangeOf(params: RangeParams): {
  from: { line: number; ch: number };
  to: { line: number; ch: number };
} {
  return {
    from: { line: params.fromLine, ch: params.fromCh },
    to: { line: params.toLine, ch: params.toCh },
  };
}

/**
 * A line an edit touches. `allowEnd` lets it be the line count itself, for
 * edits that may target the end of the text (e.g. inserting after the last
 * line). Columns are not checked. The schemas make lines non-negative
 * integers.
 */
interface LineCheck {
  line: number;
  allowEnd: boolean;
}

/** The start of a range must be a line; its end may be the end of the text. */
function rangeLines(params: RangeParams): LineCheck[] {
  return [
    { line: params.fromLine, allowEnd: false },
    { line: params.toLine, allowEnd: true },
  ];
}

/**
 * Edit the active editor: check `lines` against its line count, run `edit`
 * and return `result` as data. "No active editor" when there is none or
 * `edit` reports false; "Position is out of range" for a line past the end.
 */
function withEditor(
  adapter: ObsidianAdapter,
  lines: readonly LineCheck[],
  edit: () => boolean,
  result: object,
): CallToolResult {
  const lineCount = adapter.getActiveLineCount();
  if (lineCount === null) return errorResult(NO_ACTIVE_EDITOR);
  for (const { line, allowEnd } of lines) {
    if (line > (allowEnd ? lineCount : lineCount - 1)) {
      throw new RangeError('Position is out of range for the active editor');
    }
  }
  return edit() ? dataResponse(result) : errorResult(NO_ACTIVE_EDITOR);
}

interface EditorHandlers {
  getContent: (params: InferredParams<typeof getContentSchema>) => Promise<CallToolResult>;
  getActivePath: (params: InferredParams<typeof noParamsSchema>) => Promise<CallToolResult>;
  insert: (params: InferredParams<typeof insertSchema>) => Promise<CallToolResult>;
  replace: (params: InferredParams<typeof replaceSchema>) => Promise<CallToolResult>;
  deleteRange: (params: InferredParams<typeof rangeSchema>) => Promise<CallToolResult>;
  getCursor: (params: InferredParams<typeof noParamsSchema>) => Promise<CallToolResult>;
  setCursor: (params: InferredParams<typeof pointSchema>) => Promise<CallToolResult>;
  getSelection: (params: InferredParams<typeof noParamsSchema>) => Promise<CallToolResult>;
  setSelection: (params: InferredParams<typeof rangeSchema>) => Promise<CallToolResult>;
  getLineCount: (params: InferredParams<typeof noParamsSchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): EditorHandlers {
  return safeHandlers<EditorHandlers>({
    getContent: (params): CallToolResult => {
      const text = adapter.getActiveFileContent();
      if (text === null) return errorResult(NO_ACTIVE_EDITOR);
      const w = sliceTextWindow(text, params.offset ?? 0, params.length ?? READ_MAX_LENGTH);
      return documentResponse(
        windowMeta(w, text.length),
        windowBody('editor_get_content', w, text.length),
      );
    },
    getActivePath: (): CallToolResult => {
      const path = adapter.getActiveFilePath();
      if (path === null) return errorResult('No active file');
      return dataResponse({ path });
    },
    insert: (params): CallToolResult =>
      withEditor(
        adapter,
        [{ line: params.line, allowEnd: true }],
        () => adapter.insertTextAt(params.line, params.ch, params.text),
        { line: params.line, ch: params.ch },
      ),
    replace: (params): CallToolResult =>
      withEditor(
        adapter,
        rangeLines(params),
        () =>
          adapter.replaceRange(params.fromLine, params.fromCh, params.toLine, params.toCh, params.text),
        rangeOf(params),
      ),
    deleteRange: (params): CallToolResult =>
      withEditor(
        adapter,
        rangeLines(params),
        () => adapter.deleteRange(params.fromLine, params.fromCh, params.toLine, params.toCh),
        rangeOf(params),
      ),
    getCursor: (): CallToolResult => {
      const pos = adapter.getCursorPosition();
      if (!pos) return errorResult(NO_ACTIVE_EDITOR);
      return dataResponse({ line: pos.line, ch: pos.ch });
    },
    setCursor: (params): CallToolResult =>
      withEditor(
        adapter,
        [{ line: params.line, allowEnd: false }],
        () => adapter.setCursorPosition(params.line, params.ch),
        { line: params.line, ch: params.ch },
      ),
    getSelection: (): CallToolResult => {
      const sel = adapter.getSelection();
      if (!sel) return errorResult(`No active editor or selection. ${NO_EDITOR_HINT}`);
      return dataResponse({ from: sel.from, to: sel.to, text: sel.text });
    },
    setSelection: (params): CallToolResult =>
      withEditor(
        adapter,
        rangeLines(params),
        () => adapter.setSelection(params.fromLine, params.fromCh, params.toLine, params.toCh),
        rangeOf(params),
      ),
    getLineCount: (): CallToolResult => {
      const count = adapter.getActiveLineCount();
      if (count === null) return errorResult(NO_ACTIVE_EDITOR);
      return dataResponse({ lineCount: count });
    },
  });
}

export function createEditorModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'editor', name: 'Editor Operations', description: 'Access and manipulate the active editor', defaultEnabled: false },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'editor_get_content',
          title: 'Get active file content',
          description: describeTool({
            summary: 'Get the text of the active editor, in windows of up to length characters (offset/nextOffset).',
            returns: 'Text: "key: value" header lines (totalLength, offset, hasMore, nextOffset), a blank line, the raw text.',
            seeAlso: ['vault_read — to read any file by path.'],
          }),
          schema: getContentSchema,
          handler: h.getContent,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_get_active_file',
          title: 'Get active file path',
          description: describeTool({
            summary: 'Get the vault-relative path of the currently active file.',
            errors: ['"No active file" if no file is open.'],
            seeAlso: ['workspace_get_active_leaf — for the active leaf (id and view type), not just the path.'],
          }),
          schema: noParamsSchema,
          outputSchema: getActiveFileOutputSchema,
          handler: h.getActivePath,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_insert',
          title: 'Insert at position',
          description: describeTool({
            summary: 'Insert text at a (line, ch) position in the active editor (not at the cursor). 0-based.',
            examples: ['Use when: inserting a heading at the top of the file (line 0, ch 0).'],
            errors: [
              '"Position is out of range" if line > line count (ch is not checked; past the line end it runs into the next line).',
            ],
            seeAlso: [
              'editor_replace — to overwrite a range.',
              'editor_delete — to remove a range.',
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
            summary: `Replace a range of the active editor's text. ${RANGE_NOTE}`,
            examples: [
              'Use when: replacing "abc" that starts at column 4 of line 3 -> { fromLine: 3, fromCh: 4, toLine: 3, toCh: 7, text: "xyz" }',
            ],
            errors: [RANGE_OUT_OF_RANGE_ERROR],
            seeAlso: [
              'vault_replace — to change exact text in a file by content, with a conflict check.',
              'editor_insert — to add text at a point.',
              'editor_delete — to remove a range.',
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
            summary: `Delete a range of the active editor's text. ${RANGE_NOTE}`,
            errors: [RANGE_OUT_OF_RANGE_ERROR],
            seeAlso: [
              'editor_insert — to add text at a point.',
              'editor_replace — to overwrite a range.',
            ],
          }),
          schema: rangeSchema,
          outputSchema: rangeOutputSchema,
          handler: h.deleteRange,
          annotations: annotations.destructive,
        }),
        defineTool({
          name: 'editor_get_cursor',
          title: 'Get cursor position',
          description: describeTool({
            summary: 'Get the cursor position (0-based line, ch) in the active editor.',
          }),
          schema: noParamsSchema,
          outputSchema: getCursorOutputSchema,
          handler: h.getCursor,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_set_cursor',
          title: 'Set cursor position',
          description: describeTool({
            summary: 'Move the cursor to a (line, ch) position in the active editor. 0-based.',
            errors: ['"Position is out of range" if line is past the last line (ch is not checked).'],
            seeAlso: ['editor_set_selection — to select a range.'],
          }),
          schema: pointSchema,
          outputSchema: positionOutputSchema,
          handler: h.setCursor,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_get_selection',
          title: 'Get selection',
          description: describeTool({
            summary: 'Get the selected text and its range (0-based) in the active editor. With nothing selected, from equals to (the cursor) and text is "".',
            errors: ['"No active editor or selection" if no editor is open.'],
          }),
          schema: noParamsSchema,
          outputSchema: getSelectionOutputSchema,
          handler: h.getSelection,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'editor_set_selection',
          title: 'Set selection',
          description: describeTool({
            summary: `Select a range in the active editor. ${RANGE_NOTE}`,
            errors: [RANGE_OUT_OF_RANGE_ERROR],
            seeAlso: ['editor_set_cursor — to place the caret at a point.'],
          }),
          schema: rangeSchema,
          outputSchema: rangeOutputSchema,
          handler: h.setSelection,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'editor_get_line_count',
          title: 'Get line count',
          description: describeTool({
            summary: 'Get the number of lines in the active editor.',
          }),
          schema: noParamsSchema,
          outputSchema: getLineCountOutputSchema,
          handler: h.getLineCount,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
