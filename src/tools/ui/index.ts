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
import { describeTool } from '../shared/describe';
import { dataResponse } from '../shared/response';


const showNoticeSchema = {
  message: z
    .string()
    .min(1)
    .max(1000)
    .describe('Notice text.'),
  duration: z
    .number()
    .int()
    .min(0)
    .max(60_000)
    .optional()
    .describe('Milliseconds until the notice auto-dismisses (0 = sticky).'),
};

const showNoticeOutputSchema = {
  shown: z.boolean().describe('Always true once the notice was shown.'),
};

interface UiHandlers {
  showNotice: (params: InferredParams<typeof showNoticeSchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): UiHandlers {
  return {
    showNotice: (params): Promise<CallToolResult> => {
      adapter.showNotice(params.message, params.duration);
      return Promise.resolve(dataResponse({ shown: true }));
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
          }),
          schema: showNoticeSchema,
          outputSchema: showNoticeOutputSchema,
          handler: h.showNotice,
          annotations: annotations.additive,
        }),
      ];
    },
  };
}
