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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DailyNoteArgs {
  date?: string;
}

export function createDailyNoteHandler(): (args: DailyNoteArgs) => Promise<GetPromptResult> {
  // async so a synchronous throw surfaces as a rejected promise.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    if (args.date !== undefined && !ISO_DATE.test(args.date)) {
      throw new Error('date must be YYYY-MM-DD');
    }
    const dateClause = args.date ? ` for \`${args.date}\`` : '';
    const dateArg = args.date ? ` with \`date: "${args.date}"\`` : '';
    return userTextMessage(
      `Open the daily note${dateClause}. First call \`vault_daily_note\`${dateArg} — it returns the note's \`path\`, \`content\`, and a \`created\` flag (true when a new note was just created from the configured template). Then call \`workspace_open_file\` with the returned \`path\` so the note becomes the active leaf. If \`created\` is \`true\`, mention to the user that a fresh daily note was just created.`,
    );
  };
}

function fixBrokenLinksSingleNoteBody(path: string): string {
  return `Fix broken links in \`${path}\`. First call \`search_unresolved_links\` and pull out the entry whose source matches \`${path}\` — the value is a \`Record<target, count>\` of unresolved targets in this note. If \`${path}\` is not in the result, tell the user the note has no unresolved links and stop. For each broken link, propose **one** fix as a single tool call so the user can confirm before it's applied:

- **Retarget** to an existing note: locate the intended target with \`search_fulltext\` or \`vault_list_recursive\`, then read \`${path}\` with \`vault_read\`, rewrite the link, and write it back with \`vault_update\` (or \`editor_replace\` if \`${path}\` is the active editor and you know the exact range).
- **Create a stub** for the missing note: call \`vault_create\` at the link's target path with a minimal placeholder body.
- **Delete the link**: read \`${path}\` with \`vault_read\`, remove just the wikilink (keep surrounding prose), and write back with \`vault_update\`.
- **Leave as-is**: skip and explain why.

Apply fixes one at a time. Wait for the user to confirm each tool call before moving on.`;
}

const FIX_BROKEN_LINKS_VAULT_WIDE_BODY = `Fix broken links across the vault. First call \`search_unresolved_links\` to enumerate them — the result is a \`Record<source, Record<target, count>>\` mapping each note containing broken links to its unresolved targets. If more than ~20 source notes are returned, work on the first 20 and report the remaining count so the user can re-run this prompt to continue. For each broken link, propose **one** fix as a single tool call so the user can confirm before it's applied:

- **Retarget** to an existing note: locate the intended target with \`search_fulltext\` or \`vault_list_recursive\`, then read the source note with \`vault_read\`, rewrite the link, and write it back with \`vault_update\` (or \`editor_replace\` if the source is the active editor and you know the exact range).
- **Create a stub** for the missing note: call \`vault_create\` at the link's target path with a minimal placeholder body.
- **Delete the link**: read the source with \`vault_read\`, remove just the wikilink (keep surrounding prose), and write back with \`vault_update\`.
- **Leave as-is**: skip and explain why (e.g. it's an intentional placeholder).

Apply fixes one at a time. Wait for the user to confirm each tool call before moving on.`;

interface FixBrokenLinksArgs {
  path?: string;
}

export function createFixBrokenLinksHandler(
  _adapter: ObsidianAdapter,
): (args: FixBrokenLinksArgs) => Promise<GetPromptResult> {
  // async so a synchronous throw from validateVaultPath surfaces as a
  // rejected promise rather than a synchronous throw at the call site.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    const text = args.path
      ? fixBrokenLinksSingleNoteBody(args.path)
      : FIX_BROKEN_LINKS_VAULT_WIDE_BODY;
    return userTextMessage(text);
  };
}

export function createUnresolvedSourcesCompleter(
  _adapter: ObsidianAdapter,
): (partial: string) => Promise<string[]> {
  // Stub — replaced in Task 4.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (_partial) => {
    throw new Error('not implemented');
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

  const dailyNote = createDailyNoteHandler();

  logger.debug('Registering prompt: daily-note');
  server.registerPrompt(
    'daily-note',
    {
      title: "Open or create today's daily note",
      description: "Resolve, create-if-missing, and open today's daily note (or a given date).",
      argsSchema: {
        date: z
          .string()
          .optional()
          .describe('Optional ISO date (YYYY-MM-DD). Omit for today (local time).'),
      },
    },
    (args: { date?: string }, _extra) => dailyNote(args),
  );
}
