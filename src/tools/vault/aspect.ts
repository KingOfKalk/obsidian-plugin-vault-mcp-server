import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ObsidianAdapter } from '../../obsidian/adapter';
import { isInConfigDir, validateToolPath } from '../../utils/path-guard';
import { CHARACTER_LIMIT } from '../../constants';
import { safeHandlers } from '../shared/handler';
import { fitPage, paginate, readPagination } from '../shared/pagination';
import { dataResponse } from '../shared/response';

/** The aspects `vault_get_aspect` returns, one handler each. */
export const ASPECTS = [
  'frontmatter',
  'headings',
  'outgoing_links',
  'embeds',
  'backlinks',
  'block_references',
] as const;

export type Aspect = (typeof ASPECTS)[number];

/** `vault_get_aspect`'s parameters; only backlinks reads the paging ones. */
export type AspectParams = {
  path: string;
  includeContext?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * One handler per aspect. Each returns its aspect's fields without
 * `aspect`; `vault_get_aspect` adds it.
 */
export type AspectHandlers = Record<
  Aspect,
  (params: AspectParams) => Promise<CallToolResult>
>;

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

export function createAspectHandlers(adapter: ObsidianAdapter): AspectHandlers {
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

  return safeHandlers<AspectHandlers>({
    frontmatter(params): CallToolResult {
      const path = validateToolPath(params.path, vaultPath, configDir);
      const frontmatter = adapter.getFrontmatter(path) ?? {};
      return dataResponse({ path, frontmatter });
    },

    headings(params): CallToolResult {
      const path = validateToolPath(params.path, vaultPath, configDir);
      const headings = adapter.getHeadings(path);
      return dataResponse({ path, headings });
    },

    outgoing_links(params): CallToolResult {
      const path = validateToolPath(params.path, vaultPath, configDir);
      const links = withTargets(adapter.getLinks(path), path);
      return dataResponse({ path, links });
    },

    embeds(params): CallToolResult {
      const path = validateToolPath(params.path, vaultPath, configDir);
      const embeds = withTargets(adapter.getEmbeds(path), path);
      return dataResponse({ path, embeds });
    },

    async backlinks(params): Promise<CallToolResult> {
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
    },

    async block_references(params): Promise<CallToolResult> {
      const path = validateToolPath(params.path, vaultPath, configDir);
      const content = await adapter.getFileContent(path);
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
    },
  });
}
