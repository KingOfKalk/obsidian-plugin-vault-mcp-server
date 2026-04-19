import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition, annotations } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateVaultPath } from '../../utils/path-guard';
import { handleToolError } from '../shared/errors';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

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

function createHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  const vaultPath = adapter.getVaultPath();
  const templatesFolder = 'templates';

  return {
    listTemplates: (): Promise<CallToolResult> => {
      try {
        const result = adapter.list(templatesFolder);
        return Promise.resolve(text(JSON.stringify(result.files)));
      } catch {
        return Promise.resolve(text('[]'));
      }
    },
    async createFromTemplate(params): Promise<CallToolResult> {
      try {
        const templatePath = validateVaultPath(params.templatePath as string, vaultPath);
        const destPath = validateVaultPath(params.destPath as string, vaultPath);
        const variables = (params.variables as Record<string, string>) ?? {};
        const templateContent = await adapter.readFile(templatePath);
        const expanded = expandVariables(templateContent, variables);
        await adapter.createFile(destPath, expanded);
        return text(`Created ${destPath} from template ${templatePath}`);
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
    expandVariables: (params): Promise<CallToolResult> => {
      try {
        const template = params.template as string;
        const variables = (params.variables as Record<string, string>) ?? {};
        const result = expandVariables(template, variables);
        return Promise.resolve(text(result));
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
        {
          name: 'template_list',
          description: 'List available templates',
          schema: {},
          handler: h.listTemplates,
          annotations: annotations.read,
        },
        {
          name: 'template_create_from',
          description: 'Create a file from a template with variable substitution',
          schema: {
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
          },
          handler: h.createFromTemplate,
          annotations: annotations.additive,
        },
        {
          name: 'template_expand',
          description: 'Expand template variables in a string',
          schema: {
            template: z
              .string()
              .max(100_000)
              .describe('Template text containing {{variable}} placeholders'),
            variables: z
              .record(z.string(), z.string())
              .optional()
              .describe('Template variables keyed by name'),
          },
          handler: h.expandVariables,
          annotations: annotations.read,
        },
      ];
    },
  };
}
