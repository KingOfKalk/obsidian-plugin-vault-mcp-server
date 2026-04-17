import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }

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
    getDate: (): Promise<CallToolResult> => {
      return Promise.resolve(text(formatIsoWithOffset(new Date())));
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
          description: 'Get the current local datetime as an ISO-8601 string with timezone offset.',
          schema: {},
          handler: h.getDate,
          isReadOnly: true,
        },
      ];
    },
  };
}

