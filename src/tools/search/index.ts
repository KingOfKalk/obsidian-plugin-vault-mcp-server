import { z } from 'zod';
import { ToolModule, ToolDefinition, annotations, defineTool } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createSearchHandlers } from './handlers';
import { describeTool } from '../shared/describe';
import {
  searchFulltextSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
  searchByNameSchema,
  searchTagsSchema,
  linksMapSchema,
} from './schemas';
import { pageOutputFields } from '../shared/pagination';

/**
 * Output schemas of the search tools, all data tools (#467). Each shape
 * mirrors what the handler in `./handlers.ts` puts on `structuredContent`,
 * which is also the JSON text of the result.
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
          .describe('Full text of the lines that contain the query, at most maxMatchesPerFile.'),
        lines: z
          .array(z.number())
          .describe('1-based line number of each entry in matches, in the same order.'),
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
    .record(
      z.string(),
      z.object({
        files: z.number().describe('Number of files using the tag.'),
        occurrences: z.number().describe('Total uses of the tag; a file using it twice counts twice.'),
      }),
    )
    .describe('Map of tag (with leading #) to its counts, for the tags in this page.'),
  ...pageOutputFields,
};

const resolvedLinksOutputSchema = {
  links: z
    .record(z.string(), z.record(z.string(), z.number()))
    .describe('Map of source note path to { target file path: link count }, for the sources in this page.'),
  ...pageOutputFields,
};

const unresolvedLinksOutputSchema = {
  links: z
    .record(z.string(), z.record(z.string(), z.number()))
    .describe(
      'Map of source note path to { link text that matches no file, as written (e.g. "Missing Note"): count }, ' +
        'for the sources in this page; notes without broken links are left out.',
    ),
  ...pageOutputFields,
};

/** The link maps page over source notes (#464). */
const LINK_PAGES = 'over source notes';

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
      description: 'Vault-wide search across contents, file names, tags, frontmatter, and link maps',
    },

    tools(): ToolDefinition[] {
      return [
        defineTool({
          name: 'search_fulltext',
          title: 'Full-text search',
          description: describeTool({
            summary:
              'Case-insensitive substring search in the text of Markdown (.md) notes. Does not match file names or other file types.',
            returns: 'Each item has up to maxMatchesPerFile matching lines and their 1-based line numbers.',
            paging: 'over matching files (total and count are files)',
            seeAlso: ['search_by_name — to find a file by its name.'],
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
            summary:
              'List the tags in the vault\'s Markdown notes (inline and frontmatter) with how many files use each and how often. ' +
              'Case variants are merged under the most common spelling; nested tags have their own entry.',
            paging: 'over tags sorted by name',
            seeAlso: ['search_by_tag — for the notes carrying a tag.'],
          }),
          schema: searchTagsSchema,
          outputSchema: searchTagsOutputSchema,
          handler: handlers.searchTags,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_resolved_links',
          title: 'Find resolved links',
          description: describeTool({
            summary: 'Get the map of resolved links (targets that exist); pass path for one note.',
            paging: LINK_PAGES,
            seeAlso: ['search_unresolved_links — for broken links.'],
          }),
          schema: linksMapSchema,
          outputSchema: resolvedLinksOutputSchema,
          handler: handlers.searchResolvedLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_unresolved_links',
          title: 'Find unresolved links',
          description: describeTool({
            summary: 'Get the map of unresolved links (link text that matches no file); pass path for one note.',
            paging: LINK_PAGES,
            seeAlso: ['search_resolved_links — for links that resolve.'],
          }),
          schema: linksMapSchema,
          outputSchema: unresolvedLinksOutputSchema,
          handler: handlers.searchUnresolvedLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_by_tag',
          title: 'Find notes by tag',
          description: describeTool({
            summary: 'Find Markdown notes that carry a tag (inline #tag or frontmatter tags), matched like Obsidian\'s tag search: any case, nested tags included.',
            paging: '',
            seeAlso: ['search_tags — for the list of tags.'],
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
            paging: '',
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
        defineTool({
          name: 'search_by_name',
          title: 'Find files by name',
          description: describeTool({
            summary: 'Find files of any type by name or path. Results are sorted by path.',
            paging: '',
            seeAlso: ['search_fulltext — to search note text.'],
          }),
          schema: searchByNameSchema,
          outputSchema: paginatedPathPageOutputSchema,
          handler: handlers.searchByName,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
