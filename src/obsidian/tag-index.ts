// Kept free of runtime `obsidian` imports so the mock adapter (used by
// scripts outside Obsidian) can share it.

/** One entry of the vault-wide tag index returned by `getAllTags()`. */
export interface TagUsage {
  /** Vault-relative paths of the files using the tag, each listed once. */
  files: string[];
  /** Total occurrences of the tag across those files. */
  count: number;
}

/**
 * Build the tag index from per-file tag lists (one entry per occurrence, as
 * Obsidian's metadata cache reports them). Files appear once per tag in
 * input order; `count` sums every occurrence (#431).
 */
export function buildTagIndex(
  entries: Iterable<{ path: string; tags: readonly string[] }>,
): Record<string, TagUsage> {
  const result: Record<string, TagUsage> = {};
  for (const { path, tags } of entries) {
    for (const tag of tags) {
      const usage = (result[tag] ??= { files: [], count: 0 });
      usage.count += 1;
      if (usage.files[usage.files.length - 1] !== path) usage.files.push(path);
    }
  }
  return result;
}

const FRONTMATTER_TAG_KEY = /^tags?$/i;

function frontmatterTagValues(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,\s]+/);
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(frontmatterTagValues);
  return [];
}

/**
 * Tags declared in a note's frontmatter, in Obsidian's `#tag` format, one
 * entry per occurrence. Mirrors Obsidian's `parseFrontMatterTags`: reads
 * the `tags` and `tag` keys (any case), as a list or as a comma/space
 * separated string, with or without a leading `#` (#440).
 */
export function parseFrontmatterTags(
  frontmatter: Record<string, unknown> | null | undefined,
): string[] {
  if (!frontmatter) return [];
  const tags: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!FRONTMATTER_TAG_KEY.test(key)) continue;
    for (const raw of frontmatterTagValues(value)) {
      const name = raw.trim().replace(/^#+/, '');
      if (name !== '') tags.push(`#${name}`);
    }
  }
  return tags;
}
