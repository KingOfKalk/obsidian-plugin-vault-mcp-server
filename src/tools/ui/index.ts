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
import { describeTool } from '../shared/describe';

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }

const showNoticeSchema = {
  message: z
    .string()
    .min(1)
    .max(1000)
    .describe('Notice text to show to the user'),
  duration: z
    .number()
    .int()
    .min(0)
    .max(60_000)
    .optional()
    .describe('Milliseconds before the notice auto-dismisses (0 = sticky)'),
};

interface UiHandlers {
  showNotice: (params: InferredParams<typeof showNoticeSchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): UiHandlers {
  return {
    showNotice: (params): Promise<CallToolResult> => {
      adapter.showNotice(params.message, params.duration);
      return Promise.resolve(text('Notice shown'));
    },
  };
}

export function createUiModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'ui', name: 'UI Interactions', description: 'Show notices, modals, and prompts in Obsidian' },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'ui_notice',
          title: 'Show notice',
          description: describeTool({
            summary: 'Show a transient notice/toast in Obsidian.',
            args: [
              'message (string, 1..1000): Notice text.',
              'duration (integer ms, 0..60000, optional): Auto-dismiss delay (0 = sticky).',
            ],
            returns: 'Plain text "Notice shown".',
          }),
          schema: showNoticeSchema,
          handler: h.showNotice,
          annotations: annotations.additive,
        }),
      ];
    },
  };
}
