import { z } from 'zod';

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
