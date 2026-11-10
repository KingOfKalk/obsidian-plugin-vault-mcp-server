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
import { validateToolPath } from '../../utils/path-guard';
import { FolderNotFoundError } from '../shared/errors';
import { describeTool } from '../shared/describe';
import { safeHandlers } from '../shared/handler';
import { noParamsSchema } from '../shared/schemas';
import {
  FILE_PATH_DESC,
  TEMPLATE_VARIABLES_DESC,
  NEW_MODIFIED_DESC,
  vaultPathField,
} from '../shared/descriptions';
import { expandPlaceholders, noteTitle } from '../shared/placeholders';
import { templatesFolder } from '../shared/templates-folder';
import { modifiedIso } from '../shared/modified';
import {
  applyFrontmatter,
  assertMarkdownPath,
  assertSafeFrontmatterKeys,
  frontmatterKeySchema,
} from '../shared/frontmatter';
import { dataResponse, documentResponse } from '../shared/response';

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
};

/**
 * Output schemas of the templates data tools (#467). template_expand is a
 * document tool and has none.
 */
const templateListOutputSchema = {
  folder: z
    .string()
    .describe('The template folder that was listed.'),
  files: z
    .array(z.string())
    .describe('Vault-relative paths of the files in the template folder and its subfolders; empty when the folder is missing.'),
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
  listTemplates: (params: InferredParams<typeof noParamsSchema>) => Promise<CallToolResult>;
  createFromTemplate: (params: InferredParams<typeof createFromTemplateSchema>) => Promise<CallToolResult>;
  expandVariables: (params: InferredParams<typeof expandVariablesSchema>) => Promise<CallToolResult>;
}

function createHandlers(adapter: ObsidianAdapter): TemplatesHandlers {
  const vaultPath = adapter.getVaultPath();
  const configDir = adapter.getConfigDir();

  return safeHandlers<TemplatesHandlers>({
    listTemplates: (): CallToolResult => {
      const folder = validateToolPath(templatesFolder(adapter), vaultPath, configDir);
      let files: string[];
      try {
        files = adapter.listRecursive(folder).files;
      } catch (error) {
        if (!(error instanceof FolderNotFoundError)) throw error;
        files = [];
      }
      return dataResponse({ folder, files });
    },
    async createFromTemplate(params): Promise<CallToolResult> {
      const templatePath = validateToolPath(params.templatePath, vaultPath, configDir);
      const destPath = validateToolPath(params.destPath, vaultPath, configDir);
      const variables = params.variables ?? {};
      const set = params.frontmatter ?? {};
      const setKeys = Object.keys(set);
      if (setKeys.length > 0) {
        assertMarkdownPath(destPath);
        assertSafeFrontmatterKeys(setKeys);
      }
      const templateContent = await adapter.readFile(templatePath);
      const expanded = expandPlaceholders(templateContent, variables, {
        title: noteTitle(destPath),
      });
      await adapter.createFile(destPath, expanded);
      if (setKeys.length === 0) {
        return dataResponse({
          path: destPath,
          templatePath,
          modified: await modifiedIso(adapter, destPath),
        });
      }
      const frontmatter = await applyFrontmatter(adapter, destPath, set);
      return dataResponse({
        path: destPath,
        templatePath,
        frontmatter,
        modified: await modifiedIso(adapter, destPath),
      });
    },
    expandVariables: (params): CallToolResult => {
      const variables = params.variables ?? {};
      const expanded = expandPlaceholders(params.template, variables);
      return documentResponse({}, expanded);
    },
  });
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
              'List the files in the folder set in the core Templates plugin ("templates" if none is set), including subfolders. ' +
              "Templater's folder is not used; use vault_list_recursive to look elsewhere.",
          }),
          schema: noParamsSchema,
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
          handler: h.expandVariables,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
