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
  count: z.number().describe('Number of files in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  items: z
    .array(
      z.object({
        path: z.string().describe('Vault-relative path of the matching file.'),
        matches: z
          .array(z.string())
          .describe('Full text of the lines that contain the query (no line numbers), at most maxMatchesPerFile.'),
        matchCount: z
          .number()
          .describe('Total number of matching lines in the file (not capped).'),
      }),
    )
    .describe('Matching files in this page.'),
  hasMore: z
    .boolean()
    .describe('True when more results are available past this page.'),
  nextOffset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when hasMore is true.'),
};

const searchTagsOutputSchema = {
  tags: z
    .record(z.string(), z.array(z.string()))
    .describe('Map of tag (with leading #) to the vault-relative paths of the files that use it. Each file is listed once per tag.'),
  counts: z
    .record(z.string(), z.number())
    .describe('Map of tag (with leading #) to its total number of occurrences across the vault; a file using a tag twice counts twice. The number of files is the length of the matching tags entry.'),
};

const resolvedLinksOutputSchema = {
  links: z
    .record(z.string(), z.record(z.string(), z.number()))
    .describe('Map of source note path to { target file path: link count }.'),
};

const unresolvedLinksOutputSchema = {
  links: z
    .record(z.string(), z.record(z.string(), z.number()))
    .describe(
      'Map of source note path to { link text that matches no file, as written (e.g. "Missing Note"): count }.',
    ),
};

/** The link maps cover the whole vault in one response (#449). */
const WHOLE_VAULT = 'Covers the whole vault in one response (no paging), so it can be large.';

const paginatedPathPageOutputSchema = {
  total: z
    .number()
    .describe('Total number of matching files before pagination.'),
  count: z.number().describe('Number of files in this page.'),
  offset: z.number().describe('Offset of the first item in this page.'),
  items: z
    .array(z.string())
    .describe('Vault-relative file paths in this page.'),
  hasMore: z
    .boolean()
    .describe('True when there are more files past this page.'),
  nextOffset: z
    .number()
    .optional()
    .describe('Offset to use in the next request when hasMore is true.'),
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
          title: 'Full-text search',
          description: describeTool({
            summary:
              'Case-insensitive substring search in the text of Markdown (.md) notes. Does not match file names or other file types.',
            returns:
              'Pages over matching files (total and count are files). Each item has up to maxMatchesPerFile matching lines, ' +
              'but the markdown text lists only paths and match counts: use responseFormat=json (or structuredContent) for the lines.',
            seeAlso: ['vault_list_recursive — to find a file by its name.'],
          }),
          schema: searchFulltextSchema,
          outputSchema: searchFulltextOutputSchema,
          handler: handlers.searchFulltext,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_tags',
          title: 'List tags',
          description: describeTool({
            summary: 'List every tag in the vault\'s Markdown notes (inline and frontmatter) with the files using it (each once) and its total occurrence count.',
            seeAlso: ['search_by_tag — for the notes carrying a tag.'],
          }),
          schema: readOnlySchema,
          outputSchema: searchTagsOutputSchema,
          handler: handlers.searchTags,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_resolved_links',
          title: 'Find resolved links',
          description: describeTool({
            summary: `Get the map of resolved links (targets that exist). ${WHOLE_VAULT}`,
            seeAlso: ['search_unresolved_links — for broken links.'],
          }),
          schema: readOnlySchema,
          outputSchema: resolvedLinksOutputSchema,
          handler: handlers.searchResolvedLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_unresolved_links',
          title: 'Find unresolved links',
          description: describeTool({
            summary: `Get the map of unresolved links (link text that matches no file). ${WHOLE_VAULT}`,
            seeAlso: ['search_resolved_links — for links that resolve.'],
          }),
          schema: readOnlySchema,
          outputSchema: unresolvedLinksOutputSchema,
          handler: handlers.searchUnresolvedLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_by_tag',
          title: 'Find notes by tag',
          description: describeTool({
            summary: 'Find Markdown notes that carry a tag (inline #tag or frontmatter tags). Matching is exact and case-sensitive.',
            seeAlso: ['search_tags — for the list of tags with their exact spellings.'],
          }),
          schema: searchByTagSchema,
          outputSchema: paginatedPathPageOutputSchema,
          handler: handlers.searchByTag,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_by_frontmatter',
          title: 'Find notes by frontmatter',
          description: describeTool({
            summary: 'Find Markdown notes whose YAML frontmatter has a key, optionally with a given value.',
            examples: [
              'Use when: "find all notes where status == done" -> { key: "status", value: "done" }',
              'Use when: "which notes have a status?" -> { key: "status" }',
            ],
          }),
          schema: searchByFrontmatterSchema,
          outputSchema: paginatedPathPageOutputSchema,
          handler: handlers.searchByFrontmatter,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
