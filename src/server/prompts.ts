import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { z } from 'zod';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { Logger } from '../utils/logger';
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
  // async so a synchronous throw from validateVaultPath surfaces as a
  // rejected promise rather than a synchronous throw at the call site.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    const path = validateVaultPath(args.path, adapter.getVaultPath());
    return userTextMessage(
      `Find notes related to \`${path}\`. First read it with \`vault_read\`, then run \`search_fulltext\` on its key terms and \`vault_get_aspect\` with \`aspect: "backlinks"\` on its path. Cross-reference the results and report the most relevant connections.`,
    );
  };
}

interface TemplateArgs {
  template: string;
}

const TEMPLATES_FOLDER = 'templates';
const COMPLETER_RESULT_LIMIT = 100;

export function createExpandTemplateHandler(
  adapter: ObsidianAdapter,
): (args: TemplateArgs) => Promise<GetPromptResult> {
  return async (args) => {
    const template = validateVaultPath(args.template, adapter.getVaultPath());
    const body = await adapter.readFile(template);
    const placeholders = extractPlaceholders(body);
    const text = placeholders.length === 0
      ? `Expand the template at \`${template}\`. It has no user-fillable placeholders — read it with \`vault_read\` and pass the body to \`template_expand\` directly.`
      : `Expand the template at \`${template}\`. It contains these placeholders: \`${placeholders.join(', ')}\`. First read the template with \`vault_read\`, then ask the user for values for each placeholder and call \`template_expand\` with the body and the variables. If the user wants the result written to a new note, use \`template_create_from\` (which takes the template path, not the body) instead.`;
    return userTextMessage(text);
  };
}

export function createTemplateCompleter(
  adapter: ObsidianAdapter,
): (partial: string) => Promise<string[]> {
  // async so the return type matches the SDK's CompleteCallback signature
  // (string[] | Promise<string[]>), keeping this consistent with other
  // async-by-convention callbacks in this module.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (partial) => {
    try {
      const list = adapter.list(TEMPLATES_FOLDER);
      const needle = partial.toLowerCase();
      return list.files
        .filter((p) => p.toLowerCase().includes(needle))
        .slice(0, COMPLETER_RESULT_LIMIT);
    } catch {
      return [];
    }
  };
}

export function registerPrompts(
  server: McpServer,
  adapter: ObsidianAdapter,
  logger: Logger,
): void {
  const summarize = createSummarizeNoteHandler(adapter);
  const findRelated = createFindRelatedHandler(adapter);
  const expand = createExpandTemplateHandler(adapter);
  const templateCompleter = createTemplateCompleter(adapter);

  logger.debug('Registering prompt: summarize-note');
  server.registerPrompt(
    'summarize-note',
    {
      title: 'Summarize a vault note',
      description: 'Read a note and produce a concise summary covering its main points and any actionable items.',
      argsSchema: {
        path: z.string().min(1).describe('Vault-relative path to the note to summarize'),
      },
    },
    (args: { path: string }, _extra) => summarize(args),
  );

  logger.debug('Registering prompt: find-related');
  server.registerPrompt(
    'find-related',
    {
      title: 'Find notes related to a given note',
      description: "Cross-reference a note's content against the vault to surface related material.",
      argsSchema: {
        path: z.string().min(1).describe('Vault-relative path to the seed note'),
      },
    },
    (args: { path: string }, _extra) => findRelated(args),
  );

  logger.debug('Registering prompt: expand-template');
  server.registerPrompt(
    'expand-template',
    {
      title: 'Expand a vault template',
      description: 'Discover the placeholders in a template and walk through filling them in.',
      argsSchema: {
        template: completable(
          z.string().min(1).describe('Vault-relative path to the template file'),
          (value) => templateCompleter(value),
        ),
      },
    },
    (args: { template: string }, _extra) => expand(args),
  );
}
