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
import {
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';

const getDateSchema = { ...responseFormatField };

/**
 * Output schema for the `extras_get_date` tool that emits `structuredContent`
 * (Batch D of #248).
 */
const getDateOutputSchema = {
  iso: z
    .string()
    .describe(
      'Local datetime as an ISO-8601 string with timezone offset, e.g. "2026-04-19T08:30:00.000+02:00".',
    ),
};

interface ExtrasHandlers {
  getDate: (params: InferredParams<typeof getDateSchema>) => Promise<CallToolResult>;
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function formatIsoWithOffset(now: Date): string {
  const offsetMinutes = now.getTimezoneOffset();
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  const ms = pad(now.getMilliseconds(), 3);
  return `${String(y)}-${mo}-${d}T${h}:${mi}:${s}.${ms}${formatOffset(offsetMinutes)}`;
}

function createHandlers(_adapter: ObsidianAdapter): ExtrasHandlers {
  return {
    getDate: (params): Promise<CallToolResult> => {
      const iso = formatIsoWithOffset(new Date());
      return Promise.resolve(
        makeResponse(
          { iso },
          (v) => v.iso,
          readResponseFormat(params),
        ),
      );
    },
  };
}

export function createExtrasModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: {
      id: 'extras',
      name: 'Extras',
      description: 'Utility tools that do not mirror an Obsidian API (disabled by default).',
      group: 'extras',
      defaultEnabled: false,
    },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'extras_get_date',
          title: 'Get current date',
          description: describeTool({
            summary: 'Get the current local datetime as an ISO-8601 string with timezone offset.',
            returns: 'Plain text: e.g. "2026-04-19T08:30:00.000+02:00".',
            examples: ['Use when: stamping a daily note with the current local time.'],
            seeAlso: [
              'vault_get_metadata — when you need a file\'s modified/created timestamp, not today\'s date.',
            ],
          }, getDateSchema),
          schema: getDateSchema,
          outputSchema: getDateOutputSchema,
          handler: h.getDate,
          annotations: annotations.read,
        }),
      ];
    },
  };
}

