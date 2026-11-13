import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
} from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { describeTool } from '../shared/describe';
import { dataResponse } from '../shared/response';
import { safeHandler } from '../shared/handler';

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

export function createUiModule(adapter: ObsidianAdapter): ToolModule {
  return {
    metadata: { id: 'ui', name: 'UI interactions', description: 'Show notices, modals, and prompts in Obsidian', defaultEnabled: false },
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
          handler: safeHandler((params): CallToolResult => {
            adapter.showNotice(params.message, params.duration);
            return dataResponse({ shown: true });
          }),
          annotations: annotations.additive,
        }),
      ];
    },
  };
}
