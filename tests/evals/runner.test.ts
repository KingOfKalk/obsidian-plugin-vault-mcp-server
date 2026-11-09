/**
 * Plumbing of the LLM eval (#393), checked without a model or API key:
 * the harness serves every tool, the runner converts them for Claude, the
 * tool-use loop runs tool calls through MCP and grades the final answer,
 * and a missing key fails with a clear message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { connectClient, startHarness } from '../../evals/harness';
import {
  DEFAULT_MODEL,
  MISSING_KEY_MESSAGE,
  main,
  parseArgs,
  readConfig,
  runQuestion,
  toClaudeTool,
  type CreateMessage,
} from '../../evals/run';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { discoverModules } from '../../src/tools';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('eval harness', () => {
  it('serves every registered tool over authenticated Streamable HTTP', async () => {
    const expected = discoverModules(new MockObsidianAdapter())
      .flatMap((m) => m.tools())
      .map((t) => t.name)
      .concat('server_info') // always on, outside the registry (#402)
      .sort();
    const harness = await startHarness();
    const client = await connectClient(harness);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(expected);
      for (const t of tools) {
        const converted = toClaudeTool(t);
        expect(converted.name).toBe(t.name);
        expect(converted.input_schema.type).toBe('object');
        expect(converted.description?.length ?? 0).toBeGreaterThan(0);
      }
      expect(client.getInstructions()?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await client.close();
      await harness.close();
    }
  });

  it('rejects requests without the bearer token', async () => {
    const harness = await startHarness();
    try {
      const res = await fetch(harness.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(401);
    } finally {
      await harness.close();
    }
  });

  it('loads the fixture with Obsidian-style link resolution', async () => {
    const harness = await startHarness();
    try {
      const a = harness.adapter;
      expect(a.resolveLink('Atlas#^budget-cap', 'x.md')).toBe('projects/Atlas.md');
      expect(a.resolveLink('#Goals', 'projects/Atlas.md')).toBe('projects/Atlas.md');
      expect(a.resolveLink('Quarterly Review', 'projects/Beacon.md')).toBeNull();
      expect(a.getBacklinks('projects/Atlas.md')).toContain('meetings/2026-03-04 Atlas kickoff.md');
      expect(a.getUnresolvedLinks()['projects/Beacon.md']).toEqual({ 'Quarterly Review': 1 });
      expect((await a.readFile('reference/Station Log.md')).length).toBeGreaterThan(25_000);
      expect((await a.stat('Home.md'))?.mtime).toBe(Date.UTC(2026, 0, 1));
    } finally {
      await harness.close();
    }
  });
});

function message(content: unknown[], stop_reason: string): Anthropic.Beta.BetaMessage {
  return { content, stop_reason } as unknown as Anthropic.Beta.BetaMessage;
}

describe('runQuestion', () => {
  const config = { apiKey: 'test', model: DEFAULT_MODEL, effort: 'high' as const, maxTurns: 5 };
  const qa = { question: 'Which team?', answer: 'Hydrology' };

  it('runs tool calls through MCP, returns all results, and grades the answer', async () => {
    const requests: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
    const replies = [
      message(
        [
          { type: 'tool_use', id: 'a', name: 'vault_get_aspect', input: { path: 'people/Mira Chen.md', aspect: 'frontmatter' } },
          { type: 'tool_use', id: 'b', name: 'no_such_tool', input: {} },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: '<summary>s</summary><feedback>f</feedback><response>hydrology</response>' }], 'end_turn'),
    ];
    const create: CreateMessage = (params) => {
      requests.push(structuredClone(params));
      const next = replies.shift();
      if (!next) throw new Error('unexpected extra turn');
      return Promise.resolve(next);
    };

    const result = await runQuestion(create, config, qa, 1);

    expect(result.passed).toBe(true);
    expect(result.actual).toBe('hydrology');
    expect(result.toolCalls).toEqual({ vault_get_aspect: 1, no_such_tool: 1 });
    expect(result.totalToolCalls).toBe(2);
    expect(result.feedback).toBe('f');
    expect(requests[0].model).toBe(DEFAULT_MODEL);
    expect(requests[0].thinking).toEqual({ type: 'adaptive' });
    expect(requests[0].tools?.length).toBeGreaterThan(40);
    expect(requests[0].system).toEqual(expect.stringContaining('Instructions from the MCP server'));

    const toolTurn = requests[1].messages[2];
    expect(toolTurn.role).toBe('user');
    const blocks = toolTurn.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['a', 'b']);
    expect(blocks[0].content).toEqual(expect.stringContaining('Hydrology'));
    expect(blocks[0].is_error).toBeUndefined();
    expect(blocks[1].is_error).toBe(true);
  });

  it('fails when the model runs out of turns', async () => {
    const create: CreateMessage = () =>
      Promise.resolve(message([{ type: 'tool_use', id: 'x', name: 'search_tags', input: {} }], 'tool_use'));
    const result = await runQuestion(create, { ...config, maxTurns: 2 }, qa, 1);
    expect(result.passed).toBe(false);
    expect(result.stopReason).toBe('max_turns');
    expect(result.totalToolCalls).toBe(2);
  });
});

describe('runner configuration', () => {
  it('defaults to the current Opus model and reads overrides', () => {
    expect(readConfig({})).toEqual({ apiKey: null, model: 'claude-opus-5-5', effort: 'high', maxTurns: 30 });
    expect(
      readConfig({ ANTHROPIC_API_KEY: ' k ', EVAL_MODEL: 'claude-sonnet-5-5', EVAL_EFFORT: 'low', EVAL_MAX_TURNS: '7' }),
    ).toEqual({ apiKey: 'k', model: 'claude-sonnet-5-5', effort: 'low', maxTurns: 7 });
    expect(() => readConfig({ EVAL_EFFORT: 'extreme' })).toThrow(/EVAL_EFFORT/);
    expect(() => readConfig({ EVAL_MAX_TURNS: '0' })).toThrow(/EVAL_MAX_TURNS/);
  });

  it('parses CLI flags', () => {
    const args = parseArgs(['--only', '2,5', '--dry-run']);
    expect(args.only).toEqual([2, 5]);
    expect(args.dryRun).toBe(true);
    expect(args.file).toMatch(/evals[/\\]vault\.xml$/);
    expect(() => parseArgs(['--only', 'x'])).toThrow(/--only/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
  });

  it('exits with a clear message when ANTHROPIC_API_KEY is missing', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(main([], {})).resolves.toBe(2);
    expect(stderr).toHaveBeenCalledWith(`${MISSING_KEY_MESSAGE}\n`);
  });

  it('dry run needs no key and makes no model calls', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(main(['--dry-run', '--only', '1'], {})).resolves.toBe(0);
    const out = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toMatch(/\d+ tools converted for Claude/);
    expect(out).toContain('No model calls were made.');
  });
});
