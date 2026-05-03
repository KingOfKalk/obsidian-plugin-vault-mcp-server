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
import { validateVaultPath } from '../../utils/path-guard';
import { handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';
import {
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

const readOnlySchema = { ...responseFormatField };

const openFileSchema = {
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe('Vault-relative file path to open'),
  mode: z
    .enum(['source', 'preview', 'live'])
    .optional()
    .describe('Optional view mode for the opened leaf'),
};

const setActiveLeafSchema = {
  leafId: z
    .string()
    .min(1)
    .max(200)
    .describe('Leaf id returned by workspace_list_leaves'),
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
 *   `app.workspace.getLayout()`. Schema is empty; tests rely on
 *   `.passthrough()` to assert "an object, contents not described".
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

const getLayoutOutputSchema: z.ZodRawShape = {};

interface WorkspaceHandlers {
  getActiveLeaf: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  openFile: (params: InferredParams<typeof openFileSchema>) => Promise<CallToolResult>;
  listLeaves: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  setActiveLeaf: (params: InferredParams<typeof setActiveLeafSchema>) => Promise<CallToolResult>;
  getLayout: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): WorkspaceHandlers {
  const vaultPath = adapter.getVaultPath();
  return {
    getActiveLeaf: (params): Promise<CallToolResult> => {
      const info = adapter.getActiveLeafInfo();
      if (!info) return Promise.resolve(err('No active leaf'));
      return Promise.resolve(
        makeResponse(
          info,
          (v) => {
            const id = typeof v.id === 'string' ? v.id : 'unknown';
            const type = typeof v.type === 'string' ? v.type : 'unknown';
            return `Active leaf: ${id} (${type})`;
          },
          readResponseFormat(params),
        ),
      );
    },
    async openFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        await adapter.openFile(path, params.mode);
        return text(`Opened: ${path}`);
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
    listLeaves: (params): Promise<CallToolResult> => {
      const files = adapter.getOpenFiles();
      return Promise.resolve(
        makeResponse(
          { leaves: files },
          (v) =>
            v.leaves.length === 0
              ? 'No open leaves.'
              : v.leaves.map((f) => `- [${f.leafId}] ${f.path}`).join('\n'),
          readResponseFormat(params),
        ),
      );
    },
    setActiveLeaf: (params): Promise<CallToolResult> => {
      const ok = adapter.setActiveLeaf(params.leafId);
      return Promise.resolve(ok ? text('Active leaf set') : err('Leaf not found'));
    },
    getLayout: (params): Promise<CallToolResult> => {
      const layout = adapter.getWorkspaceLayout();
      return Promise.resolve(
        makeResponse(
          layout,
          (v) => '```json\n' + JSON.stringify(v, null, 2) + '\n```',
          readResponseFormat(params),
        ),
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
            summary: 'Get info about the currently-focused leaf (pane).',
            returns: 'JSON: { id, type, ... } describing the active leaf.',
            errors: ['"No active leaf" if no leaf is focused.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: getActiveLeafOutputSchema,
          handler: h.getActiveLeaf,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'workspace_open_file',
          title: 'Open file in workspace',
          description: describeTool({
            summary: 'Open a file in a leaf, optionally requesting a view mode.',
            args: [
              'path (string): Vault-relative file path.',
              'mode (enum, optional): "source" | "preview" | "live".',
            ],
            returns: 'Plain text "Opened: <path>".',
            errors: ['"Path must not traverse outside the vault" on traversal attempts.'],
          }),
          schema: openFileSchema,
          handler: h.openFile,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'workspace_list_leaves',
          title: 'List open leaves',
          description: describeTool({
            summary: 'List every open leaf and the file it holds.',
            returns: 'JSON: [{ path, leafId }].',
          }, readOnlySchema),
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
            args: ['leafId (string): Leaf id from workspace_list_leaves.'],
            returns: 'Plain text "Active leaf set" on success.',
            errors: ['"Leaf not found" if the id does not match any leaf.'],
          }),
          schema: setActiveLeafSchema,
          handler: h.setActiveLeaf,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'workspace_get_layout',
          title: 'Get workspace layout',
          description: describeTool({
            summary: 'Get a summary of the current workspace layout.',
            returns: 'JSON: Obsidian\'s layout descriptor (nested splits and leaves).',
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: getLayoutOutputSchema,
          handler: h.getLayout,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
