import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition, annotations } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateVaultPath } from '../../utils/path-guard';
import { handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

function createHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  const vaultPath = adapter.getVaultPath();
  return {
    getActiveLeaf: (): Promise<CallToolResult> => {
      const info = adapter.getActiveLeafInfo();
      if (!info) return Promise.resolve(err('No active leaf'));
      return Promise.resolve(text(JSON.stringify(info)));
    },
    async openFile(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        await adapter.openFile(path, params.mode as string | undefined);
        return text(`Opened: ${path}`);
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
    listLeaves: (): Promise<CallToolResult> => {
      const files = adapter.getOpenFiles();
      return Promise.resolve(text(JSON.stringify(files)));
    },
    setActiveLeaf: (params): Promise<CallToolResult> => {
      const ok = adapter.setActiveLeaf(params.leafId as string);
      return Promise.resolve(ok ? text('Active leaf set') : err('Leaf not found'));
    },
    getLayout: (): Promise<CallToolResult> => {
      const layout = adapter.getWorkspaceLayout();
      return Promise.resolve(text(JSON.stringify(layout)));
    },
  };
}

export function createWorkspaceModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'workspace', name: 'Workspace and Navigation', description: 'Manage panes, open files, and navigate the workspace' },
    tools(): ToolDefinition[] {
      return [
        {
          name: 'workspace_get_active_leaf',
          description: describeTool({
            summary: 'Get info about the currently-focused leaf (pane).',
            returns: 'JSON: { id, type, ... } describing the active leaf.',
            errors: ['"No active leaf" if no leaf is focused.'],
          }),
          schema: {},
          handler: h.getActiveLeaf,
          annotations: annotations.read,
        },
        {
          name: 'workspace_open_file',
          description: describeTool({
            summary: 'Open a file in a leaf, optionally requesting a view mode.',
            args: [
              'path (string): Vault-relative file path.',
              'mode (enum, optional): "source" | "preview" | "live".',
            ],
            returns: 'Plain text "Opened: <path>".',
            errors: ['"Path must not traverse outside the vault" on traversal attempts.'],
          }),
          schema: {
            path: z
              .string()
              .min(1)
              .max(4096)
              .describe('Vault-relative file path to open'),
            mode: z
              .enum(['source', 'preview', 'live'])
              .optional()
              .describe('Optional view mode for the opened leaf'),
          },
          handler: h.openFile,
          annotations: annotations.additive,
        },
        {
          name: 'workspace_list_leaves',
          description: describeTool({
            summary: 'List every open leaf and the file it holds.',
            returns: 'JSON: [{ path, leafId }].',
          }),
          schema: {},
          handler: h.listLeaves,
          annotations: annotations.read,
        },
        {
          name: 'workspace_set_active_leaf',
          description: describeTool({
            summary: 'Focus a specific leaf by id.',
            args: ['leafId (string): Leaf id from workspace_list_leaves.'],
            returns: 'Plain text "Active leaf set" on success.',
            errors: ['"Leaf not found" if the id does not match any leaf.'],
          }),
          schema: {
            leafId: z
              .string()
              .min(1)
              .max(200)
              .describe('Leaf id returned by workspace_list_leaves'),
          },
          handler: h.setActiveLeaf,
          annotations: annotations.additive,
        },
        {
          name: 'workspace_get_layout',
          description: describeTool({
            summary: 'Get a summary of the current workspace layout.',
            returns: 'JSON: Obsidian\'s layout descriptor (nested splits and leaves).',
          }),
          schema: {},
          handler: h.getLayout,
          annotations: annotations.read,
        },
      ];
    },
  };
}
