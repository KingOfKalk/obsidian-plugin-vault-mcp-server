import { CallToolResult } from '@modelcontextprotocol/server';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { filesWithTag, groupTagsByCase } from '../../obsidian/tag-index';
import { validateToolPath } from '../../utils/path-guard';
import { CHARACTER_LIMIT } from '../../constants';
import { FileNotFoundError, handleToolError } from '../shared/errors';
import {
  fitPage,
  paginate,
  readPagination,
  type PaginatedResponse,
} from '../shared/pagination';
import { dataResponse } from '../shared/response';
import type { InferredParams } from '../../registry/types';
import type { ToolContext } from '../../registry/tool-context';
import { LINKS_PAGE_LIMIT } from './schemas';
import type {
  searchFulltextSchema,
  filePathSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
  readOnlySchema,
  linksMapSchema,
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
    params: InferredParams<typeof filePathSchema> & {
      includeContext?: boolean;
      limit?: number;
      offset?: number;
    },
  ) => Promise<CallToolResult>;
  searchResolvedLinks: (params: InferredParams<typeof linksMapSchema>) => Promise<CallToolResult>;
  searchUnresolvedLinks: (params: InferredParams<typeof linksMapSchema>) => Promise<CallToolResult>;
  searchBlockReferences: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchByTag: (params: InferredParams<typeof searchByTagSchema>) => Promise<CallToolResult>;
  searchByFrontmatter: (params: InferredParams<typeof searchByFrontmatterSchema>) => Promise<CallToolResult>;
}

