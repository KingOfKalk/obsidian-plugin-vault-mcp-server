import { CallToolResult } from '@modelcontextprotocol/server';
import { ObsidianAdapter } from '../../obsidian/adapter';
import { filesWithTag, groupTagsByCase, tagKey } from '../../obsidian/tag-index';
import {
  validateFolderListPath,
  validateToolPath,
  withoutConfigDir,
} from '../../utils/path-guard';
import { FileNotFoundError } from '../shared/errors';
import { safeHandlers } from '../shared/handler';
import {
  fitPage,
  paginate,
  readPagination,
  pageOf,
} from '../shared/pagination';
import { dataResponse } from '../shared/response';
import { createNameMatcher } from './name-match';
import type { InferredParams } from '../../registry/types';
import type { ToolContext } from '../../registry/tool-context';
import type {
  searchFulltextSchema,
  searchByTagSchema,
  searchByFrontmatterSchema,
  searchByNameSchema,
  searchTagsSchema,
  linksMapSchema,
  unresolvedLinksSchema,
} from './schemas';

export interface SearchHandlers {
  searchFulltext: (
    params: InferredParams<typeof searchFulltextSchema>,
    ctx?: ToolContext,
  ) => Promise<CallToolResult>;
  searchTags: (params: InferredParams<typeof searchTagsSchema>) => Promise<CallToolResult>;
  searchResolvedLinks: (params: InferredParams<typeof linksMapSchema>) => Promise<CallToolResult>;
  searchUnresolvedLinks: (
    params: InferredParams<typeof unresolvedLinksSchema>,
  ) => Promise<CallToolResult>;
  searchByTag: (params: InferredParams<typeof searchByTagSchema>) => Promise<CallToolResult>;
  searchByFrontmatter: (params: InferredParams<typeof searchByFrontmatterSchema>) => Promise<CallToolResult>;
  searchByName: (params: InferredParams<typeof searchByNameSchema>) => Promise<CallToolResult>;
}

const DEFAULT_MAX_MATCHES_PER_FILE = 5;

type LinkMap = Record<string, Record<string, number>>;
type LinkMapEntry = [string, Record<string, number>];

/** Sources listed per target by search_unresolved_links groupBy target (#505). */
export const MAX_SOURCES_PER_TARGET = 10;

/** One missing link target, summed over its sources (#505). */
interface UnresolvedTarget {
  target: string;
  count: number;
  sourceCount: number;
  sources: string[];
}

/**
 * Group link-map entries by target: counts summed, sorted by count desc then
 * target; each lists its first {@link MAX_SOURCES_PER_TARGET} sources by path.
 */
