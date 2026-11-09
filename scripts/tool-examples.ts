/**
 * Shared seeded vault, sample arguments and SDK harness for calling every
 * tool through a real MCP `Client`.
 *
 * Two consumers import this module so they cannot drift apart:
 *  - `tests/integration/tools-sdk.test.ts` checks every sample call succeeds
 *    and that its `structuredContent` matches the advertised `outputSchema`.
 *  - `scripts/list-tools.ts` runs the same calls to render the
 *    `{ request, response }` example under each tool in
 *    `docs/tools/<module>.generated.md` (#324).
 *
 * The docs are diffed byte-for-byte in CI, so example collection pins
 * everything that could vary between machines: a fixed clock, UTC as the
 * timezone, fixed file stats and a fresh vault per tool.
 *
 * Dev-only: nothing under `src/` imports this, so it never reaches main.js.
 */

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/server/mcp-server';
import { ModuleRegistry, type ModuleStateMap } from '../src/registry/module-registry';
import { MockObsidianAdapter } from '../src/obsidian/mock-adapter';
import { discoverModules } from '../src/tools';
import { DEFAULT_SETTINGS } from '../src/types';
import { Logger } from '../src/utils/logger';

/**
 * Version the generated docs show instead of manifest.json's. Release PRs
 * only bump the version, so the docs must not contain it or `docs:check`
 * would fail on every release (#402).
 */
export const DOCS_VERSION = '0.0.0-docs';

/** The instant every example sees as "now": 2026-01-15T09:30:00.000Z. */
export const EXAMPLE_NOW = Date.UTC(2026, 0, 15, 9, 30, 0, 0);

/** ctime/mtime for every seeded file: 2026-01-01T12:00:00.000Z. */
const SEED_CTIME = Date.UTC(2026, 0, 1, 12, 0, 0, 0);
/** mtime for every seeded file: 2026-01-10T08:15:00.000Z. */
const SEED_MTIME = Date.UTC(2026, 0, 10, 8, 15, 0, 0);

const ALPHA = '---\nstatus: active\n---\n# Alpha\n\n## Goals\nShip it. ^goal-1\n';

/** Populate a mock vault with the fixed sample notes every example uses. */
export function seedVault(adapter: MockObsidianAdapter): void {
  const stat = { ctime: SEED_CTIME, mtime: SEED_MTIME };
  adapter.addFile('README.md', '# Vault\n\nSee [[projects/alpha]].\n', stat);
  adapter.addFile('projects/alpha.md', ALPHA, stat);
  adapter.addFile('people/ada.md', '# Ada\n\nWorks on [[projects/alpha]].\n', stat);
  adapter.addFile('templates/meeting.md', '# Meeting {{title}}\n', stat);
  adapter.addFolder('empty');
  adapter.setMetadata('projects/alpha.md', {
    frontmatter: { status: 'active' },
    tags: ['#project'],
    headings: [
      { heading: 'Alpha', level: 1 },
      { heading: 'Goals', level: 2 },
    ],
    links: [{ link: 'people/ada' }],
    embeds: [{ link: 'img.png' }],
  });
  adapter.setMetadata('people/ada.md', { links: [{ link: 'projects/alpha' }] });
  adapter.setMetadata('README.md', { links: [{ link: 'projects/alpha' }] });
  adapter.setActiveEditor('projects/alpha.md', ALPHA);
  adapter.setSelection(0, 0, 1, 0);
  adapter.addOpenLeaf('projects/alpha.md', 'leaf-1');
  adapter.setActiveLeafId('leaf-1');
  adapter.addInstalledPlugin('dataview', 'Dataview', true);
  adapter.setDataviewApi({
    queryMarkdown: () => Promise.resolve({ successful: true, value: '| a |' }),
  });
  adapter.setDailyNotesSettings({ format: 'YYYY-MM-DD', folder: 'daily', template: '' });
}

/**
 * One known-good argument set per registered tool. The SDK test fails when a
 * tool is added without an entry here, so every tool keeps an example.
 */
