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

const showConfirmSchema = {
  message: z
    .string()
    .min(1)
    .max(1000)
    .describe('Question to present in the confirmation modal'),
};

const showPromptSchema = {
  message: z
    .string()
    .min(1)
    .max(1000)
    .describe('Prompt label to show in the input modal'),
  defaultValue: z
    .string()
    .max(1000)
    .optional()
    .describe('Pre-filled value for the input field'),
};

interface UiHandlers {
  showNotice: (params: InferredParams<typeof showNoticeSchema>) => Promise<CallToolResult>;
  showConfirm: (params: InferredParams<typeof showConfirmSchema>) => Promise<CallToolResult>;
  showPrompt: (params: InferredParams<typeof showPromptSchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): UiHandlers {
  return {
    showNotice: (params): Promise<CallToolResult> => {
      adapter.showNotice(params.message, params.duration);
      return Promise.resolve(text('Notice shown'));
    },
    // Confirmation modals and input prompts require Obsidian UI interaction
    // that can't be easily automated via MCP. We implement them as stubs
    // that return a structured response indicating they need user interaction.
    showConfirm: (params): Promise<CallToolResult> => {
      return Promise.resolve(text(JSON.stringify({
        type: 'confirm',
        message: params.message,
        note: 'Confirmation modals require user interaction in the Obsidian UI',
      })));
    },
    showPrompt: (params): Promise<CallToolResult> => {
      return Promise.resolve(text(JSON.stringify({
        type: 'prompt',
        message: params.message,
        defaultValue: params.defaultValue ?? '',
        note: 'Input prompts require user interaction in the Obsidian UI',
      })));
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
        defineTool({
          name: 'ui_confirm',
          description: describeTool({
            summary: 'Stub for a confirmation modal — user interaction cannot be captured via MCP.',
            args: ['message (string, 1..1000): Question text.'],
            returns: 'JSON envelope noting that confirmation modals need UI interaction.',
          }),
          schema: showConfirmSchema,
          handler: h.showConfirm,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'ui_prompt',
          description: describeTool({
            summary: 'Stub for an input prompt modal — user input cannot be captured via MCP.',
            args: [
              'message (string, 1..1000): Prompt label.',
              'defaultValue (string, ≤1000, optional): Pre-filled value.',
            ],
            returns: 'JSON envelope noting that prompts need UI interaction.',
          }),
          schema: showPromptSchema,
          handler: h.showPrompt,
          annotations: annotations.additive,
        }),
      ];
    },
  };
}
