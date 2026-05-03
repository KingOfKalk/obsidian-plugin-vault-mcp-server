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
import { validateVaultPath } from '../../utils/path-guard';
import { FolderNotFoundError, handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';
import {
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

function expandVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  // Built-in variables
  const now = new Date();
  const builtins: Record<string, string> = {
    date: now.toISOString().split('T')[0],
    time: now.toLocaleTimeString(),
    title: variables.title ?? 'Untitled',
    ...variables,
  };
  for (const [key, value] of Object.entries(builtins)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

const listTemplatesSchema = {
  ...responseFormatField,
};

const createFromTemplateSchema = {
  templatePath: z
    .string()
    .min(1)
    .max(4096)
    .describe('Vault-relative path to the template source file'),
  destPath: z
    .string()
    .min(1)
    .max(4096)
    .describe('Vault-relative path for the new file'),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe('Template variables keyed by name (e.g. { title: "Today" })'),
};

const expandVariablesSchema = {
  template: z
    .string()
    .max(100_000)
    .describe('Template text containing {{variable}} placeholders'),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe('Template variables keyed by name'),
  ...responseFormatField,
};

/**
 * Output schemas for the templates read tools that emit `structuredContent`
 * (Batch D of #248).
 */
const templateListOutputSchema = {
  files: z
    .array(z.string())
    .describe('Vault-relative paths of files in the "templates" folder. Empty when the folder is missing.'),
};

const templateExpandOutputSchema = {
  expanded: z
    .string()
    .describe('Template text with all {{variable}} placeholders substituted.'),
};

interface TemplatesHandlers {
  listTemplates: (params: InferredParams<typeof listTemplatesSchema>) => Promise<CallToolResult>;
  createFromTemplate: (params: InferredParams<typeof createFromTemplateSchema>) => Promise<CallToolResult>;
  expandVariables: (params: InferredParams<typeof expandVariablesSchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): TemplatesHandlers {
  const vaultPath = adapter.getVaultPath();
  const templatesFolder = 'templates';

  return {
    listTemplates: (params): Promise<CallToolResult> => {
      const format = readResponseFormat(params);
      try {
        const result = adapter.list(templatesFolder);
        return Promise.resolve(
          makeResponse(
            { files: result.files },
            (v) => JSON.stringify(v.files),
            format,
          ),
        );
      } catch (error) {
        if (error instanceof FolderNotFoundError) {
          return Promise.resolve(
            makeResponse(
              { files: [] as string[] },
              (v) => JSON.stringify(v.files),
              format,
            ),
          );
        }
        return Promise.resolve(handleToolError(error));
      }
    },
    async createFromTemplate(params): Promise<CallToolResult> {
      try {
        const templatePath = validateVaultPath(params.templatePath, vaultPath);
        const destPath = validateVaultPath(params.destPath, vaultPath);
        const variables = params.variables ?? {};
        const templateContent = await adapter.readFile(templatePath);
        const expanded = expandVariables(templateContent, variables);
        await adapter.createFile(destPath, expanded);
        return text(`Created ${destPath} from template ${templatePath}`);
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
    expandVariables: (params): Promise<CallToolResult> => {
      const format = readResponseFormat(params);
      try {
        const variables = params.variables ?? {};
        const expanded = expandVariables(params.template, variables);
        return Promise.resolve(
          makeResponse({ expanded }, (v) => v.expanded, format),
        );
      } catch (error) {
        return Promise.resolve(err(error instanceof Error ? error.message : String(error)));
      }
    },
  };
}

export function createTemplatesModule(adapter: ObsidianAdapter): ToolModule {
  const h = createHandlers(adapter);
  return {
    metadata: { id: 'templates', name: 'Templates and Content Generation', description: 'List, create from, and expand templates' },
    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'template_list',
          description: describeTool({
            summary: 'List files in the vault\'s "templates" folder.',
            returns: 'JSON: string[] of template file paths. Empty array if the folder is missing.',
          }, listTemplatesSchema),
          schema: listTemplatesSchema,
          outputSchema: templateListOutputSchema,
          handler: h.listTemplates,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'template_create_from',
          description: describeTool({
            summary: 'Create a file by expanding {{variable}} placeholders in a template.',
            args: [
              'templatePath (string): Template source file.',
              'destPath (string): New file path.',
              'variables (Record<string,string>, optional): Variable map. date/time/title are built in.',
            ],
            returns: 'Plain text "Created <dest> from template <src>".',
            errors: [
              '"File not found" if templatePath is missing.',
              '"File already exists" if destPath is taken.',
            ],
          }, createFromTemplateSchema),
          schema: createFromTemplateSchema,
          handler: h.createFromTemplate,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'template_expand',
          description: describeTool({
            summary: 'Expand {{variable}} placeholders in a supplied string without writing any file.',
            args: [
              'template (string): Template body containing {{variable}} tokens.',
              'variables (Record<string,string>, optional): Variable map.',
            ],
            returns: 'Plain text: the expanded string.',
          }, expandVariablesSchema),
          schema: expandVariablesSchema,
          outputSchema: templateExpandOutputSchema,
          handler: h.expandVariables,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