function groupByTarget(entries: LinkMapEntry[]): UnresolvedTarget[] {
  const byTarget = new Map<string, { count: number; sources: string[] }>();
  for (const [source, targets] of entries) {
    for (const [target, count] of Object.entries(targets)) {
      const group = byTarget.get(target) ?? { count: 0, sources: [] };
      group.count += count;
      group.sources.push(source);
      byTarget.set(target, group);
    }
  }
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...byTarget.entries()]
    .map(([target, { count, sources }]) => ({
      target,
      count,
      sourceCount: sources.length,
      sources: sources.sort(compare).slice(0, MAX_SOURCES_PER_TARGET),
    }))
    .sort((a, b) => b.count - a.count || compare(a.target, b.target));
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
    const page = paginate(entries, readPagination(params));
    return fitPage(page, (p) => dataResponse(pageOf({ links: Object.fromEntries(p.items) }, p)));
  }

  return safeHandlers<SearchHandlers>({
    async searchFulltext(params, ctx): Promise<CallToolResult> {
      const lowerQuery = params.query.toLowerCase();
      // Same folder rules as search_by_name (#504).
      const folder = validateFolderListPath(params.folder ?? '', vaultPath, configDir);
      let allFiles = adapter.getAllFiles();
      if (folder !== '') {
        const inFolder = new Set(adapter.listRecursive(folder).files);
        allFiles = allFiles.filter((path) => inFolder.has(path));
      }
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
          // lastMatches: the end of the file, e.g. newest log rows (#504).
          const shown = params.lastMatches
            ? hits.slice(-maxMatchesPerFile)
            : hits.slice(0, maxMatchesPerFile);
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
    },

    searchTags(params): CallToolResult {
      // Counts only (#468): the file lists made the result huge on a
      // large vault; search_by_tag returns the files of one tag.
      const entries: TagEntry[] = Object.entries(groupTagsByCase(adapter.getAllTags()))
        .map(([tag, usage]): TagEntry => [tag, { files: usage.files.length, occurrences: usage.count }])
        .sort(([a], [b]) => compareTags(a, b));
      const page = paginate(entries, readPagination(params));
      return fitPage(page, (p) => dataResponse(pageOf({ tags: Object.fromEntries(p.items) }, p)));
    },

    async searchResolvedLinks(params): Promise<CallToolResult> {
      const entries = await linkMapEntries(adapter.getResolvedLinks(), params, false);
      return fitLinkMap(entries, params);
    },

    async searchUnresolvedLinks(params): Promise<CallToolResult> {
      // A source without broken links carries no information (#464).
      const entries = await linkMapEntries(adapter.getUnresolvedLinks(), params, true);
      if (params.groupBy !== 'target') return fitLinkMap(entries, params);
      const page = paginate(groupByTarget(entries), readPagination(params));
      return fitPage(page, (p) => dataResponse(pageOf({ targets: p.items }, p)));
    },

    searchByTag(params): CallToolResult {
      const tag = params.tag;
      // Case-insensitive, nested tags included (#470).
      const files = filesWithTag(adapter.getAllTags(), tag);
      const page = paginate(files, readPagination(params));
      return dataResponse(page);
    },

    searchByFrontmatter(params): CallToolResult {
      const key = params.key;
      const value = params.value;
      const prefix = params.match === 'prefix';
      const allFiles = adapter.getAllFiles();
      const matching: FrontmatterHit[] = [];
      for (const filePath of allFiles) {
        const fm = adapter.getFrontmatter(filePath);
        if (!fm || !Object.prototype.hasOwnProperty.call(fm, key)) continue;
        // No value: "has this key" query (#388).
        if (value === undefined || frontmatterValueMatches(fm[key], value, prefix)) {
          // The value too, so no extra call per hit is needed (#503).
          matching.push({ path: filePath, ...hitValue(fm[key]) });
        }
      }
      const page = paginate(matching, readPagination(params));
      return fitPage(page, (p) => dataResponse(p));
    },

    searchByName(params): CallToolResult {
      // Any file type, config folder left out (#491).
      const folder = validateFolderListPath(params.folder ?? '', vaultPath, configDir);
      const matches = createNameMatcher(params.query);
      const files = withoutConfigDir(adapter.listRecursive(folder), configDir)
        .files.filter(matches)
        .sort();
      const page = paginate(files, readPagination(params));
      return fitPage(page, (p) => dataResponse(p));
    },
  });
}

/** A search_by_frontmatter hit: the note and its value of `key` (#503). */
interface FrontmatterHit {
  path: string;
  value: unknown;
  valueTruncated?: true;
}

/**
 * Longest value a hit carries, in characters of its JSON (#503). Pages
 * stay useful with long values (e.g. a summary), and one hit can never
 * exceed CHARACTER_LIMIT on its own; the full value is in
 * vault_get_aspect frontmatter.
 */
export const FRONTMATTER_VALUE_LIMIT = 1000;

/**
 * The value as Obsidian parsed it, or, when its JSON is longer than
 * FRONTMATTER_VALUE_LIMIT, the start of the string (of the JSON for
 * anything else) and `valueTruncated: true`.
 */
function hitValue(raw: unknown): { value: unknown; valueTruncated?: true } {
  const value = raw === undefined ? null : raw;
  const json = JSON.stringify(value);
  if (json.length <= FRONTMATTER_VALUE_LIMIT) return { value };
  const text = typeof value === 'string' ? value : json;
  return { value: text.slice(0, FRONTMATTER_VALUE_LIMIT), valueTruncated: true };
}

/**
 * Whether one frontmatter value matches `value`. Exact: compared as a
 * string, case-sensitive. Prefix (#503): the string form of a string,
 * number or boolean starts with `value`; objects and null never match.
 */
function scalarMatches(item: unknown, value: string, prefix: boolean): boolean {
  if (!prefix) return String(item) === value;
  if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
    return false;
  }
  return String(item).startsWith(value);
}

/**
 * A list value (`tags: [a, b]`) matches when any element matches `value`;
 * anything else is compared as a whole (#405).
 */
function frontmatterValueMatches(actual: unknown, value: string, prefix: boolean): boolean {
  if (Array.isArray(actual)) {
    return actual.some((item) => scalarMatches(item, value, prefix));
  }
  return scalarMatches(actual, value, prefix);
}
