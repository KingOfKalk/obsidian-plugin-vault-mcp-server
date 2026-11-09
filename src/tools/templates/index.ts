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
import {
  FILE_PATH_DESC,
  TEMPLATE_VARIABLES_DESC,
  NEW_MODIFIED_DESC,
  vaultPathField,
} from '../shared/descriptions';
import { expandPlaceholders } from '../shared/placeholders';
import { modifiedIso } from '../shared/modified';
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
  templatePath: vaultPathField(FILE_PATH_DESC),
  destPath: vaultPathField(FILE_PATH_DESC),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe(TEMPLATE_VARIABLES_DESC),
  frontmatter: z
    .record(frontmatterKeySchema, z.unknown())
    .optional()
    .describe(
      'Keys to set on the new note, mapped to JSON-compatible values (string, number, boolean, null, array or object). ' +
        'Applied after expansion: template keys are kept, keys given here overwrite them. Markdown (.md) destinations only.',
    ),
};

const expandVariablesSchema = {
  template: z
    .string()
    .max(100_000)
    .describe('Template text with {{variable}} placeholders.'),
  variables: z
    .record(z.string(), z.string())
    .optional()
    .describe(TEMPLATE_VARIABLES_DESC),
  ...responseFormatField,
};

/**
 * Output schemas for the templates read tools that emit `structuredContent`
 * (Batch D of #248).
 */
const templateListOutputSchema = {
  files: z
    .array(z.string())
    .describe('Vault-relative paths of the files directly in the top-level "templates" folder; empty when that folder is missing.'),
};

const templateExpandOutputSchema = {
  expanded: z
    .string()
    .describe('Template text with the known placeholders substituted; unknown ones stay as written.'),
};

const createFromTemplateOutputSchema = {
  path: z.string().describe('Vault-relative path of the new file.'),
  templatePath: z.string().describe('Vault-relative path of the template that was used.'),
  frontmatter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('The new note\'s whole frontmatter after the frontmatter parameter was applied. Present only when frontmatter was given.'),
  modified: z.string().describe(NEW_MODIFIED_DESC),
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
            modified: await modifiedIso(adapter, destPath),
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
          { path: destPath, templatePath, frontmatter, modified: await modifiedIso(adapter, destPath) },
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
            summary:
              'List the files directly inside the top-level folder named exactly "templates" (case-sensitive; not recursive). ' +
              'The folder set in the Templates or Templater plugin is not used; use vault_list to look elsewhere.',
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
            summary: 'Create a file by expanding {{variable}} placeholders in a template, optionally setting frontmatter keys on it in the same call. Missing parent folders are created.',
            errors: [
              '"File not found" if templatePath is missing.',
              '"File already exists" if destPath is taken.',
              '"Frontmatter can only be set on Markdown (.md) files" if frontmatter is given for a non-.md destPath.',
            ],
            seeAlso: ['template_expand — to get the expanded text without writing a file.'],
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
            summary: 'Expand {{variable}} placeholders in a given string without writing any file.',
            seeAlso: ['template_create_from — to write the expanded template to a new file.'],
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
