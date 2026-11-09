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
import { validateVaultPath } from '../../utils/path-guard';
import { FolderNotFoundError, handleToolError } from '../shared/errors';
import { describeTool } from '../shared/describe';
import { expandPlaceholders } from '../shared/placeholders';
import { assertSafeFrontmatterKeys, frontmatterKeySchema } from '../shared/frontmatter';
import {
  confirmWithStructured,
  makeResponse,
  readResponseFormat,
  responseFormatField,
} from '../shared/response';

function err(m: string): CallToolResult { return handleToolError(new Error(m)); }

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
    .describe('Template variables keyed by name (e.g. { title: "Today" }). date, time and title are built in; values given here override them.'),
  frontmatter: z
    .record(frontmatterKeySchema, z.unknown())
    .optional()
    .describe(
      'Frontmatter keys to set on the new note, mapped to JSON-compatible values (string, number, boolean, null, array or object). ' +
        'Applied after the template is expanded: keys from the template are kept, keys given here overwrite them. Markdown (.md) destinations only.',
    ),
};

const expandVariablesSchema = {
  template: z
    .string()
    .max(100_000)
    .describe('Template text containing {{variable}} placeholders'),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe('Template variables keyed by name. date, time and title are built in; values given here override them.'),
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

const createFromTemplateOutputSchema = {
  path: z.string().describe('Vault-relative path of the new file.'),
  templatePath: z.string().describe('Vault-relative path of the template that was used.'),
  frontmatter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('The new note\'s whole frontmatter after the frontmatter parameter was applied. Present only when frontmatter was given.'),
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
        const set = params.frontmatter ?? {};
        const setKeys = Object.keys(set);
        if (setKeys.length > 0) {
          if (!destPath.toLowerCase().endsWith('.md')) {
            throw new Error('Frontmatter can only be set on Markdown (.md) files');
          }
          assertSafeFrontmatterKeys(setKeys);
        }
        const templateContent = await adapter.readFile(templatePath);
        const expanded = expandPlaceholders(templateContent, variables);
        await adapter.createFile(destPath, expanded);
        if (setKeys.length === 0) {
          return confirmWithStructured(`Created ${destPath} from template ${templatePath}`, {
            path: destPath,
            templatePath,
          });
        }
        let frontmatter: Record<string, unknown> = {};
        await adapter.processFrontMatter(destPath, (fm) => {
          for (const key of setKeys) {
            fm[key] = set[key];
          }
          // Snapshot as plain JSON so the result is serialisable even if
          // Obsidian hands back richer YAML values.
          frontmatter = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
        });
        return confirmWithStructured(
          `Created ${destPath} from template ${templatePath} (set frontmatter ${setKeys.join(', ')})`,
          { path: destPath, templatePath, frontmatter },
        );
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    },
    expandVariables: (params): Promise<CallToolResult> => {
      const format = readResponseFormat(params);
      try {
        const variables = params.variables ?? {};
        const expanded = expandPlaceholders(params.template, variables);
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
          title: 'List templates',
          description: describeTool({
            summary: 'List files in the vault\'s "templates" folder.',
          }),
          schema: listTemplatesSchema,
          outputSchema: templateListOutputSchema,
          handler: h.listTemplates,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'template_create_from',
          title: 'Create file from template',
          description: describeTool({
            summary: 'Create a file by expanding {{variable}} placeholders in a template, optionally setting frontmatter keys on the new note in the same call. Missing parent folders are created.',
            errors: [
              '"File not found" if templatePath is missing.',
              '"File already exists" if destPath is taken.',
              '"Frontmatter can only be set on Markdown (.md) files" if frontmatter is given for a non-.md destPath.',
            ],
            seeAlso: [
              'template_expand — when you want the expanded template content returned inline, not written to a new vault file.',
            ],
          }),
          schema: createFromTemplateSchema,
          outputSchema: createFromTemplateOutputSchema,
          handler: h.createFromTemplate,
          annotations: annotations.additive,
        }),
        defineTool({
          name: 'template_expand',
          title: 'Expand template inline',
          description: describeTool({
            summary: 'Expand {{variable}} placeholders in a supplied string without writing any file.',
            seeAlso: [
              'template_create_from — when you want the expanded template written to a new vault file, not just returned as text.',
            ],
          }),
          schema: expandVariablesSchema,
          outputSchema: templateExpandOutputSchema,
          handler: h.expandVariables,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
