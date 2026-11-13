import type { ModuleRegistry } from './module-registry';
import { startInterval } from '../utils/timers';

/**
 * How often the plugin re-checks tool availability (#469). Obsidian has no
 * public event for a community plugin being enabled or disabled, so a cheap
 * poll is how `plugin_dataview_query` appears and disappears in open
 * sessions. Each check walks the tool list once and notifies only on a
 * change.
 */
export const AVAILABILITY_POLL_MS = 5000;

/**
 * Re-check tool availability every `intervalMs` until the returned stop
 * function is called. Also checks once right away.
 */
export function startAvailabilityPolling(
  registry: ModuleRegistry,
  intervalMs: number = AVAILABILITY_POLL_MS,
): () => void {
  registry.refreshAvailability();
  return startInterval(() => {
    registry.refreshAvailability();
  }, intervalMs);
}
