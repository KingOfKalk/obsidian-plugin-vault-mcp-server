import { CallToolResult } from '@modelcontextprotocol/server';
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
  searchBacklinks: (
    params: InferredParams<typeof filePathSchema> & { includeContext?: boolean },
  ) => Promise<CallToolResult>;
  searchResolvedLinks: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  searchUnresolvedLinks: (params: InferredParams<typeof readOnlySchema>) => Promise<CallToolResult>;
  searchBlockReferences: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchByTag: (params: InferredParams<typeof searchByTagSchema>) => Promise<CallToolResult>;
  searchByFrontmatter: (params: InferredParams<typeof searchByFrontmatterSchema>) => Promise<CallToolResult>;
}

const DEFAULT_MAX_MATCHES_PER_FILE = 5;

function renderKeyValue(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '_No entries._';
  return entries.map(([k, v]) => `- **${k}**: ${String(v)}`).join('\n');
}

interface BacklinkContext {
  path: string;
  matches: Array<{ line: number; text: string }>;
}

/**
 * Turn the adapter's 0-based backlink line numbers into 1-based line
 * numbers plus the text of each line (#408). Lines past the end of the
 * file (stale metadata cache) are dropped.
 */
async function readBacklinkContext(
  adapter: ObsidianAdapter,
  path: string,
): Promise<BacklinkContext[]> {
  const result: BacklinkContext[] = [];
  for (const entry of adapter.getBacklinkLines(path)) {
    const fileLines = entry.lines.length > 0
      ? (await adapter.readFile(entry.path)).split('\n')
      : [];
    const matches = entry.lines
      .filter((line) => line >= 0 && line < fileLines.length)
      .map((line) => ({ line: line + 1, text: fileLines[line].replace(/\r$/, '') }));
    result.push({ path: entry.path, matches });
  }
  return result;
}

function renderPathList(items: string[], empty = 'No matches.'): string {
  if (items.length === 0) return empty;
  return items.map((p) => `- ${p}`).join('\n');
}

/** Longest matching line shown in `search_fulltext`'s markdown text. */
const MAX_MATCH_LINE_CHARS = 200;

/**
 * One `search_fulltext` hit in markdown: the path and match count, then
 * each shown line with its 1-based line number, cut at
 * MAX_MATCH_LINE_CHARS, and how many matching lines were left out (#463).
 */
function renderFulltextItem(
  item: { path: string; matches: string[]; matchCount: number },
  lineNumbers: number[],
): string {
  const noun = item.matchCount === 1 ? 'match' : 'matches';
  const out = [`- ${item.path} (${String(item.matchCount)} ${noun})`];
  item.matches.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const text =
      line.length > MAX_MATCH_LINE_CHARS ? `${line.slice(0, MAX_MATCH_LINE_CHARS)}…` : line;
    const number = lineNumbers[i] === undefined ? '' : `${String(lineNumbers[i])}: `;
    out.push(`  - ${number}${text}`);
  });
  const hidden = item.matchCount - item.matches.length;
  if (hidden > 0) out.push(`  - … ${String(hidden)} more`);
  return out.join('\n');
}