export const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  vault_create: { path: 'new/one.md', content: '# One' },
  vault_read: { path: 'projects/alpha.md' },
  vault_update: { path: 'README.md', content: '# Updated' },
  vault_delete: { path: 'people/ada.md' },
  vault_append: { path: 'README.md', content: '\nmore' },
  vault_replace: {
    path: 'projects/alpha.md',
    oldString: 'Ship it.',
    newString: 'Ship it this week.',
    expectedMtime: '2026-01-10T08:15:00.000Z',
  },
  vault_insert: { path: 'projects/alpha.md', heading: '## Goals', text: 'Write the docs.' },
  vault_get_metadata: { path: 'README.md' },
  vault_rename: { path: 'people/ada.md', newName: 'ada-lovelace.md' },
  vault_move: { path: 'people/ada.md', newPath: 'archive/ada.md' },
  vault_copy: { sourcePath: 'README.md', destPath: 'README-copy.md' },
  vault_create_folder: { path: 'brand-new' },
  vault_delete_folder: { path: 'empty' },
  vault_rename_folder: { path: 'empty', newPath: 'renamed' },
  vault_list: { path: 'projects' },
  vault_list_recursive: { path: 'projects' },
  vault_read_binary: { path: 'README.md' },
  vault_write_binary: { path: 'bin/data.bin', data: 'AAEC' },
  vault_get_aspect: { path: 'projects/alpha.md', aspect: 'backlinks', includeContext: true },
  vault_daily_note: { date: '2026-11-08' },
  vault_set_frontmatter: { path: 'projects/alpha.md', set: { status: 'done', reviewed: true } },
  editor_get_content: {},
  editor_get_active_file: {},
  editor_insert: { line: 0, ch: 0, text: 'x' },
  editor_replace: { fromLine: 0, fromCh: 0, toLine: 0, toCh: 3, text: '+++' },
  editor_delete: { fromLine: 0, fromCh: 0, toLine: 0, toCh: 1 },
  editor_get_cursor: {},
  editor_set_cursor: { line: 1, ch: 0 },
  editor_get_selection: {},
  editor_set_selection: { fromLine: 0, fromCh: 0, toLine: 1, toCh: 0 },
  editor_get_line_count: {},
  search_fulltext: { query: 'alpha' },
  search_tags: {},
  search_resolved_links: {},
  search_unresolved_links: {},
  search_by_tag: { tag: 'project' },
  search_by_frontmatter: { key: 'status', value: 'active' },
  workspace_get_active_leaf: {},
  workspace_open_file: { path: 'README.md' },
  workspace_list_leaves: {},
  workspace_set_active_leaf: { leafId: 'leaf-1' },
  workspace_get_layout: {},
  ui_notice: { message: 'hi' },
  template_list: {},
  template_create_from: {
    templatePath: 'templates/meeting.md',
    destPath: 'meetings/m1.md',
    variables: { title: 'Weekly' },
    frontmatter: { status: 'draft' },
  },
  template_expand: { template: 'Hi {{name}}', variables: { name: 'Ada' } },
  plugin_list: {},
  plugin_check: { pluginId: 'dataview' },
  plugin_dataview_query: { query: 'LIST' },
  plugin_dataview_describe_js_query: { query: 'dv.list([1])' },
  plugin_templater_describe_template: { templatePath: 'templates/meeting.md' },
  plugin_execute_command: { commandId: 'app:reload' },
  extras_get_date: {},
  server_info: {},
};

/**
 * Drops info/debug chatter (one line per registered module, per harness) so
 * `npm run docs:tools` and the test output stay readable. Warnings and
 * errors still reach stderr.
 */
class QuietLogger extends Logger {
  override debug(): void {}
  override info(): void {}
}

export interface Harness {
  client: Client;
  adapter: MockObsidianAdapter;
  close: () => Promise<void>;
}

export interface ConnectOptions {
  /** Version the server reports; defaults to {@link DOCS_VERSION}. */
  version?: string;
  /** Module state applied after enabling everything, e.g. to switch modules off. */
  moduleStates?: ModuleStateMap;
}

/**
 * Start a server over a freshly seeded vault with every module and tool
 * enabled (extras included) and connect a real SDK client to it.
 */
export async function connectSeededServer(options: ConnectOptions = {}): Promise<Harness> {
  const adapter = new MockObsidianAdapter();
  seedVault(adapter);

  const logger = new QuietLogger('test', { debugMode: false, accessKey: '' });
  const registry = new ModuleRegistry(logger);
  for (const m of discoverModules(adapter, {
    getExecuteCommandAllowlist: () => ['app:reload'],
  })) {
    registry.registerModule(m);
  }
  const state: ModuleStateMap = {};
  for (const r of registry.getModules()) {
    const toolStates: Record<string, boolean> = {};
    for (const t of r.module.tools()) toolStates[t.name] = true;
    state[r.module.metadata.id] = { enabled: true, toolStates };
  }
  registry.applyState(state);
  if (options.moduleStates) registry.applyState(options.moduleStates);

  const server = createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger, {
    version: options.version ?? DOCS_VERSION,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);
  // Populate the client's output-schema cache so callTool validates
  // structuredContent against the advertised outputSchema.
  await client.listTools();
  return {
    client,
    adapter,
    close: async (): Promise<void> => {
      await client.close();
      await server.close();
    },
  };
}

/** A recorded call: the `tools/call` params and what the tool returned. */
export interface ToolExample {
  request: { name: string; arguments: Record<string, unknown> };
  result: CallToolResult;
}

/**
 * Run `fn` with `Date` frozen at {@link EXAMPLE_NOW} and the process timezone
 * set to UTC, restoring both afterwards. `new Date()` with no arguments,
 * `Date()` and `Date.now()` all return the fixed instant; every other use of
 * `Date` behaves normally.
 */
export async function withFixedClock<T>(fn: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  const previousTz = process.env.TZ;
  const fixedNow = (): number => EXAMPLE_NOW;
  const FixedDate = new Proxy(RealDate, {
    construct(target, args: unknown[], newTarget): object {
      return Reflect.construct(
        target,
        args.length === 0 ? [EXAMPLE_NOW] : args,
        newTarget,
      ) as object;
    },
    apply(): string {
      return new RealDate(EXAMPLE_NOW).toString();
    },
    get(target, prop, receiver): unknown {
      if (prop === 'now') return fixedNow;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  process.env.TZ = 'UTC';
  globalThis.Date = FixedDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
}

/**
 * Call every tool in {@link SAMPLE_ARGS} once, each against its own freshly
 * seeded vault so write tools never leak into later examples. Calls that
 * report `isError` are dropped: the reference only shows successful calls.
 */
export async function collectToolExamples(): Promise<Map<string, ToolExample>> {
  return await withFixedClock(async () => {
    const examples = new Map<string, ToolExample>();
    for (const [name, args] of Object.entries(SAMPLE_ARGS)) {
      const h = await connectSeededServer();
      try {
        const result = await h.client.callTool({ name, arguments: args });
        if (result.isError !== true) {
          examples.set(name, { request: { name, arguments: args }, result });
        }
      } finally {
        await h.close();
      }
    }
    return examples;
  });
}
