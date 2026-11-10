/**
 * End-to-end tool tests through a real MCP SDK `Client` (#388).
 *
 * Unit tests call handlers directly and therefore skip the SDK's own input
 * and output validation. That is how `vault_get_aspect` shipped broken: its
 * `outputSchema` was a `z.discriminatedUnion`, which SDK v1 cannot handle,
 * so every call failed inside the SDK v1. The tests here go through
 * `tools/list` and `tools/call` exactly like a client would. The SDK client
 * also validates `structuredContent` against the advertised `outputSchema`,
 * so a schema/payload mismatch fails here too.
 */
import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { discoverModules } from '../../src/tools';
import {
  DOT_PNG_BASE64,
  SAMPLE_ARGS,
  connectSeededServer as connect,
  type Harness,
} from '../../scripts/tool-examples';
import { parseDocument, windowOf } from '../helpers/result';

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first.type === 'text' ? first.text : '';
}

async function call(
  h: Harness,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return await h.client.callTool({ name, arguments: args });
}

// SAMPLE_ARGS and the seeded vault live in scripts/tool-examples.ts, shared
// with the docs generator that renders one example per tool (#324). The
// coverage test below fails when a tool is added without an entry there.

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

/**
 * The two result formats (#467). Document tools return plain text (a
 * `key: value` header, a blank line, the raw text) and no
 * structuredContent; vault_read_binary returns binary content blocks; every
 * other tool is a data tool whose one text block is its structuredContent
 * as compact JSON.
 */
const DOCUMENT_TOOLS = [
  'vault_read',
  'vault_daily_note',
  'editor_get_content',
  'template_expand',
  'plugin_dataview_query',
];
const BINARY_TOOLS = ['vault_read_binary'];

describe('result formats through a real SDK client (#467)', () => {
  it('declares an outputSchema on exactly the data tools', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      const withoutSchema = tools.filter((t) => t.outputSchema === undefined).map((t) => t.name);
      expect(withoutSchema.sort()).toEqual([...DOCUMENT_TOOLS, ...BINARY_TOOLS].sort());
    } finally {
      await h.close();
    }
  });

  for (const [name, args] of Object.entries(SAMPLE_ARGS)) {
    if (DOCUMENT_TOOLS.includes(name) || BINARY_TOOLS.includes(name)) continue;
    it(`${name} sends its structuredContent as compact JSON text`, async () => {
      const h = await connect();
      try {
        const result = await call(h, name, args);
        expect(result.isError, textOf(result)).not.toBe(true);
        expect(result.content).toEqual([
          { type: 'text', text: JSON.stringify(result.structuredContent) },
        ]);
      } finally {
        await h.close();
      }
    });
  }

  for (const name of DOCUMENT_TOOLS) {
    it(`${name} sends one plain text block and no structuredContent`, async () => {
      const h = await connect();
      try {
        const result = await call(h, name, SAMPLE_ARGS[name]);
        expect(result.isError, textOf(result)).not.toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');
      } finally {
        await h.close();
      }
    });
  }

  it('vault_read returns the header and the raw note, never JSON-escaped', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_read', { path: 'projects/alpha.md' });
      expect(textOf(result)).toBe(
        'path: projects/alpha.md\nmodified: 2026-01-10T08:15:00.000Z\n' +
          'totalLength: 58\noffset: 0\nhasMore: false\n\n' +
          '---\nstatus: active\n---\n# Alpha\n\n## Goals\nShip it. ^goal-1\n',
      );
    } finally {
      await h.close();
    }
  });

  it('vault_read pages a large note through the header', async () => {
    const h = await connect();
    try {
      const big = Array.from({ length: 3000 }, (_, i) => `line "${String(i)}"\t\\`).join('\n');
      h.adapter.addFile('big.md', big);
      let offset = 0;
      let collected = '';
      for (let guard = 0; guard < 10; guard++) {
        const w = windowOf(await call(h, 'vault_read', { path: 'big.md', offset }));
        collected += w.content;
        if (!w.hasMore) break;
        offset = w.nextOffset ?? 0;
      }
      expect(collected).toBe(big);
    } finally {
      await h.close();
    }
  });

  it('vault_read_binary returns an image block for a PNG, without base64 text', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_read_binary', { path: 'img.png' });
      expect(result.isError, textOf(result)).not.toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([
        { type: 'text', text: 'path: img.png\nmimeType: image/png\nsizeBytes: 70\ncontent: image' },
        { type: 'image', data: DOT_PNG_BASE64, mimeType: 'image/png' },
      ]);
    } finally {
      await h.close();
    }
  });

  it('vault_read_binary returns other types as an embedded resource', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_read_binary', { path: 'README.md' });
      expect(result.content[1]).toEqual({
        type: 'resource',
        resource: {
          uri: 'obsidian://vault/README.md',
          mimeType: 'text/markdown',
          blob: Buffer.from('# Vault\n\nSee [[projects/alpha]].\n').toString('base64'),
        },
      });
    } finally {
      await h.close();
    }
  });
});

