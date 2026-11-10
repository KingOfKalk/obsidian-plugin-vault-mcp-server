import { z } from 'zod';
import type { ObsidianAdapter } from '../../obsidian/adapter';

/** Schema for one frontmatter key name in tool input. */
export const frontmatterKeySchema = z.string().min(1).max(1024);

/** Keys that would reach Object.prototype when assigned on a plain object. */
const FORBIDDEN_FRONTMATTER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Throw `Invalid frontmatter key: <key>` for a key that would reach Object.prototype. */
export function assertSafeFrontmatterKeys(keys: readonly string[]): void {
  for (const key of keys) {
    if (FORBIDDEN_FRONTMATTER_KEYS.has(key)) {
      throw new Error(`Invalid frontmatter key: ${key}`);
    }
  }
}

/** Throw unless `path` is a Markdown file, the only kind with frontmatter. */
export function assertMarkdownPath(path: string): void {
  if (!path.toLowerCase().endsWith('.md')) {
    throw new Error('Frontmatter can only be set on Markdown (.md) files');
  }
}

/**
 * Set the keys of `set` and delete those of `remove` in the frontmatter of
 * `path` through Obsidian, and return the whole frontmatter afterwards.
 * Shared by vault_set_frontmatter and template_create_from.
 */
export async function applyFrontmatter(
  adapter: ObsidianAdapter,
  path: string,
  set: Record<string, unknown>,
  remove: readonly string[] = [],
): Promise<Record<string, unknown>> {
  let frontmatter: Record<string, unknown> = {};
  await adapter.processFrontMatter(path, (fm) => {
    for (const [key, value] of Object.entries(set)) {
      fm[key] = value;
    }
    for (const key of remove) {
      delete fm[key];
    }
    // Snapshot as plain JSON so the result is serialisable even if
    // Obsidian hands back richer YAML values.
    frontmatter = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
  });
  return frontmatter;
}
