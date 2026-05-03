import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ObsidianAdapter } from '../obsidian/adapter';
import { validateVaultPath } from '../utils/path-guard';

const TEMPLATE_BUILTIN_PLACEHOLDERS = new Set(['date', 'time', 'title']);

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/**
 * Scan a template body for `{{name}}` placeholders. Dedupes (preserving
 * first-seen order) and filters out the built-ins (`date`, `time`,
 * `title`) that the existing `template_expand` tool auto-resolves so the
 * `/expand-template` prompt only asks the user for placeholders that
 * actually need a value.
 */
export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (TEMPLATE_BUILTIN_PLACEHOLDERS.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

interface PathArgs {
  path: string;
}

function userTextMessage(text: string): GetPromptResult {
  return {
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
}

export function createSummarizeNoteHandler(
  adapter: ObsidianAdapter,
): (args: PathArgs) => Promise<GetPromptResult> {
  // async so a synchronous throw from validateVaultPath surfaces as a
  // rejected promise rather than a synchronous throw at the call site.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    const path = validateVaultPath(args.path, adapter.getVaultPath());
    return userTextMessage(
      `Summarize the note at \`${path}\`. First call \`vault_read\` to fetch its contents, then produce a concise summary covering the main points and any actionable items.`,
    );
  };
}

export function createFindRelatedHandler(
  adapter: ObsidianAdapter,
): (args: PathArgs) => Promise<GetPromptResult> {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    const path = validateVaultPath(args.path, adapter.getVaultPath());
    return userTextMessage(
      `Find notes related to \`${path}\`. First read it with \`vault_read\`, then run \`search_fulltext\` on its key terms and \`vault_get_backlinks\` on its path. Cross-reference the results and report the most relevant connections.`,
    );
  };
}
