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
import { validateToolPath } from '../../utils/path-guard';
import { handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';
import { FILE_PATH_DESC, vaultPathField } from '../shared/descriptions';
import { dataResponse } from '../shared/response';
import { resultTextLength } from '../shared/pagination';
import { CHARACTER_LIMIT } from '../../constants';

function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

const readOnlySchema = {};

/** The largest list (by JSON size) with more than one item in `value`, or null. */
function largestList(value: unknown): unknown[] | null {
  let best: unknown[] | null = null;
  let bestSize = 0;
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      if (v.length > 1) {
        const size = JSON.stringify(v).length;
        if (size > bestSize) {
          best = v;
          bestSize = size;
        }
      }
      v.forEach(visit);
    } else if (v !== null && typeof v === 'object') {
      Object.values(v).forEach(visit);
    }
  };
  visit(value);
  return best;
}

/**
 * `workspace_get_layout` over CHARACTER_LIMIT (#464): shorten the largest
 * list in a copy of the layout until the text fits, so text and
 * structuredContent stay the same valid JSON, and set `truncated: true`.
 */
function layoutResponse(layout: Record<string, unknown>): CallToolResult {
  const render = (v: Record<string, unknown>): CallToolResult => dataResponse(v);
  let result = render(layout);
  let size = resultTextLength(result);
  if (size <= CHARACTER_LIMIT) return result;
  const copy = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;
  copy.truncated = true;
  let list = largestList(copy);
  while (list !== null && size > CHARACTER_LIMIT) {
    // Keep the share of the list that would fit, as fitItems does.
    const keep = Math.floor((list.length * CHARACTER_LIMIT) / size);
    list.length = Math.max(1, Math.min(list.length - 1, keep));
    result = render(copy);
    size = resultTextLength(result);
    list = largestList(copy);
  }
  return result;
}

const openFileSchema = {
  path: vaultPathField(FILE_PATH_DESC),
  mode: z
    .enum(['source', 'preview', 'live'])
    .optional()
    .describe(
      'View mode for a Markdown note: "source" (Source mode), "live" (Live Preview) or "preview" (Reading view); omit for Obsidian\'s default view.',
    ),
};

const setActiveLeafSchema = {
  leafId: z
    .string()
    .min(1)
    .max(200)
    .describe('Leaf id from workspace_list_leaves.'),
};

/**
 * Output schemas for the workspace read tools that emit `structuredContent`
 * (Batch C of #248). Two of these are `.passthrough()`-tested because their
 * payload comes from an Obsidian-internal shape whose set of fields is not
 * under our control:
 *
 * - `workspace_get_active_leaf` — adapter returns `{ id, type, filePath }`
 *   today, but Obsidian's leaf state may grow more fields in future versions.
 * - `workspace_get_layout` — fully opaque pass-through of
 *   `app.workspace.getLayout()`, declared as a loose object so any keys
 *   are accepted.
 */
const getActiveLeafOutputSchema = {
  id: z.string().describe('Leaf id (Obsidian-internal handle).'),
  type: z.string().describe('View type for the leaf, e.g. "markdown".'),
  filePath: z
    .string()
    .nullable()
    .describe('Vault-relative path of the file in this leaf, or null when none.'),
};

const listLeavesOutputSchema = {
  leaves: z
    .array(
      z.object({
        leafId: z.string().describe('Obsidian-internal leaf id.'),
        path: z.string().describe('Vault-relative path of the file in this leaf.'),
      }),
    )
    .describe('All open leaves that hold a file.'),
};

// Loose object: the layout is Obsidian's opaque descriptor. A plain `{}`
// shape is advertised with `additionalProperties: false`, which made SDK
// clients reject every real layout payload (#388).
const getLayoutOutputSchema = z
  .looseObject({})
  .describe("Obsidian's workspace layout descriptor (opaque; fields vary by version).");