function renderPaginatedPaths(
  page: {
    total: number;
    count: number;
    items: string[];
    hasMore: boolean;
    nextOffset?: number;
  },
  /** Text after the noun, kept verbatim (e.g. `tagged #project`). */
  label: string,
): string {
  // Pluralise the noun only, never the label: the label echoes a tag or
  // value that must stay exact (#463).
  const noun = page.total === 1 ? 'file' : 'files';
  const header = `**${String(page.total)} ${noun} ${label}**`;
  const body = renderPathList(page.items);
  const footer = page.hasMore
    ? `\n\n_Showing ${String(page.count)} of ${String(page.total)} — next offset: ${String(page.nextOffset ?? '')}_`
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
        const maxMatchesPerFile = params.maxMatchesPerFile ?? DEFAULT_MAX_MATCHES_PER_FILE;
        const matched: Array<{ path: string; matches: string[]; matchCount: number }> = [];
        // 1-based line numbers of `matches`, for the markdown text only:
        // structuredContent keeps its documented shape (#463).
        const lineNumbers = new Map<string, number[]>();

        let lastPct = -1;
        for (let i = 0; i < total; i++) {
          if (ctx?.signal.aborted) {
            throw new Error('Cancelled');
          }
          const path = allFiles[i];
          const content = await adapter.readFile(path);
          if (content.toLowerCase().includes(lowerQuery)) {
            const lines = content.split('\n');
            const hits: number[] = [];
            lines.forEach((line, index) => {
              if (line.toLowerCase().includes(lowerQuery)) hits.push(index);
            });
            const shown = hits.slice(0, maxMatchesPerFile);
            matched.push({
              path,
              matches: shown.map((index) => lines[index]),
              matchCount: hits.length,
            });
            lineNumbers.set(path, shown.map((index) => index + 1));
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
            const lines = v.items.map((m) =>
              renderFulltextItem(m, lineNumbers.get(m.path) ?? []),
            );
            const pager = v.hasMore
              ? `\n\n_Showing ${String(v.count)} of ${String(v.total)} — next offset: ${String(v.nextOffset ?? '')}_`
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
        const tags: Record<string, string[]> = {};
        const counts: Record<string, number> = {};
        for (const [tag, usage] of Object.entries(adapter.getAllTags())) {
          tags[tag] = usage.files;
          counts[tag] = usage.count;
        }
        return Promise.resolve(
          makeResponse(
            { tags, counts },
            (v) => {
              const entries = Object.entries(v.tags);
              if (entries.length === 0) return 'No tags in this vault.';
              return entries
                .map(([tag, files]) => {
                  const count = v.counts[tag] ?? files.length;
                  return `- **${tag}** — ${String(files.length)} file${files.length === 1 ? '' : 's'}, ${String(count)} occurrence${count === 1 ? '' : 's'}`;
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

    async searchBacklinks(params): Promise<CallToolResult> {
      try {
        const path = validateVaultPath(params.path, vaultPath);
        if (params.includeContext === true) {
          const backlinkContext = await readBacklinkContext(adapter, path);
          return makeResponse(
            { path, backlinks: backlinkContext.map((b) => b.path), backlinkContext },
            (v) => {
              if (v.backlinkContext.length === 0) return `**${v.path}** has no backlinks.`;
              const blocks = v.backlinkContext.map((b) =>
                [
                  `- ${b.path}`,
                  ...b.matches.map((m) => `  - L${String(m.line)}: ${m.text}`),
                ].join('\n'),
              );
              return `**${v.path}** is linked from:\n${blocks.join('\n')}`;
            },
            readResponseFormat(params),
          );
        }
        const backlinks = adapter.getBacklinks(path);
        return makeResponse(
          { path, backlinks },
          (v) =>
            v.backlinks.length === 0
              ? `**${v.path}** has no backlinks.`
              : `**${v.path}** is linked from:\n${renderPathList(v.backlinks)}`,
          readResponseFormat(params),
        );
      } catch (error) {
        return handleToolError(error);
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
        const files = allTags[normalizedTag]?.files ?? [];
        const page = paginate(files, readPagination(params));
        return Promise.resolve(
          makeResponse(
            page,
            (v) => renderPaginatedPaths(v, `tagged ${normalizedTag}`),
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
          if (!fm || !Object.prototype.hasOwnProperty.call(fm, key)) continue;
          // No value: "has this key" query (#388).
          if (value === undefined || frontmatterValueMatches(fm[key], value)) {
            matching.push(filePath);
          }
        }
        const page = paginate(matching, readPagination(params));
        const label = value === undefined ? `with ${key}` : `with ${key}=${value}`;
        return Promise.resolve(
          makeResponse(
            page,
            (v) => renderPaginatedPaths(v, label),
            readResponseFormat(params),
          ),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },
  };
}

/**
 * A list value (`tags: [a, b]`) matches when any element equals `value`;
 * anything else is compared as a string (#405).
 */
function frontmatterValueMatches(actual: unknown, value: string): boolean {
  if (Array.isArray(actual)) {
    return actual.some((item) => String(item) === value);
  }
  return String(actual) === value;
}
