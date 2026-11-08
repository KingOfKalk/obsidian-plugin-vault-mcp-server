/**
 * End-to-end tool tests through a real MCP SDK `Client` (#388).
 *
 * Unit tests call handlers directly and therefore skip the SDK's own input
 * and output validation. That is how `vault_get_aspect` shipped broken: its
 * `outputSchema` was a `z.discriminatedUnion`, which SDK v1 cannot handle,
 * so every call failed inside the SDK. The tests here go through
 * `tools/list` and `tools/call` exactly like a client would. The SDK client
 * also validates `structuredContent` against the advertised `outputSchema`,
 * so a schema/payload mismatch fails here too.
 */
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry, type ModuleStateMap } from '../../src/registry/module-registry';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { discoverModules } from '../../src/tools';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

const ALPHA = '---\nstatus: active\n---\n# Alpha\n\n## Goals\nShip it. ^goal-1\n';

interface Harness {
  client: Client;
  adapter: MockObsidianAdapter;
  close: () => Promise<void>;
}

async function connect(): Promise<Harness> {
  const adapter = new MockObsidianAdapter();
  adapter.addFile('README.md', '# Vault\n\nSee [[projects/alpha]].\n');
  adapter.addFile('projects/alpha.md', ALPHA);
  adapter.addFile('people/ada.md', '# Ada\n\nWorks on [[projects/alpha]].\n');
  adapter.addFile('templates/meeting.md', '# Meeting {{title}}\n');
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

  const logger = new Logger('test', { debugMode: false, accessKey: '' });
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

  const server = createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger);
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

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first.type === 'text' ? first.text : '';
}

async function call(
  h: Harness,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await h.client.callTool({ name, arguments: args })) as CallToolResult;
}

/**
 * One known-good argument set per registered tool. The coverage test below
 * fails when a tool is added without an entry here, so every tool keeps
 * being exercised through the SDK.
 */
const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  vault_create: { path: 'new/one.md', content: '# One' },
  vault_read: { path: 'projects/alpha.md' },
  vault_update: { path: 'README.md', content: '# Updated' },
  vault_delete: { path: 'people/ada.md' },
  vault_append: { path: 'README.md', content: '\nmore' },
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
  vault_get_aspect: { path: 'projects/alpha.md', aspect: 'headings' },
  vault_daily_note: { date: '2026-11-08' },
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
  },
  template_expand: { template: 'Hi {{name}}', variables: { name: 'Ada' } },
  plugin_list: {},
  plugin_check: { pluginId: 'dataview' },
  plugin_dataview_query: { query: 'LIST' },
  plugin_dataview_describe_js_query: { query: 'dv.list([1])' },
  plugin_templater_describe_template: { templatePath: 'templates/meeting.md' },
  plugin_execute_command: { commandId: 'app:reload' },
  extras_get_date: {},
};

/**
 * Write tools that used to return only text and now also carry a small
 * structured payload (#388 point 8).
 */
const WRITE_TOOLS_WITH_OUTPUT = [
  'vault_create',
  'vault_update',
  'vault_append',
  'vault_rename',
  'vault_move',
  'vault_copy',
  'vault_delete',
  'vault_create_folder',
  'vault_delete_folder',
  'vault_rename_folder',
  'vault_write_binary',
  'editor_insert',
  'editor_replace',
  'editor_delete',
  'editor_set_cursor',
  'editor_set_selection',
  'workspace_open_file',
  'workspace_set_active_leaf',
  'ui_notice',
  'template_create_from',
  'plugin_execute_command',
];

