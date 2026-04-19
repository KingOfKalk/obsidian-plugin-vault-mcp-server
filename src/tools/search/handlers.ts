import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateVaultPath } from '../../utils/path-guard';
import { truncateText } from '../shared/truncate';
import { handleToolError } from '../shared/errors';
import { paginate, readPagination } from '../shared/pagination';

type Handler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function truncatedResult(text: string, hint?: string): CallToolResult {
  const result = truncateText(text, hint ? { hint } : {});
  return { content: [{ type: 'text', text: result.text }] };
}

export function createSearchHandlers(adapter: ObsidianAdapter): Record<string, Handler> {
  const vaultPath = adapter.getVaultPath();

  return {
    async searchFulltext(params): Promise<CallToolResult> {
      try {
        const query = params.query as string;
        const all = await adapter.searchContent(query);
        const page = paginate(all, readPagination(params));
        return truncatedResult(
          JSON.stringify(page),
          'Narrow the query, shrink limit, or advance offset.',
        );
      } catch (error) {
        return handleToolError(error);
      }
    },

    searchFrontmatter(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const frontmatter = adapter.getFrontmatter(path);
        return Promise.resolve(textResult(JSON.stringify(frontmatter ?? {})));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchTags(_params): Promise<CallToolResult> {
      try {
        const allTags = adapter.getAllTags();
        return Promise.resolve(textResult(JSON.stringify(allTags)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchHeadings(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const headings = adapter.getHeadings(path);
        return Promise.resolve(textResult(JSON.stringify(headings)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchOutgoingLinks(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const links = adapter.getLinks(path);
        return Promise.resolve(textResult(JSON.stringify(links)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchEmbeds(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const embeds = adapter.getEmbeds(path);
        return Promise.resolve(textResult(JSON.stringify(embeds)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchBacklinks(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        const backlinks = adapter.getBacklinks(path);
        return Promise.resolve(textResult(JSON.stringify(backlinks)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchResolvedLinks(_params): Promise<CallToolResult> {
      try {
        const links = adapter.getResolvedLinks();
        return Promise.resolve(textResult(JSON.stringify(links)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchUnresolvedLinks(_params): Promise<CallToolResult> {
      try {
        const links = adapter.getUnresolvedLinks();
        return Promise.resolve(textResult(JSON.stringify(links)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchBlockReferences(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path as string, vaultPath);
        // Block references are lines containing ^block-id patterns
        return adapter.getFileContent(path).then((content) => {
          const blockRefs = content
            .split('\n')
            .filter((line) => /\^[\w-]+\s*$/.test(line))
            .map((line) => {
              const match = /\^([\w-]+)\s*$/.exec(line);
              return match ? { id: match[1], line: line.trim() } : null;
            })
            .filter(Boolean);
          return textResult(JSON.stringify(blockRefs));
        });
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchByTag(params): Promise<CallToolResult> {
      try {
        const tag = params.tag as string;
        const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
        const allTags = adapter.getAllTags();
        const files = allTags[normalizedTag] ?? [];
        const page = paginate(files, readPagination(params));
        return Promise.resolve(textResult(JSON.stringify(page)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchByFrontmatter(params): Promise<CallToolResult> {
      try {
        const key = params.key as string;
        const value = params.value as string;
        const allFiles = adapter.getAllFiles();
        const matching: string[] = [];
        for (const filePath of allFiles) {
          const fm = adapter.getFrontmatter(filePath);
          if (fm && String(fm[key]) === value) {
            matching.push(filePath);
          }
        }
        const page = paginate(matching, readPagination(params));
        return Promise.resolve(textResult(JSON.stringify(page)));
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },
  };
}
