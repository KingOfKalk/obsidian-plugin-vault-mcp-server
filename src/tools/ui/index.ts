import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }

function createHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  return {
    showNotice: (params) => {
      adapter.showNotice(params.message as string, params.duration as number | undefined);
      return Promise.resolve(text('Notice shown'));
    },
    // Confirmation modals and input prompts require Obsidian UI interaction
    // that can't be easily automated via MCP. We implement them as stubs
    // that return a structured response indicating they need user interaction.
    showConfirm: (params) => {
      return Promise.resolve(text(JSON.stringify({
        type: 'confirm',
        message: params.message as string,
        note: 'Confirmation modals require user interaction in the Obsidian UI',
      })));
    },
    showPrompt: (params) => {
      return Promise.resolve(text(JSON.stringify({
        type: 'prompt',
        message: params.message as string,
        defaultValue: (params.defaultValue as string) ?? '',
        note: 'Input prompts require user interaction in the Obsidian UI',
      })));
    },
  };
}

export function createUiModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'ui', name: 'UI Interactions', description: 'Show notices, modals, and prompts in Obsidian', supportsReadOnly: false },
    tools(): ToolDefinition[] {
      return [
        { name: 'ui_notice', description: 'Show a notice/notification', schema: { message: z.string(), duration: z.number().optional() }, handler: h.showNotice, isReadOnly: false },
        { name: 'ui_confirm', description: 'Show a confirmation modal', schema: { message: z.string() }, handler: h.showConfirm, isReadOnly: false },
        { name: 'ui_prompt', description: 'Show an input prompt modal', schema: { message: z.string(), defaultValue: z.string().optional() }, handler: h.showPrompt, isReadOnly: false },
      ];
    },
  };
}