describe('tools through a real SDK client', () => {
  it('advertises outputSchema in tools/list for every tool that declares one', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      const registry = discoverModules(h.adapter).flatMap((m) => m.tools());
      const declared = registry.filter((t) => t.outputSchema !== undefined);
      expect(declared.length).toBeGreaterThan(0);
      for (const def of declared) {
        const listed = tools.find((t) => t.name === def.name);
        expect(listed, def.name).toBeDefined();
        expect(listed?.outputSchema, `${def.name} outputSchema`).toMatchObject({
          type: 'object',
        });
      }
    } finally {
      await h.close();
    }
  });

  it('has a sample call for every registered tool', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      const missing = tools.map((t) => t.name).filter((n) => !(n in SAMPLE_ARGS));
      expect(missing).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('declares an outputSchema on every write tool', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      for (const name of WRITE_TOOLS_WITH_OUTPUT) {
        const listed = tools.find((t) => t.name === name);
        expect(listed?.outputSchema, name).toBeDefined();
      }
    } finally {
      await h.close();
    }
  });

  for (const [name, args] of Object.entries(SAMPLE_ARGS)) {
    it(`${name} succeeds and its structuredContent matches outputSchema`, async () => {
      const h = await connect();
      try {
        const { tools } = await h.client.listTools();
        const listed = tools.find((t) => t.name === name);
        expect(listed, name).toBeDefined();
        // The SDK client throws when structuredContent does not match the
        // advertised outputSchema, so reaching the asserts means it does.
        const result = await call(h, name, args);
        expect(result.isError, textOf(result)).not.toBe(true);
        if (listed?.outputSchema) {
          expect(result.structuredContent, name).toBeDefined();
        }
      } finally {
        await h.close();
      }
    });
  }
});

describe('write tools keep their text and add structuredContent (#388)', () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['vault_create', 'Created file: new/one.md', { path: 'new/one.md', created: true }],
    ['vault_update', 'Updated file: README.md', { path: 'README.md', updated: true }],
    ['vault_append', 'Appended to file: README.md', { path: 'README.md', appended: true }],
    ['vault_delete', 'Deleted file: people/ada.md', { path: 'people/ada.md', deleted: true }],
    [
      'vault_rename',
      'Renamed file: people/ada.md → people/ada-lovelace.md',
      { from: 'people/ada.md', to: 'people/ada-lovelace.md' },
    ],
    [
      'vault_move',
      'Moved file: people/ada.md → archive/ada.md',
      { from: 'people/ada.md', to: 'archive/ada.md' },
    ],
    [
      'vault_copy',
      'Copied file: README.md → README-copy.md',
      { from: 'README.md', to: 'README-copy.md' },
    ],
    ['vault_create_folder', 'Created folder: brand-new', { path: 'brand-new', created: true }],
    [
      'vault_delete_folder',
      'Deleted folder: empty',
      { path: 'empty', deleted: true, recursive: false },
    ],
    ['vault_rename_folder', 'Renamed folder: empty → renamed', { from: 'empty', to: 'renamed' }],
    ['vault_write_binary', 'Wrote binary file: bin/data.bin', { path: 'bin/data.bin', size_bytes: 3 }],
    ['editor_insert', 'Text inserted', { line: 0, ch: 0 }],
    [
      'editor_replace',
      'Text replaced',
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
    ],
    ['editor_delete', 'Text deleted', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 } }],
    ['editor_set_cursor', 'Cursor set', { line: 1, ch: 0 }],
    [
      'editor_set_selection',
      'Selection set',
      { from: { line: 0, ch: 0 }, to: { line: 1, ch: 0 } },
    ],
    ['workspace_open_file', 'Opened: README.md', { path: 'README.md' }],
    ['workspace_set_active_leaf', 'Active leaf set', { leafId: 'leaf-1' }],
    ['ui_notice', 'Notice shown', { shown: true }],
    [
      'template_create_from',
      'Created meetings/m1.md from template templates/meeting.md',
      { path: 'meetings/m1.md', templatePath: 'templates/meeting.md' },
    ],
    [
      'plugin_execute_command',
      'Executed command: app:reload',
      { commandId: 'app:reload', executed: true },
    ],
  ];

  it('covers every write tool', () => {
    expect(cases.map(([name]) => name).sort()).toEqual([...WRITE_TOOLS_WITH_OUTPUT].sort());
  });

  for (const [name, text, structured] of cases) {
    it(name, async () => {
      const h = await connect();
      try {
        const result = await call(h, name, SAMPLE_ARGS[name]);
        expect(textOf(result)).toBe(text);
        expect(result.structuredContent).toEqual(structured);
      } finally {
        await h.close();
      }
    });
  }
});