describe('write tools return their data as JSON text and structuredContent (#388, #467)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      'vault_create',
      { path: 'new/one.md', created: true, modified: expect.any(String) as unknown },
    ],
    [
      'vault_update',
      { path: 'README.md', updated: true, modified: expect.any(String) as unknown },
    ],
    [
      'vault_append',
      { path: 'README.md', appended: true, modified: expect.any(String) as unknown },
    ],
    [
      'vault_delete',
      { path: 'people/ada.md', deleted: true, trashedTo: 'system' },
    ],
    [
      'vault_rename',
      { from: 'people/ada.md', to: 'people/ada-lovelace.md', linksUpdated: 0, updatedFiles: [], autoUpdateLinks: true },
    ],
    [
      'vault_move',
      { from: 'people/ada.md', to: 'archive/ada.md', linksUpdated: 0, updatedFiles: [], autoUpdateLinks: true },
    ],
    [
      'vault_copy',
      { from: 'README.md', to: 'README-copy.md' },
    ],
    ['vault_create_folder', { path: 'brand-new', created: true }],
    [
      'vault_delete_folder',
      { path: 'empty', deleted: true, recursive: false, trashedTo: 'system' },
    ],
    [
      'vault_rename_folder',
      { from: 'empty', to: 'renamed', linksUpdated: 0, updatedFiles: [], autoUpdateLinks: true },
    ],
    [
      'vault_write_binary',
      { path: 'bin/data.bin', sizeBytes: 3, modified: expect.any(String) as unknown },
    ],
    ['editor_insert', { line: 0, ch: 0 }],
    [
      'editor_replace',
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
    ],
    ['editor_delete', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 } }],
    ['editor_set_cursor', { line: 1, ch: 0 }],
    [
      'editor_set_selection',
      { from: { line: 0, ch: 0 }, to: { line: 1, ch: 0 } },
    ],
    ['workspace_open_file', { path: 'README.md' }],
    ['workspace_set_active_leaf', { leafId: 'leaf-1' }],
    ['ui_notice', { shown: true }],
    [
      'template_create_from',
      {
        path: 'meetings/m1.md',
        templatePath: 'templates/meeting.md',
        frontmatter: { status: 'draft' },
        modified: expect.any(String) as unknown,
      },
    ],
    [
      'plugin_execute_command',
      { commandId: 'editor:save-file', executed: true },
    ],
  ];

  it('covers every write tool', () => {
    expect(cases.map(([name]) => name).sort()).toEqual([...WRITE_TOOLS_WITH_OUTPUT].sort());
  });

  for (const [name, structured] of cases) {
    it(name, async () => {
      const h = await connect();
      try {
        const result = await call(h, name, SAMPLE_ARGS[name]);
        expect(result.structuredContent).toEqual(structured);
        expect(result.content).toEqual([
          { type: 'text', text: JSON.stringify(result.structuredContent) },
        ]);
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
      expect(structured).not.toHaveProperty('backlinkContext');
    } finally {
      await h.close();
    }
  });

  it('returns backlinks with line context (#408)', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'backlinks',
        includeContext: true,
      });
      expect(result.isError, textOf(result)).not.toBe(true);
      const structured = result.structuredContent as {
        backlinkContext: Array<{ path: string; matches: Array<{ line: number; text: string }> }>;
      };
      const byPath = Object.fromEntries(structured.backlinkContext.map((b) => [b.path, b.matches]));
      expect(byPath).toEqual({
        'README.md': [{ line: 3, text: 'See [[projects/alpha]].' }],
        'people/ada.md': [{ line: 3, text: 'Works on [[projects/alpha]].' }],
      });
    } finally {
      await h.close();
    }
  });
});

