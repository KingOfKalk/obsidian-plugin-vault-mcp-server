import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition, annotations } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { describeTool } from '../shared/describe';
import {
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

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

function createHandlers(_adapter: ObsidianAdapter): Record<string, Handler> {
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
        {
          name: 'get_date',
          description: describeTool({
            summary: 'Get the current local datetime as an ISO-8601 string with timezone offset.',
            returns: 'Plain text: e.g. "2026-04-19T08:30:00.000+02:00".',
            examples: ['Use when: stamping a daily note with the current local time.'],
          }),
          schema: { ...responseFormatField },
          handler: h.getDate,
          annotations: annotations.read,
        },
      ];
    },
  };
}

