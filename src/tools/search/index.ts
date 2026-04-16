import { ToolModule, ToolDefinition } from '../../registry/types';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { createSearchHandlers } from './handlers';
import {
  searchFulltextSchema,
  filePathSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
} from './schemas';

export function createSearchModule(adapter: ObsidianAdapter): ToolModule {
  const handlers = createSearchHandlers(adapter);

  return {
    metadata: {
      id: 'search',
      name: 'Search and Metadata',
      description: 'Search vault contents and query file metadata, tags, links, and frontmatter',
      supportsReadOnly: false,
    },

    tools(): ToolDefinition[] {
      return [
        {
          name: 'search_fulltext',
          description: 'Full-text search across vault contents',
          schema: searchFulltextSchema,
          handler: handlers.searchFulltext,
          isReadOnly: true,
        },
        {
          name: 'search_frontmatter',
          description: 'Query frontmatter properties for a given file',
          schema: filePathSchema,
          handler: handlers.searchFrontmatter,
          isReadOnly: true,
        },
        {
          name: 'search_tags',
          description: 'Query all tags in the vault with file associations',
          schema: {},
          handler: handlers.searchTags,
          isReadOnly: true,
        },
        {
          name: 'search_headings',
          description: 'Query headings for a given file',
          schema: filePathSchema,
          handler: handlers.searchHeadings,
          isReadOnly: true,
        },
        {
          name: 'search_outgoing_links',
          description: 'Query all outgoing links for a given file',
          schema: filePathSchema,
          handler: handlers.searchOutgoingLinks,
          isReadOnly: true,
        },
        {
          name: 'search_embeds',
          description: 'Query all embeds for a given file',
          schema: filePathSchema,
          handler: handlers.searchEmbeds,
          isReadOnly: true,
        },
        {
          name: 'search_backlinks',
          description: 'Get all backlinks for a given file',
          schema: filePathSchema,
          handler: handlers.searchBacklinks,
          isReadOnly: true,
        },
        {
          name: 'search_resolved_links',
          description: 'Get resolved links across the vault',
          schema: {},
          handler: handlers.searchResolvedLinks,
          isReadOnly: true,
        },
        {
          name: 'search_unresolved_links',
          description: 'Get unresolved links across the vault',
          schema: {},
          handler: handlers.searchUnresolvedLinks,
          isReadOnly: true,
        },
        {
          name: 'search_block_references',
          description: 'Query block references for a given file',
          schema: filePathSchema,
          handler: handlers.searchBlockReferences,
          isReadOnly: true,
        },
        {
          name: 'search_by_tag',
          description: 'Search files by tag',
          schema: searchByTagSchema,
          handler: handlers.searchByTag,
          isReadOnly: true,
        },
        {
          name: 'search_by_frontmatter',
          description: 'Search files by frontmatter property value',
          schema: searchByFrontmatterSchema,
          handler: handlers.searchByFrontmatter,
          isReadOnly: true,
        },
      ];
    },
  };
}
