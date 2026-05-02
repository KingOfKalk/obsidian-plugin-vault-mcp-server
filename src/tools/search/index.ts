import { ToolModule, ToolDefinition, annotations, defineTool } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createSearchHandlers } from './handlers';
import { describeTool } from '../shared/describe';
import {
  searchFulltextSchema,
  filePathSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
  readOnlySchema,
} from './schemas';

export function createSearchModule(adapter: ObsidianAdapter): ToolModule {
  const handlers = createSearchHandlers(adapter);

  return {
    metadata: {
      id: 'search',
      name: 'Search and Metadata',
      description: 'Search vault contents and query file metadata, tags, links, and frontmatter',
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
          handler: handlers.searchFulltext,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_frontmatter',
          description: describeTool({
            summary: 'Get the parsed YAML frontmatter block for a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: the frontmatter object, or {} when absent.',
            errors: ['"File not found" if the path does not exist.'],
          }, filePathSchema),
          schema: filePathSchema,
          handler: handlers.searchFrontmatter,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_tags',
          description: describeTool({
            summary: 'List every tag used anywhere in the vault with the files that use it.',
            returns: 'JSON: Record<tag, string[]>. Each key is the tag including leading #.',
          }, readOnlySchema),
          schema: readOnlySchema,
          handler: handlers.searchTags,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_headings',
          description: describeTool({
            summary: 'List headings (with levels) for a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ heading, level }].',
            errors: ['"File not found" if the path does not exist.'],
          }, filePathSchema),
          schema: filePathSchema,
          handler: handlers.searchHeadings,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_outgoing_links',
          description: describeTool({
            summary: 'List outgoing links from a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ link, displayText? }].',
            errors: ['"File not found" if the path does not exist.'],
          }, filePathSchema),
          schema: filePathSchema,
          handler: handlers.searchOutgoingLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_embeds',
          description: describeTool({
            summary: 'List embedded resources (![[...]]) referenced by a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ link, displayText? }].',
            errors: ['"File not found" if the path does not exist.'],
          }, filePathSchema),
          schema: filePathSchema,
          handler: handlers.searchEmbeds,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_backlinks',
          description: describeTool({
            summary: 'List files that link TO a given file (reverse links).',
            args: ['path (string): Target file path.'],
            returns: 'JSON: string[] of paths that reference the target.',
            errors: ['"File not found" if the path does not exist.'],
          }, filePathSchema),
          schema: filePathSchema,
          handler: handlers.searchBacklinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_resolved_links',
          description: describeTool({
            summary: 'Get the vault-wide map of resolved links (targets that exist).',
            returns: 'JSON: Record<source, Record<target, count>>.',
          }, readOnlySchema),
          schema: readOnlySchema,
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
          handler: handlers.searchUnresolvedLinks,
          annotations: annotations.read,
        }),
        defineTool({
          name: 'search_block_references',
          description: describeTool({
            summary: 'List block references (^block-id) defined in a file.',
            args: ['path (string): Vault-relative path.'],
            returns: 'JSON: [{ id, line }].',
            errors: ['"File not found" if the path does not exist.'],
          }, filePathSchema),
          schema: filePathSchema,
          handler: handlers.searchBlockReferences,
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
          handler: handlers.searchByFrontmatter,
          annotations: annotations.read,
        }),
      ];
    },
  };
}
