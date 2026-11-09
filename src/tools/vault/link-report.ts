import type { ObsidianAdapter } from '../../obsidian/adapter';
import { withDestinationCheck } from '../shared/errors';

/**
 * What `vault_rename`, `vault_move` and `vault_rename_folder` report about
 * internal links after the rename (#430).
 */
export interface LinkUpdateReport {
  /** Links to the moved file(s) in the files whose content changed. */
  linksUpdated: number;
  /** Vault-relative paths (after the rename) whose content changed. */
  updatedFiles: string[];
  /** The "Automatically update internal links" setting; null if unreadable. */
  autoUpdateLinks: boolean | null;
  /** Set when links still point at the old path. */
  warning?: string;
}

/** Map a path that was inside the renamed file/folder to its new path. */
function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(from + '/')) return to + path.slice(from.length);
  return path;
}

/**
 * Rename `from` to `to` through the adapter and report which links were
 * updated.
 *
 * How links are counted: before the rename, the metadata cache's resolved
 * links give every file that links to one of `movedFiles` (the file
 * itself, or every file inside a renamed folder) and how many links it
 * has to them. Those files' contents are read before the rename and again
 * afterwards (at their new path when they were inside the moved folder).
 * A file whose content changed is listed in `updatedFiles`, and all its
 * links to the moved files count towards `linksUpdated`. Obsidian rewrites
 * a file's links to the moved file together, so this is exact in the
 * normal case; a link whose text stays valid after a move (e.g. a
 * shortest-path `[[name]]` link next to a full-path one in the same file)
 * is still counted. Files that link to the moved files but did not change
 * are left out.
 */
export async function renameWithLinkReport(
  adapter: ObsidianAdapter,
  from: string,
  to: string,
  movedFiles: readonly string[],
): Promise<LinkUpdateReport> {
  const moved = new Set(movedFiles);
  const linkCounts = new Map<string, number>();
  for (const [source, targets] of Object.entries(adapter.getResolvedLinks())) {
    let count = 0;
    for (const [target, n] of Object.entries(targets)) {
      if (moved.has(target)) count += n;
    }
    if (count > 0) linkCounts.set(source, count);
  }

  const before = new Map<string, string>();
  for (const source of linkCounts.keys()) {
    try {
      before.set(source, await adapter.readFile(source));
    } catch {
      // Unreadable (e.g. binary or vanished): cannot tell whether it changed.
    }
  }

  const autoUpdateLinks = adapter.getAutoUpdateLinks();
  await withDestinationCheck(to, () => adapter.renameFile(from, to));

  const updatedFiles: string[] = [];
  let linksUpdated = 0;
  for (const [source, oldContent] of before) {
    const current = remapPath(source, from, to);
    let newContent: string;
    try {
      newContent = await adapter.readFile(current);
    } catch {
      continue;
    }
    if (newContent !== oldContent) {
      updatedFiles.push(current);
      linksUpdated += linkCounts.get(source) ?? 0;
    }
  }
  updatedFiles.sort();

  const report: LinkUpdateReport = { linksUpdated, updatedFiles, autoUpdateLinks };
  const linking = [...linkCounts.keys()].filter((source) => !moved.has(source));
  if (autoUpdateLinks !== true && linking.length > 0 && updatedFiles.length === 0) {
    const setting =
      autoUpdateLinks === false
        ? '"Automatically update internal links" is off'
        : 'the "Automatically update internal links" setting could not be read';
    const noun = linking.length === 1 ? 'file links' : 'files link';
    report.warning =
      `${setting} and ${String(linking.length)} ${noun} to ${from}; ` +
      'their links were not updated and still point at the old path.';
  }
  return report;
}

/** One-line summary of a link report for the text output. */
export function describeLinkReport(report: LinkUpdateReport): string {
  const lines: string[] = [];
  if (report.updatedFiles.length > 0) {
    const links = report.linksUpdated === 1 ? 'link' : 'links';
    const files = report.updatedFiles.length === 1 ? 'file' : 'files';
    lines.push(
      `Updated ${String(report.linksUpdated)} ${links} in ${String(report.updatedFiles.length)} ${files}: ${report.updatedFiles.join(', ')}`,
    );
  }
  if (report.warning) lines.push(`Warning: ${report.warning}`);
  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}
