import type { ObsidianAdapter } from '../../obsidian/adapter';
import { FileNotFoundError } from './errors';

/**
 * The file's mtime as an ISO-8601 string, or throw when it is gone. Write
 * tools return it as `modified` so the next write can pass it as
 * `expectedMtime` (#406, #447).
 */
export async function modifiedIso(adapter: ObsidianAdapter, path: string): Promise<string> {
  const stat = await adapter.stat(path);
  if (!stat) throw new FileNotFoundError(path);
  return new Date(stat.mtime).toISOString();
}
