import { z } from 'zod';
import { ToolModule, ToolDefinition, annotations, defineTool } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createSearchHandlers } from './handlers';
import { describeTool } from '../shared/describe';
import {
  searchFulltextSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
  readOnlySchema,
} from './schemas';

/**
 * Output schemas for the search tools that emit `structuredContent`. Each
 * shape mirrors what the corresponding handler in `./handlers.ts` puts on
 * `result.structuredContent` — declaring them lets modern MCP clients
 * validate / introspect the typed payload (Batch B of #248).
 */
const searchFulltextOutputSchema = {
  total: z.number().describe('Total number of matched files before pagination.'),
  count: z.number().describe('Number of matches in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  items: z
    .array(
      z.object({
        path: z.string().describe('Vault-relative path of the matching file.'),
        matches: z
          .array(z.string())
          .describe('Lines from the file that contain the query.'),
      }),
    )
    .describe('Matches in this page.'),
  has_more: z
    .boolean()
    .describe('True when more results are available past this page.'),
  next_offset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when has_more is true.'),
};

const searchTagsOutputSchema = {
  tags: z
    .record(z.string(), z.array(z.string()))
    .describe('Map of tag (with leading #) to vault-relative file paths that use it.'),
};

const searchLinksMapOutputSchema = {
  links: z
    .record(z.string(), z.record(z.string(), z.number()))
    .describe('Map of source file path to map of target file path to reference count.'),
};

const paginatedPathPageOutputSchema = {
  total: z
    .number()
    .describe('Total number of matching files before pagination.'),
  count: z.number().describe('Number of files in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  items: z
    .array(z.string())
    .describe('Vault-relative file paths in this page.'),
  has_more: z
    .boolean()
    .describe('True when there are more files past this page.'),
  next_offset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when has_more is true.'),
};

export function createSearchModule(adapter: ObsidianAdapter): ToolModule {
  const handlers = createSearchHandlers(adapter);

  return {
    metadata: {
      id: 'search',
      name: 'Search and Metadata',
      description: 'Vault-wide search across contents, tags, frontmatter, and link maps',
    },

    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'search_fulltext',
          description: describeTool({
            summary: 'Case-insensitive substring search across all vault file contents.',
            args: ['query (string, 1..500): Substring to look for.'],
            returns: 'JSON: [{ path, matches: string[] }]. Truncated at 25 000 characters.',
            examples: ['Use when: "find everything mentioning Obsidian".'],
            errors: ['"Query must not be empty" on empty input.'],
          }, searchFulltextSchema),
          schema: searchFulltextSchema,
          outputSchema: searchFulltextOutputSchema,
          handler: handlers.searchFulltext,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_tags',
          description: describeTool({
            summary: 'List every tag used anywhere in the vault with the files that use it.',
            returns: 'JSON: Record<tag, string[]>. Each key is the tag including leading #.',
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: searchTagsOutputSchema,
          handler: handlers.searchTags,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_resolved_links',
          description: describeTool({
            summary: 'Get the vault-wide map of resolved links (targets that exist).',
            returns: 'JSON: Record<source, Record<target, count>>.',
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: searchLinksMapOutputSchema,
          handler: handlers.searchResolvedLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_unresolved_links',
          description: describeTool({
            summary: 'Get the vault-wide map of unresolved links (targets that do not exist).',
            returns: 'JSON: Record<source, Record<target, count>>.',
            examples: ['Use when: hunting for broken [[wikilinks]] to clean up.'],
          }, readOnlySchema),
          schema: readOnlySchema,
          outputSchema: searchLinksMapOutputSchema,
          handler: handlers.searchUnresolvedLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_by_tag',
          description: describeTool({
            summary: 'Find files tagged with a given tag (with or without leading #).',
            args: ['tag (string, 1..200): Tag to search for, e.g. "project" or "#project".'],
            returns: 'JSON: string[] of vault-relative file paths.',
          }, searchByTagSchema),
          schema: searchByTagSchema,
          outputSchema: paginatedPathPageOutputSchema,
          handler: handlers.searchByTag,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_by_frontmatter',
          description: describeTool({
            summary: 'Find files whose YAML frontmatter has a key with a given value.',
            args: [
              'key (string, 1..200): Frontmatter property name.',
              'value (string, ≤1000): Expected value (compared as stringified).',
            ],
            returns: 'JSON: string[] of matching file paths.',
            examples: ['Use when: "find all notes where status == done".'],
          }, searchByFrontmatterSchema),
          schema: searchByFrontmatterSchema,
          outputSchema: paginatedPathPageOutputSchema,
          handler: handlers.searchByFrontmatter,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