describe('vault_get_aspect through a real SDK client', () => {
  it('returns frontmatter', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'frontmatter',
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        aspect: 'frontmatter',
        path: 'projects/alpha.md',
        frontmatter: { status: 'active' },
      });
    } finally {
      await h.close();
    }
  });

  it('returns headings', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'headings',
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        aspect: 'headings',
        path: 'projects/alpha.md',
        headings: [
          { heading: 'Alpha', level: 1 },
          { heading: 'Goals', level: 2 },
        ],
      });
    } finally {
      await h.close();
    }
  });

  it('returns backlinks', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'backlinks',
      });
      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as { aspect: string; backlinks: string[] };
      expect(structured.aspect).toBe('backlinks');
      expect([...structured.backlinks].sort()).toEqual(['README.md', 'people/ada.md']);
    } finally {
      await h.close();
    }
  });

  it('returns outgoing links, embeds and block references', async () => {
    const h = await connect();
    try {
      const links = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'outgoing_links',
      });
      expect(links.structuredContent).toMatchObject({ links: [{ link: 'people/ada' }] });
      const embeds = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'embeds',
      });
      expect(embeds.structuredContent).toMatchObject({ embeds: [{ link: 'img.png' }] });
      const refs = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'block_references',
        response_format: 'json',
      });
      expect(refs.structuredContent).toMatchObject({
        aspect: 'block_references',
        blockRefs: [{ id: 'goal-1' }],
      });
      expect(JSON.parse(textOf(refs))).toMatchObject({ aspect: 'block_references' });
    } finally {
      await h.close();
    }
  });
});

describe('vault root listing through a real SDK client', () => {
  for (const root of ['', '/', '.']) {
    it(`vault_list accepts ${JSON.stringify(root)} as the vault root`, async () => {
      const h = await connect();
      try {
        const result = await call(h, 'vault_list', { path: root });
        expect(result.isError, textOf(result)).not.toBe(true);
        const structured = result.structuredContent as { files: string[]; folders: string[] };
        expect(structured.files).toContain('README.md');
        expect(structured.folders).toContain('projects');
      } finally {
        await h.close();
      }
    });

    it(`vault_list_recursive accepts ${JSON.stringify(root)} as the vault root`, async () => {
      const h = await connect();
      try {
        const result = await call(h, 'vault_list_recursive', { path: root });
        expect(result.isError, textOf(result)).not.toBe(true);
        const structured = result.structuredContent as { items: string[] };
        expect(structured.items).toContain('projects/alpha.md');
      } finally {
        await h.close();
      }
    });
  }

  it('still rejects an empty path for file tools', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_read', { path: '' });
      expect(result.isError).toBe(true);
    } finally {
      await h.close();
    }
  });
});

describe('unknown arguments through a real SDK client', () => {
  it('rejects an unknown key and names it with the valid parameters', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_read', { path: 'README.md', extra: 1 });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('Unknown parameter: extra');
      expect(text).toContain('Valid parameters: path');
    } finally {
      await h.close();
    }
  });

  it('points at the misspelled key instead of only "required"', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_rename', {
        path: 'people/ada.md',
        new_name: 'x.md',
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain('Unknown parameter: new_name');
      expect(text).toContain('newName');
    } finally {
      await h.close();
    }
  });

  it('advertises additionalProperties: false in tools/list', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      for (const tool of tools) {
        expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      }
    } finally {
      await h.close();
    }
  });
});