describe('vault_daily_note through a real SDK client (#408)', () => {
  it('create:false on a missing note returns exists:false and creates nothing', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_daily_note', { date: '2030-01-01', create: false });
      expect(result.isError, textOf(result)).not.toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(parseDocument(result).meta).toEqual({
        path: 'daily/2030-01-01.md',
        exists: 'false',
        created: 'false',
      });
      expect(await h.adapter.exists('daily/2030-01-01.md')).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('omitting create looks the note up without creating it (#432)', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_daily_note', { date: '2030-01-02' });
      expect(result.isError, textOf(result)).not.toBe(true);
      expect(parseDocument(result).meta).toEqual({
        path: 'daily/2030-01-02.md',
        exists: 'false',
        created: 'false',
      });
      expect(await h.adapter.exists('daily/2030-01-02.md')).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('create:true creates the missing note (#432)', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_daily_note', { date: '2030-01-03', create: true });
      expect(result.isError, textOf(result)).not.toBe(true);
      expect(parseDocument(result).meta).toMatchObject({
        path: 'daily/2030-01-03.md',
        created: 'true',
        exists: 'true',
      });
      expect(await h.adapter.exists('daily/2030-01-03.md')).toBe(true);
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

/** Every (path, value) pair of a JSON value, keys joined with dots. */
function entriesOf(value: unknown, path: string, out: Array<[string, unknown]>): void {
  out.push([path, value]);
  if (typeof value === 'object' && value !== null) {
    for (const [key, sub] of Object.entries(value)) entriesOf(sub, `${path}.${key}`, out);
  }
}

/** Whether `path` ends in schema keyword `key`, not in a property named `key`. */
function isKeyword(path: string, key: string): boolean {
  return path.endsWith(`.${key}`) && !path.endsWith(`.properties.${key}`);
}

describe('trimmed schemas in tools/list (#451)', () => {
  it('advertises no $schema, MAX_SAFE_INTEGER bound, string-only propertyNames or annotations.title', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      const found: string[] = [];
      for (const tool of tools) {
        const entries: Array<[string, unknown]> = [];
        entriesOf(tool, tool.name, entries);
        for (const [path, value] of entries) {
          if (isKeyword(path, '$schema')) found.push(path);
          if (isKeyword(path, 'maximum') && value === Number.MAX_SAFE_INTEGER) found.push(path);
          if (isKeyword(path, 'minimum') && value === Number.MIN_SAFE_INTEGER) found.push(path);
          if (isKeyword(path, 'propertyNames') && JSON.stringify(value) === '{"type":"string"}') {
            found.push(path);
          }
        }
        expect(tool.title, tool.name).toBeDefined();
        expect(tool.annotations, tool.name).not.toHaveProperty('title');
      }
      expect(found).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('advertises output schemas without descriptions or additionalProperties: false', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      const found: string[] = [];
      for (const tool of tools) {
        const entries: Array<[string, unknown]> = [];
        entriesOf(tool.outputSchema, `${tool.name}.output`, entries);
        for (const [path, value] of entries) {
          if (isKeyword(path, 'description')) found.push(path);
          if (isKeyword(path, 'additionalProperties') && value === false) found.push(path);
        }
      }
      expect(found).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('keeps input descriptions and required lists', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      const read = tools.find((t) => t.name === 'vault_read');
      expect(read?.inputSchema.required).toEqual(['path']);
      expect(read?.inputSchema.properties?.path).toHaveProperty('description');
      const withRequiredOutput = tools.filter((t) => {
        const required: unknown = t.outputSchema?.required;
        return Array.isArray(required) && required.length > 0;
      });
      expect(withRequiredOutput.length).toBeGreaterThan(0);
    } finally {
      await h.close();
    }
  });

  it('keeps the output schema root type: "object" for every tool', async () => {
    // The SDK reads the advertised output JSON when it builds a result; a
    // non-object root would wrap structuredContent as { result: … }.
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      const withOutput = tools.filter((t) => t.outputSchema !== undefined);
      expect(withOutput.length).toBeGreaterThan(0);
      for (const tool of withOutput) {
        expect(tool.outputSchema?.type, tool.name).toBe('object');
      }
      const result = await call(h, 'vault_get_metadata', SAMPLE_ARGS.vault_get_metadata);
      expect(result.structuredContent).not.toHaveProperty('result');
      expect(result.structuredContent).toHaveProperty('path', 'README.md');
    } finally {
      await h.close();
    }
  });

  it('still rejects unknown parameters', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_list', { path: '', bogus: true });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Unknown parameter: bogus');
    } finally {
      await h.close();
    }
  });

  it('lets the SDK client still reject structuredContent that does not match', async () => {
    const h = await connect();
    try {
      // Break structuredContent on its way to the client: the server's own
      // output check has already passed, so only the client can catch it.
      const transport = h.client.transport;
      const deliver = transport?.onmessage;
      expect(transport).toBeDefined();
      expect(deliver).toBeDefined();
      if (transport === undefined || deliver === undefined) return;
      transport.onmessage = (message, extra): void => {
        const result = (message as { result?: { structuredContent?: Record<string, unknown> } })
          .result;
        if (result?.structuredContent !== undefined) {
          result.structuredContent = { ...result.structuredContent, path: 42 };
        }
        deliver(message, extra);
      };
      await expect(call(h, 'vault_get_metadata', SAMPLE_ARGS.vault_get_metadata)).rejects.toThrow(
        /structured content/i,
      );
    } finally {
      await h.close();
    }
  });
});

describe('response_format is no longer accepted (#432)', () => {
  it('rejects response_format with the unknown-parameter error', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'headings',
        response_format: 'json',
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Unknown parameter: response_format');
    } finally {
      await h.close();
    }
  });

  it('rejects responseFormat, removed in 5.0.0 (#467)', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'vault_get_aspect', {
        path: 'projects/alpha.md',
        aspect: 'headings',
        responseFormat: 'json',
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Unknown parameter: responseFormat');
    } finally {
      await h.close();
    }
  });

  it('keeps response_format and responseFormat out of tools/list', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      for (const tool of tools) {
        const properties = tool.inputSchema.properties ?? {};
        expect(properties, tool.name).not.toHaveProperty('response_format');
        expect(properties, tool.name).not.toHaveProperty('responseFormat');
      }
    } finally {
      await h.close();
    }
  });
});