const DEFAULT_MAX_MATCHES_PER_FILE = 5;

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
  entries: ReadonlyArray<{ path: string; lines: number[] }>,
): Promise<BacklinkContext[]> {
  const result: BacklinkContext[] = [];
  for (const entry of entries) {
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

type LinkMap = Record<string, Record<string, number>>;
type LinkMapEntry = [string, Record<string, number>];

/** One page of a link map: `links` holds the page's sources (#464). */
interface LinkMapPage {
  links: LinkMap;
  total: number;
  count: number;
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
}

function toLinkMapPage(page: PaginatedResponse<LinkMapEntry>): LinkMapPage {
  return {
    links: Object.fromEntries(page.items),
    total: page.total,
    count: page.count,
    offset: page.offset,
    hasMore: page.hasMore,
    ...(page.hasMore ? { nextOffset: page.nextOffset } : {}),
  };
}

/** Room for the `aspect` field vault_get_aspect adds to the JSON text. */
const ASPECT_HEADROOM = 64;

/** Paging fields of a backlinks page, next to `backlinks` (#464). */
function backlinkPageFields(page: {
  total: number;
  hasMore: boolean;
  nextOffset?: number;
}): { total: number; hasMore: boolean; nextOffset?: number } {
  return {
    total: page.total,
    hasMore: page.hasMore,
    ...(page.hasMore ? { nextOffset: page.nextOffset } : {}),
  };
}

export function createSearchHandlers(adapter: ObsidianAdapter): SearchHandlers {
  const vaultPath = adapter.getVaultPath();
  const configDir = adapter.getConfigDir();

  /**
   * The sources of a link map, narrowed to one note when `path` is given
   * (the note must exist), without empty sources when `skipEmpty` (#464).
   */
  async function linkMapEntries(
    map: LinkMap,
    params: { path?: string },
    skipEmpty: boolean,
  ): Promise<LinkMapEntry[]> {
    let entries = Object.entries(map);
    if (params.path !== undefined) {
      const path = validateToolPath(params.path, vaultPath, configDir);
      if ((await adapter.stat(path)) === null) throw new FileNotFoundError(path);
      entries = entries.filter(([src]) => src === path);
    }
    return skipEmpty
      ? entries.filter(([, targets]) => Object.keys(targets).length > 0)
      : entries;
  }

  function fitLinkMap(
    entries: LinkMapEntry[],
    params: { limit?: number; offset?: number },
  ): CallToolResult {
    const page = paginate(entries, readPagination(params, LINKS_PAGE_LIMIT));
    return fitPage(page, (p) => dataResponse(toLinkMapPage(p)));
  }

  return {
    async searchFulltext(params, ctx): Promise<CallToolResult> {
      try {
        const lowerQuery = params.query.toLowerCase();
        const allFiles = adapter.getAllFiles();
        const total = allFiles.length;
        const maxMatchesPerFile = params.maxMatchesPerFile ?? DEFAULT_MAX_MATCHES_PER_FILE;
        const matched: Array<{
          path: string;
          matches: string[];
          lines: number[];
          matchCount: number;
        }> = [];

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
              matches: shown.map((index) => lines[index].replace(/\r$/, '')),
              lines: shown.map((index) => index + 1),
              matchCount: hits.length,
            });
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
        // Fewer files instead of cut text (#464): nextOffset then points
        // at the first file left out, and the JSON text stays valid.
        return fitPage(page, (p) => dataResponse(p));
      } catch (error) {
        return handleToolError(error);
      }
    },

    searchFrontmatter(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const frontmatter = adapter.getFrontmatter(path) ?? {};
        return Promise.resolve(
          dataResponse({ path, frontmatter }),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchTags(): Promise<CallToolResult> {
      try {
        const tags: Record<string, string[]> = {};
        const counts: Record<string, number> = {};
        for (const [tag, usage] of Object.entries(groupTagsByCase(adapter.getAllTags()))) {
          tags[tag] = usage.files;
          counts[tag] = usage.count;
        }
        return Promise.resolve(
          dataResponse({ tags, counts }),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchHeadings(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const headings = adapter.getHeadings(path);
        return Promise.resolve(
          dataResponse({ path, headings }),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchOutgoingLinks(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const links = adapter.getLinks(path);
        return Promise.resolve(
          dataResponse({ path, links }),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchEmbeds(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const embeds = adapter.getEmbeds(path);
        return Promise.resolve(
          dataResponse({ path, embeds }),
        );
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    async searchBacklinks(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        const pagination = readPagination(params, LINKS_PAGE_LIMIT);
        // vault_get_aspect adds `"aspect": …` to the JSON text afterwards.
        const limit = CHARACTER_LIMIT - ASPECT_HEADROOM;
        if (params.includeContext === true) {
          // Read only the linking files of this page (#464).
          const page = paginate(adapter.getBacklinkLines(path), pagination);
          const context = await readBacklinkContext(adapter, page.items);
          return fitPage(
            { ...page, items: context },
            (p) =>
              dataResponse({
                path,
                backlinks: p.items.map((b) => b.path),
                backlinkContext: p.items,
                ...backlinkPageFields(p),
              }),
            limit,
          );
        }
        const page = paginate(adapter.getBacklinks(path), pagination);
        return fitPage(
          page,
          (p) => dataResponse({ path, backlinks: p.items, ...backlinkPageFields(p) }),
          limit,
        );
      } catch (error) {
        return handleToolError(error);
      }
    },

    async searchResolvedLinks(params): Promise<CallToolResult> {
      try {
        const entries = await linkMapEntries(adapter.getResolvedLinks(), params, false);
        return fitLinkMap(entries, params);
      } catch (error) {
        return handleToolError(error);
      }
    },

    async searchUnresolvedLinks(params): Promise<CallToolResult> {
      try {
        // A source without broken links carries no information (#464).
        const entries = await linkMapEntries(adapter.getUnresolvedLinks(), params, true);
        return fitLinkMap(entries, params);
      } catch (error) {
        return handleToolError(error);
      }
    },

    searchBlockReferences(params): Promise<CallToolResult> {
      try {
        const path = validateToolPath(params.path, vaultPath, configDir);
        return adapter.getFileContent(path).then((content) => {
          const blockRefs = content
            .split('\n')
            .filter((line) => /\^[\w-]+\s*$/.test(line))
            .map((line) => {
              const match = /\^([\w-]+)\s*$/.exec(line);
              // `text`, not `line`: it is the line's text, not a number (#468).
              return match ? { id: match[1], text: line.trim() } : null;
            })
            .filter((ref): ref is { id: string; text: string } => ref !== null);
          return dataResponse({ path, blockRefs });
        });
      } catch (error) {
        return Promise.resolve(handleToolError(error));
      }
    },

    searchByTag(params): Promise<CallToolResult> {
      try {
        const tag = params.tag;
        // Case-insensitive, nested tags included (#470).
        const files = filesWithTag(adapter.getAllTags(), tag);
        const page = paginate(files, readPagination(params));
        return Promise.resolve(
          dataResponse(page),
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
        return Promise.resolve(
          dataResponse(page),
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
