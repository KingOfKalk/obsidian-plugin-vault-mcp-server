import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { validateVaultPath } from '../../utils/path-guard';
import { truncateText } from '../shared/truncate';
import { handleToolError } from '../shared/errors';
import { paginate, readPagination } from '../shared/pagination';
import { makeResponse, readResponseFormat } from '../shared/response';
import type { InferredParams } from '../../registry/types';
import type { ToolContext } from '../../registry/tool-context';
import type {
  searchFulltextSchema,
  filePathSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
  readOnlySchema,
} from './schemas';

export interface SearchHandlers {
  searchFulltext: (
    params: InferredParams<typeof searchFulltextSchema>,
    ctx?: ToolContext,
  ) => Promise<CallToolResult>;
  searchFrontmatter: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchTags: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  searchHeadings: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchOutgoingLinks: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchEmbeds: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchBacklinks: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchResolvedLinks: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  searchUnresolvedLinks: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  searchBlockReferences: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchByTag: (params: InferredParams<typeof searchByTagSchema>) => Promise<CallToolResult>;
  searchByFrontmatter: (params: InferredParams<typeof searchByFrontmatterSchema>) => Promise<CallToolResult>;
}

function renderKeyValue(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '_No entries._';
  return entries.map(([k, v]) => `- **${k}**: ${String(v)}`).join('\n');
}

function renderPathList(items: string[], empty = 'No matches.'): string {
  if (items.length === 0) return empty;
  return items.map((p) => `- ${p}`).join('\n');
}

function renderPaginatedPaths(
  page: {
    total: number;
    count: number;
    items: string[];
    has_more: boolean;
    next_offset?: number;
  },
  label: string,
): string {
  const header = `**${String(page.total)} ${label}${page.total === 1 ? '' : 's'}**`;
  const body = renderPathList(page.items);
  const footer = page.has_more
    ? `\n\n_Showing ${String(page.count)} of ${String(page.total)} — next offset: ${String(page.next_offset ?? '')}_`
    : '';
  return `${header}\n\n${body}${footer}`;
}

