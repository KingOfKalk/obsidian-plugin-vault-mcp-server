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

/**
 * A tag in the form tags are compared in: without leading `#` and trailing
 * `/`, lowercased. Obsidian matches tags case-insensitively (#470).
 */
export function tagKey(tag: string): string {
  return tag.trim().replace(/^#+/, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Files carrying `tag` or a tag nested under it (`project` also finds
 * `#project/alpha`), case-insensitively, like Obsidian's `tag:#project`
 * search (#470). Each file once, sorted by path.
 */
export function filesWithTag(index: Record<string, TagUsage>, tag: string): string[] {
  const wanted = tagKey(tag);
  if (wanted === '') return [];
  const files = new Set<string>();
  for (const [name, usage] of Object.entries(index)) {
    const key = tagKey(name);
    if (key !== wanted && !key.startsWith(`${wanted}/`)) continue;
    for (const file of usage.files) files.add(file);
  }
  return [...files].sort();
}

/**
 * Merge tags that differ only in case (`#Project`, `#project`) into one
 * entry, keyed by the most common spelling (most occurrences; the first
 * seen on a tie). Files are listed once, counts are summed (#470).
 */
export function groupTagsByCase(index: Record<string, TagUsage>): Record<string, TagUsage> {
  const groups = new Map<string, Array<[string, TagUsage]>>();
  for (const entry of Object.entries(index)) {
    const key = tagKey(entry[0]);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const result: Record<string, TagUsage> = {};
  for (const group of groups.values()) {
    let [spelling, best] = group[0];
    const files = new Set<string>();
    let count = 0;
    for (const [name, usage] of group) {
      if (usage.count > best.count) [spelling, best] = [name, usage];
      for (const file of usage.files) files.add(file);
      count += usage.count;
    }
    result[spelling] = { files: [...files], count };
  }
  return result;
}
