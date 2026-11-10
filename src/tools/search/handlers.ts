import { CallToolResult } from '@modelcontextprotocol/server';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { filesWithTag, groupTagsByCase, tagKey } from '../../obsidian/tag-index';
import { isInConfigDir, validateToolPath } from '../../utils/path-guard';
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
import type {
  searchFulltextSchema,
  filePathSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
  searchTagsSchema,
  linksMapSchema,
} from './schemas';

export interface SearchHandlers {
  searchFulltext: (
    params: InferredParams<typeof searchFulltextSchema>,
    ctx?: ToolContext,
  ) => Promise<CallToolResult>;
  searchFrontmatter: (params: InferredParams<typeof filePathSchema>) => Promise<CallToolResult>;
  searchTags: (params: InferredParams<typeof searchTagsSchema>) => Promise<CallToolResult>;
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

/** What search_tags reports per tag (#468): counts, not the files. */
interface TagCounts {
  files: number;
  occurrences: number;
}

type TagEntry = [string, TagCounts];

/**
 * Order tags by name, ignoring case, segment by segment, so a nested tag
 * follows its parent (`#a`, `#a/b`, `#a-x`) and pages stay stable.
 */
function compareTags(a: string, b: string): number {
  const left = tagKey(a).split('/');
  const right = tagKey(b).split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  if (left.length !== right.length) return left.length - right.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function toTagsPage(page: PaginatedResponse<TagEntry>): Record<string, unknown> {
  return {
    tags: Object.fromEntries(page.items),
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

/** An outgoing link or embed with the file it resolves to (#485). */
interface LinkTarget {
  link: string;
  path: string | null;
  subpath?: string;
  displayText?: string;
}

/**
 * Split a link as written into the part Obsidian resolves and its
 * `#Heading` / `#^block` subpath, on the first `#` as Obsidian does.
 */
export function splitLinkSubpath(link: string): { linkpath: string; subpath?: string } {
  const hash = link.indexOf('#');
  if (hash === -1) return { linkpath: link };
  const linkpath = link.slice(0, hash);
  const subpath = link.slice(hash);
  return subpath.length > 1 ? { linkpath, subpath } : { linkpath };
}

export function createSearchHandlers(adapter: ObsidianAdapter): SearchHandlers {
  const vaultPath = adapter.getVaultPath();
  const configDir = adapter.getConfigDir();

  /**
   * Add the resolved `path` and the `subpath` to each link of `source`. A
   * target inside the config folder is reported as unresolved (#462).
   */
  function withTargets(
    refs: Array<{ link: string; displayText?: string }>,
    source: string,
  ): LinkTarget[] {
    return refs.map((ref) => {
      const { linkpath, subpath } = splitLinkSubpath(ref.link);
      const resolved = adapter.resolveLinkpath(linkpath, source);
      return {
        link: ref.link,
        path: resolved === null || isInConfigDir(resolved, configDir) ? null : resolved,
        ...(subpath === undefined ? {} : { subpath }),
        ...(ref.displayText === undefined ? {} : { displayText: ref.displayText }),
      };
    });
  }

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
    const page = paginate(entries, readPagination(params));
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

    searchTags(params): Promise<CallToolResult> {
      try {
        // Counts only (#468): the file lists made the result huge on a
        // large vault; search_by_tag returns the files of one tag.
        const entries: TagEntry[] = Object.entries(groupTagsByCase(adapter.getAllTags()))
          .map(([tag, usage]): TagEntry => [tag, { files: usage.files.length, occurrences: usage.count }])
          .sort(([a], [b]) => compareTags(a, b));
        const page = paginate(entries, readPagination(params));
        return Promise.resolve(fitPage(page, (p) => dataResponse(toTagsPage(p))));
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
        const links = withTargets(adapter.getLinks(path), path);
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
        const embeds = withTargets(adapter.getEmbeds(path), path);
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
        const pagination = readPagination(params);
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