/**
 * Collect every property name declared anywhere in a JSON Schema: object
 * `properties`, plus nested schemas under `items`, `additionalProperties`,
 * compositions and `$defs`.
 */
function collectPropertyNames(schema: unknown, path: string, out: string[]): void {
  if (schema === null || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => {
      collectPropertyNames(s, `${path}[${String(i)}]`, out);
    });
    return;
  }
  const node = schema as Record<string, unknown>;
  const props = node.properties;
  if (props !== null && typeof props === 'object') {
    for (const [name, sub] of Object.entries(props as Record<string, unknown>)) {
      out.push(`${path}.${name}`);
      collectPropertyNames(sub, `${path}.${name}`, out);
    }
  }
  for (const key of [
    'items',
    'prefixItems',
    'additionalProperties',
    'anyOf',
    'oneOf',
    'allOf',
    'not',
  ]) {
    if (key in node) collectPropertyNames(node[key], `${path}.${key}`, out);
  }
  for (const key of ['$defs', 'definitions']) {
    const defs = node[key];
    if (defs !== null && typeof defs === 'object') {
      for (const [name, sub] of Object.entries(defs as Record<string, unknown>)) {
        collectPropertyNames(sub, `${path}.${key}[${name}]`, out);
      }
    }
  }
}