const openFileOutputSchema = {
  path: z.string().describe('Vault-relative path that was opened.'),
  mode: z
    .enum(['source', 'preview', 'live'])
    .optional()
    .describe('View mode the note was opened in, when mode was given.'),
};

const setActiveLeafOutputSchema = {
  leafId: z.string().describe('Id of the leaf that is now active.'),
};

interface WorkspaceHandlers {
  getActiveLeaf: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  openFile: (params: InferredParams<typeof openFileSchema>) => Promise<CallToolResult>;
  listLeaves: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  setActiveLeaf: (params: InferredParams<typeof setActiveLeafSchema>) => Promise<CallToolResult>;
  getLayout: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): WorkspaceHandlers {
  const vaultPath = adapter.getVaultPath();
  const configDir = adapter.getConfigDir();
  return {
    getActiveLeaf: (): Promise<CallToolResult> => {
      const info = adapter.getActiveLeafInfo();
      if (!info) return Promise.resolve(err('No active leaf'));
      return Promise.resolve(
        dataResponse(info),
      );
    },
    async openFile(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        await adapter.openFile(path, params.mode);
        return dataResponse({
          path,
          ...(params.mode !== undefined ? { mode: params.mode } : {}),
        });
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
    listLeaves: (): Promise<CallToolResult> => {
      const files = adapter.getOpenFiles();
      return Promise.resolve(
        dataResponse({ leaves: files }),
      );
    },
    setActiveLeaf: (params): Promise<CallToolResult> => {
      const ok = adapter.setActiveLeaf(params.leafId);
      return Promise.resolve(
        ok
          ? dataResponse({ leafId: params.leafId })
          : err('Leaf not found'),
      );
    },
    getLayout: (): Promise<CallToolResult> => {
      return Promise.resolve(
        layoutResponse(adapter.getWorkspaceLayout()),
      );
    },
  };
}

export function createWorkspaceModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'workspace', name: 'Workspace and Navigation', description: 'Manage panes, open files, and navigate the workspace' },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'workspace_get_active_leaf',
          title: 'Get active leaf',
          description: describeTool({
            summary: 'Get the focused leaf (pane): its id, view type and file path.',
            errors: ['"No active leaf" if no leaf is focused.'],
            seeAlso: ['editor_get_active_file — for just the active file\'s path.'],
          }),
          schema: readOnlySchema,
          outputSchema: getActiveLeafOutputSchema,
          handler: h.getActiveLeaf,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'workspace_open_file',
          title: 'Open file in workspace',
          description: describeTool({
            summary: 'Open a file in the active leaf (replacing what it shows; a new tab if that leaf is pinned) and focus it, optionally in a given view mode.',
            examples: [
              'Use when: showing a note read-only -> { path: "notes/a.md", mode: "preview" }',
            ],
            errors: ['"File not found" if path does not exist.'],
          }),
          schema: openFileSchema,
          outputSchema: openFileOutputSchema,
          handler: h.openFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'workspace_list_leaves',
          title: 'List open leaves',
          description: describeTool({
            summary: 'List the open leaves that show a file, with their leaf ids and file paths.',
          }),
          schema: readOnlySchema,
          outputSchema: listLeavesOutputSchema,
          handler: h.listLeaves,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'workspace_set_active_leaf',
          title: 'Set active leaf',
          description: describeTool({
            summary: 'Focus a specific leaf by id.',
            errors: ['"Leaf not found" if the id does not match any leaf.'],
          }),
          schema: setActiveLeafSchema,
          outputSchema: setActiveLeafOutputSchema,
          handler: h.setActiveLeaf,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'workspace_get_layout',
          title: 'Get workspace layout',
          description: describeTool({
            summary: "Get Obsidian's raw workspace layout JSON (opaque, varies by Obsidian version). Over the size limit its longest lists are shortened and truncated: true is set.",
          }),
          schema: readOnlySchema,
          outputSchema: getLayoutOutputSchema,
          handler: h.getLayout,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
