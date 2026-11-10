import { z } from 'zod';
import moment from 'moment';
import {
  ToolModule,
  ToolDefinition,
  annotations,
  defineTool,
} from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { describeTool } from '../shared/describe';
import { dataResponse } from '../shared/response';
import { noParamsSchema } from '../shared/schemas';
import { safeHandler } from '../shared/handler';

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

/** Local time with milliseconds and UTC offset, e.g. `2026-04-19T08:30:00.000+02:00`. */
const ISO_WITH_OFFSET = 'YYYY-MM-DDTHH:mm:ss.SSSZ';

export function createExtrasModule(_adapter: ObsidianAdapter): ToolModule {
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
            seeAlso: [
              'vault_get_metadata — for a file\'s modified/created timestamp.',
            ],
          }),
          schema: noParamsSchema,
          outputSchema: getDateOutputSchema,
          handler: safeHandler(() => dataResponse({ iso: moment().format(ISO_WITH_OFFSET) })),
          annotations: annotations.read,
        }),
      ];
    },
  };
}

