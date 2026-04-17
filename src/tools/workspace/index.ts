import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return { content: [{ type: 'text', text: `Error: ${m}` }], isError: true }; }

function createHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  return {
    getActiveLeaf: (): Promise<CallToolResult> => {
      const info = adapter.getActiveLeafInfo();
      if (!info) return Promise.resolve(err('No active leaf'));
      return Promise.resolve(text(JSON.stringify(info)));
    },
    async openFile(params): Promise<CallToolResult> {
      try {
        await adapter.openFile(params.path as string, params.mode as string | undefined);
        return text(`Opened: ${params.path as string}`);
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
        { name: 'workspace_get_active_leaf', description: 'Get active pane info', schema: {}, handler: h.getActiveLeaf, isReadOnly: true },
        { name: 'workspace_open_file', description: 'Open a file in a pane', schema: { path: z.string().min(1), mode: z.string().optional() }, handler: h.openFile, isReadOnly: false },
        { name: 'workspace_list_leaves', description: 'List all open files and panes', schema: {}, handler: h.listLeaves, isReadOnly: true },
        { name: 'workspace_set_active_leaf', description: 'Set focus on a leaf by ID', schema: { leafId: z.string().min(1) }, handler: h.setActiveLeaf, isReadOnly: false },
        { name: 'workspace_get_layout', description: 'Get workspace layout summary', schema: {}, handler: h.getLayout, isReadOnly: true },
      ];
    },
  };
}