export function createSearchHandlers(adapter: ObsidianAdapter): SearchHandlers {
  const vaultPath = adapter.getVaultPath();

  return {
    async searchFulltext(params, ctx): Promise<CallToolResult> {
      try {
        const lowerQuery = params.query.toLowerCase();
        const allFiles = adapter.getAllFiles();
        const total = allFiles.length;
        const matched: Array<{ path: string; matches: string[] }> = [];

        let lastPct = -1;
        for (let i = 0; i < total; i++) {
          if (ctx?.signal.aborted) {
            throw new Error('Cancelled');
          }
          const path = allFiles[i];
          const content = await adapter.readFile(path);
          if (content.toLowerCase().includes(lowerQuery)) {
            const lines = content.split('\n');
            const matches = lines.filter((line) =>
              line.toLowerCase().includes(lowerQuery),
            );
            matched.push({ path, matches });
          }
          if (ctx) {
            const pct = Math.floor(((i + 1) / total) * 100);
            if (pct > lastPct) {
              lastPct = pct;
              await ctx.reportProgress(
                i + 1,
                total,
                `Scanned ${String(i + 1)}/${String(total)} files`,
              );
            }
          }
        }

        const page = paginate(matched, readPagination(params));
        const result = makeResponse(
          page,
          (v) => {
            if (v.items.length === 0) return 'No matches.';
            const lines = v.items.map(
              (m) =>
                `- ${m.path} (${String(m.matches.length)} match${m.matches.length === 1 ? '' : 'es'})`,
            );
            const pager = v.has_more
              ? `\n\n_Showing ${String(v.count)} of ${String(v.total)} — next offset: ${String(v.next_offset ?? '')}_`
              : '';
            return `**${String(v.total)} result${v.total === 1 ? '' : 's'}**\n\n${lines.join('\n')}${pager}`;
          },
          readResponseFormat(params),
        );
        const truncated = truncateText(
          result.content[0].type === 'text' ? result.content[0].text : '',
          { hint: 'Narrow the query, shrink limit, or advance offset.' },
        );
        return {
          ...result,
          content: [{ type: 'text' as const, text: truncated.text }],
        };
      } catch (error) {
        return handleToolError(error);
      }
    },

    searchFrontmatter(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const frontmatter = adapter.getFrontmatter(path) ?? {};
        return Promise.resolve(
          makeResponse(
            { path, frontmatter },
            (v) =>
              `**${v.path}** frontmatter:\n${renderKeyValue(v.frontmatter)}`,
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchTags(params): Promise<CallToolResult> {
      try {
        const allTags = adapter.getAllTags();
        return Promise.resolve(
          makeResponse(
            { tags: allTags },
            (v) => {
              const entries = Object.entries(v.tags);
              if (entries.length === 0) return 'No tags in this vault.';
              return entries
                .map(
                  ([tag, files]) =>
                    `- **${tag}** — ${String(files.length)} file${files.length === 1 ? '' : 's'}`,
                )
                .join('\n');
            },
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchHeadings(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const headings = adapter.getHeadings(path);
        return Promise.resolve(
          makeResponse(
            { path, headings },
            (v) => {
              if (v.headings.length === 0) return `**${v.path}** has no headings.`;
              const lines = v.headings.map(
                (h) => `${'#'.repeat(h.level)} ${h.heading}`,
              );
              return `**${v.path}**\n\n${lines.join('\n')}`;
            },
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchOutgoingLinks(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const links = adapter.getLinks(path);
        return Promise.resolve(
          makeResponse(
            { path, links },
            (v) => {
              if (v.links.length === 0) return `**${v.path}** has no outgoing links.`;
              const lines = v.links.map(
                (l) => `- ${l.displayText ? `[${l.displayText}](${l.link})` : l.link}`,
              );
              return `**${v.path}** links to:\n${lines.join('\n')}`;
            },
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchEmbeds(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const embeds = adapter.getEmbeds(path);
        return Promise.resolve(
          makeResponse(
            { path, embeds },
            (v) => {
              if (v.embeds.length === 0) return `**${v.path}** has no embeds.`;
              const lines = v.embeds.map((e) => `- ${e.link}`);
              return `**${v.path}** embeds:\n${lines.join('\n')}`;
            },
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchBacklinks(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        const backlinks = adapter.getBacklinks(path);
        return Promise.resolve(
          makeResponse(
            { path, backlinks },
            (v) =>
              v.backlinks.length === 0
                ? `**${v.path}** has no backlinks.`
                : `**${v.path}** is linked from:\n${renderPathList(v.backlinks)}`,
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchResolvedLinks(params): Promise<CallToolResult> {
      try {
        const links = adapter.getResolvedLinks();
        return Promise.resolve(
          makeResponse(
            { links },
            (v) => {
              const entries = Object.entries(v.links);
              if (entries.length === 0) return 'No resolved links in this vault.';
              return entries
                .map(([src, targets]) => {
                  const targetLines = Object.entries(targets)
                    .map(([tgt, count]) => `  - ${tgt} (×${String(count)})`)
                    .join('\n');
                  return `- **${src}**\n${targetLines}`;
                })
                .join('\n');
            },
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchUnresolvedLinks(params): Promise<CallToolResult> {
      try {
        const links = adapter.getUnresolvedLinks();
        return Promise.resolve(
          makeResponse(
            { links },
            (v) => {
              const entries = Object.entries(v.links);
              if (entries.length === 0) return 'No unresolved links in this vault.';
              return entries
                .map(([src, targets]) => {
                  const targetLines = Object.entries(targets)
                    .map(([tgt, count]) => `  - ${tgt} (×${String(count)})`)
                    .join('\n');
                  return `- **${src}**\n${targetLines}`;
                })
                .join('\n');
            },
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchBlockReferences(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        return adapter.getFileContent(path).then((content) => {
          const blockRefs = content
            .split('\n')
            .filter((line) => /\^[\w-]+\s*$/.test(line))
            .map((line) => {
              const match = /\^([\w-]+)\s*$/.exec(line);
              return match ? { id: match[1], line: line.trim() } : null;
            })
            .filter((ref): ref is { id: string; line: string } => ref !== null);
          return makeResponse(
            { path, blockRefs },
            (v) => {
              if (v.blockRefs.length === 0) return `**${v.path}** has no block references.`;
              const lines = v.blockRefs.map((b) => `- **^${b.id}** — ${b.line}`);
              return `**${v.path}** block references:\n${lines.join('\n')}`;
            },
            readResponseFormat(params),
          );
        });
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchByTag(params): Promise<CallToolResult> {
      try {
        const tag = params.tag;
        const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
        const allTags = adapter.getAllTags();
        const files = allTags[normalizedTag] ?? [];
        const page = paginate(files, readPagination(params));
        return Promise.resolve(
          makeResponse(
            page,
            (v) => renderPaginatedPaths(v, `file tagged ${normalizedTag}`),
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchByFrontmatter(params): Promise<CallToolResult> {
      try {
        const key = params.key;
        const value = params.value;
        const allFiles = adapter.getAllFiles();
        const matching: string[] = [];
        for (const filePath of allFiles) {
          const fm = adapter.getFrontmatter(filePath);
          if (fm && String(fm[key]) === value) {
            matching.push(filePath);
          }
        }
        const page = paginate(matching, readPagination(params));
        return Promise.resolve(
          makeResponse(
            page,
            (v) => renderPaginatedPaths(v, `file with ${key}=${value}`),
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },
  };
}