describe('server_info (#402)', () => {
  it('returns name, version, enabledModules and changes', async () => {
    const h = await connect({ version: '1.2.3' });
    try {
      const { tools } = await h.client.listTools();
      const listed = tools.find((t) => t.name === 'server_info');
      expect(listed?.description).toContain('v1.2.3');
      expect(h.client.getInstructions()?.split('\n')[0]).toBe('vault-mcp-server v1.2.3');
      // #431: the handshake name matches the instructions and server_info.
      expect(h.client.getServerVersion()?.name).toBe('vault-mcp-server');

      const result = await call(h, 'server_info', {});
      expect(result.isError).not.toBe(true);
      const sc = result.structuredContent as {
        name: string;
        version: string;
        enabledModules: string[];
        changes: Array<{ version: string; notes: string[] }>;
      };
      expect(sc.name).toBe('vault-mcp-server');
      expect(sc.version).toBe('1.2.3');
      expect(sc.enabledModules).toEqual([
        'vault',
        'editor',
        'search',
        'workspace',
        'ui',
        'templates',
        'plugin-interop',
        'extras',
      ]);
      expect(sc.changes.length).toBeGreaterThan(0);
      for (const entry of sc.changes) {
        expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(entry.notes.length).toBeGreaterThan(0);
      }
      // #431: a version without an entry is explained, not a gap.
      expect(listed?.description).toContain(
        'Versions without an entry had no agent-relevant changes.',
      );
      expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
    } finally {
      await h.close();
    }
  });

  it('enabledModules follows module toggles and server_info stays available', async () => {
    const h = await connect({
      moduleStates: {
        vault: { enabled: false },
        editor: { enabled: false },
        search: { enabled: false },
        workspace: { enabled: false },
        ui: { enabled: false },
        templates: { enabled: false },
        'plugin-interop': { enabled: false },
        extras: { enabled: true, toolStates: {} },
      },
    });
    try {
      const { tools } = await h.client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['server_info']);
      const result = await call(h, 'server_info', {});
      expect((result.structuredContent as { enabledModules: string[] }).enabledModules).toEqual(
        [],
      );
    } finally {
      await h.close();
    }
  });

  it('rejects arguments', async () => {
    const h = await connect();
    try {
      const result = await call(h, 'server_info', { verbose: true });
      expect(result.isError).toBe(true);
    } finally {
      await h.close();
    }
  });
});

describe('naming convention guard (#392)', () => {
  const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;

  it('uses camelCase for every input and output property name in tools/list', async () => {
    const h = await connect();
    try {
      const { tools } = await h.client.listTools();
      expect(tools.length).toBe(Object.keys(SAMPLE_ARGS).length);
      const offenders: string[] = [];
      for (const tool of tools) {
        const names: string[] = [];
        collectPropertyNames(tool.inputSchema, `${tool.name}.input`, names);
        collectPropertyNames(tool.outputSchema, `${tool.name}.output`, names);
        for (const full of names) {
          const leaf = full.slice(full.lastIndexOf('.') + 1);
          if (!CAMEL_CASE.test(leaf)) offenders.push(full);
        }
      }
      expect(offenders).toEqual([]);
    } finally {
      await h.close();
    }
  });
});
