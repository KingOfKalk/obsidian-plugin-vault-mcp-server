/**
 * Obsidian's link resolution (`metadataCache.getFirstLinkpathDest`),
 * re-implemented for the mock and fixture adapters (#485). The real adapter
 * asks Obsidian; this test helper is never part of the shipped plugin.
 *
 * Rule, as in Obsidian: candidates are the files with the link's file name
 * (`.md` appended when the name alone matches nothing); a relative
 * (`./`, `../`) or full vault path picks that file; otherwise files under
 * the source note's folder come first, then the rest, each by shortest path.
 */

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/**
 * Resolve `linkpath` (a link without its `#subpath`) from `sourcePath`.
 * `files` lists every vault path (any extension). Returns the target's
 * vault path, or null when the link is unresolved.
 */
export function resolveLinkpath(
  linkpath: string,
  sourcePath: string,
  files: readonly string[],
): string | null {
  if (linkpath === '') return files.includes(sourcePath) ? sourcePath : null;
  const byName = (name: string): string[] => files.filter((p) => baseName(p).toLowerCase() === name);

  let wanted = linkpath.toLowerCase();
  let candidates = baseName(wanted).includes('.') ? byName(baseName(wanted)) : [];
  if (candidates.length === 0) {
    wanted = `${linkpath}.md`.toLowerCase();
    candidates = byName(baseName(wanted));
  }
  if (candidates.length === 0) return null;
  if (baseName(wanted) === wanted && candidates.length === 1) return candidates[0];

  let folder = dirName(sourcePath).toLowerCase();
  if (wanted.startsWith('./') || wanted.startsWith('../')) {
    if (wanted.startsWith('./../')) wanted = wanted.slice(2);
    if (wanted.startsWith('./')) {
      if (folder !== '') folder += '/';
      wanted = folder + wanted.slice(2);
    } else {
      while (wanted.startsWith('../')) {
        wanted = wanted.slice(3);
        folder = dirName(folder);
      }
      if (folder !== '') folder += '/';
      wanted = folder + wanted;
    }
    const relative = candidates.find((p) => p.toLowerCase() === wanted);
    if (relative !== undefined) return relative;
  }
  if (wanted.startsWith('/')) wanted = wanted.slice(1);
  const exact = candidates.find((p) => p.toLowerCase() === wanted);
  if (exact !== undefined) return exact;
  if (linkpath.startsWith('/')) return null;

  // Obsidian prefers files whose path starts with the source folder (a
  // relative link above has already moved it).
  const matches = candidates.filter((p) => p.toLowerCase().endsWith(wanted));
  const byLength = (a: string, b: string): number => a.length - b.length;
  const near = matches.filter((p) => p.toLowerCase().startsWith(folder)).sort(byLength);
  const far = matches.filter((p) => !p.toLowerCase().startsWith(folder)).sort(byLength);
  return near[0] ?? far[0] ?? null;
}

