import { ToolModule, ToolDefinition, annotations } from '../../registry/types';
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
    },

    tools(): ToolDefinition[] {
      return [
        {
          name: 'search_fulltext',
          description: 'Full-text search across vault contents',
          schema: searchFulltextSchema,
          handler: handlers.searchFulltext,
          annotations: annotations.read,
        },
        {
          name: 'search_frontmatter',
          description: 'Query frontmatter properties for a given file',
          schema: filePathSchema,
          handler: handlers.searchFrontmatter,
          annotations: annotations.read,
        },
        {
          name: 'search_tags',
          description: 'Query all tags in the vault with file associations',
          schema: {},
          handler: handlers.searchTags,
          annotations: annotations.read,
        },
        {
          name: 'search_headings',
          description: 'Query headings for a given file',
          schema: filePathSchema,
          handler: handlers.searchHeadings,
          annotations: annotations.read,
        },
        {
          name: 'search_outgoing_links',
          description: 'Query all outgoing links for a given file',
          schema: filePathSchema,
          handler: handlers.searchOutgoingLinks,
          annotations: annotations.read,
        },
        {
          name: 'search_embeds',
          description: 'Query all embeds for a given file',
          schema: filePathSchema,
          handler: handlers.searchEmbeds,
          annotations: annotations.read,
        },
        {
          name: 'search_backlinks',
          description: 'Get all backlinks for a given file',
          schema: filePathSchema,
          handler: handlers.searchBacklinks,
          annotations: annotations.read,
        },
        {
          name: 'search_resolved_links',
          description: 'Get resolved links across the vault',
          schema: {},
          handler: handlers.searchResolvedLinks,
          annotations: annotations.read,
        },
        {
          name: 'search_unresolved_links',
          description: 'Get unresolved links across the vault',
          schema: {},
          handler: handlers.searchUnresolvedLinks,
          annotations: annotations.read,
        },
        {
          name: 'search_block_references',
          description: 'Query block references for a given file',
          schema: filePathSchema,
          handler: handlers.searchBlockReferences,
          annotations: annotations.read,
        },
        {
          name: 'search_by_tag',
          description: 'Search files by tag',
          schema: searchByTagSchema,
          handler: handlers.searchByTag,
          annotations: annotations.read,
        },
        {
          name: 'search_by_frontmatter',
          description: 'Search files by frontmatter property value',
          schema: searchByFrontmatterSchema,
          handler: handlers.searchByFrontmatter,
          annotations: annotations.read,
        },
      ];
    },
  };
}
