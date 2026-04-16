import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateVaultPath } from '../../utils/path-guard';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function text(t: string): CallToolResult { return { content: [{ type: 'text', text: t }] }; }
function err(m: string): CallToolResult { return { content: [{ type: 'text', text: `Error: ${m}` }], isError: true }; }

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
    listTemplates: () => {
      try {
        const result = adapter.list(templatesFolder);
        return Promise.resolve(text(JSON.stringify(result.files)));
      } catch {
        return Promise.resolve(text('[]'));
      }
    },
    async createFromTemplate(params) {
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
    expandVariables: (params) => {
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
    metadata: { id: 'templates', name: 'Templates and Content Generation', description: 'List, create from, and expand templates', supportsReadOnly: true },
    tools(): ToolDefinition[] {
      return [
        { name: 'template_list', description: 'List available templates', schema: {}, handler: h.listTemplates, isReadOnly: true },
        { name: 'template_create_from', description: 'Create a file from a template with variable substitution', schema: { templatePath: z.string().min(1), destPath: z.string().min(1), variables: z.record(z.string(), z.string()).optional() }, handler: h.createFromTemplate, isReadOnly: false },
        { name: 'template_expand', description: 'Expand template variables in a string', schema: { template: z.string(), variables: z.record(z.string(), z.string()).optional() }, handler: h.expandVariables, isReadOnly: true },
      ];
    },
  };
}
