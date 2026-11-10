/**
 * Plumbing of the LLM eval (#393), checked without a model or API key:
 * the harness serves every tool, the runner converts them for Claude, the
 * tool-use loop runs tool calls through MCP and grades the final answer,
 * and a missing key fails with a clear message. Provider selection and
 * configuration for Anthropic and OpenAI-compatible APIs (#483).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { BULK_SEED } from '../../evals/fixture-generator';
import { connectClient, startHarness } from '../../evals/harness';
import {
  DEFAULT_MODEL,
  MISSING_BASE_URL_MESSAGE,
  MISSING_KEY_MESSAGE,
  MISSING_MODEL_MESSAGE,
  baseUrlHost,
  baselineRow,
  main,
  pluginVersion,
  parseArgs,
  readConfig,
  runQuestion,
  selectProvider,
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
      // No Dataview and an empty allowlist in the fixture (#469).
      .filter((t) => t.name !== 'plugin_dataview_query' && t.name !== 'plugin_execute_command')
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
      expect(harness.fixture.seed).toBe(BULK_SEED);
      expect(harness.fixture.generated).toBeGreaterThan(400);
      expect(harness.fixture.files).toBeGreaterThan(harness.fixture.generated);
    } finally {
      await harness.close();
    }
  });

  it('can load only the hand-written notes', async () => {
    const harness = await startHarness({ bulkSeed: null });
    try {
      expect(harness.fixture.generated).toBe(0);
      expect(harness.fixture.seed).toBeNull();
      expect(harness.adapter.getAllFiles()).not.toContain('reference/Calibration Ledger.md');
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
    expect(result.toolCalls).toEqual({ vault_get_aspect: 1, '(unknown tool)': 1 });
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
  it('defaults to Anthropic with the current Opus model and reads overrides', () => {
    expect(readConfig({})).toEqual({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      apiKey: null,
      model: 'claude-opus-5-5',
      effort: 'high',
      maxTurns: 30,
      schemaDrop: [],
      minIntervalMs: 0,
    });
    expect(
      readConfig({ ANTHROPIC_API_KEY: ' k ', EVAL_MODEL: 'claude-sonnet-5-5', EVAL_EFFORT: 'low', EVAL_MAX_TURNS: '7' }),
    ).toMatchObject({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5', effort: 'low', maxTurns: 7 });
    expect(readConfig({ ANTHROPIC_BASE_URL: 'https://proxy.example/' }).baseUrl).toBe('https://proxy.example/');
    expect(() => readConfig({ EVAL_EFFORT: 'extreme' })).toThrow(/EVAL_EFFORT/);
    expect(() => readConfig({ EVAL_MAX_TURNS: '0' })).toThrow(/EVAL_MAX_TURNS/);
  });

  it('reads the openai provider settings from the environment and flags', () => {
    const env = {
      EVAL_BASE_URL: 'https://api.mistral.ai/v1/',
      EVAL_MODEL: 'mistral-large-latest',
      EVAL_API_KEY: ' sk ',
      MISTRAL_API_KEY: 'other',
      EVAL_SCHEMA_DROP: 'additionalProperties, minLength,',
    };
    expect(readConfig(env)).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.mistral.ai/v1',
      apiKeyEnv: 'EVAL_API_KEY',
      apiKey: 'sk',
      model: 'mistral-large-latest',
      effort: 'high',
      maxTurns: 30,
      schemaDrop: ['additionalProperties', 'minLength'],
      minIntervalMs: 0,
    });
    expect(
      readConfig(env, { baseUrl: 'http://localhost:11434/v1', model: 'qwen3', apiKeyEnv: 'MISTRAL_API_KEY' }),
    ).toMatchObject({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3', apiKeyEnv: 'MISTRAL_API_KEY', apiKey: 'other' });
    expect(readConfig({ EVAL_BASE_URL: 'http://localhost:11434/v1', EVAL_MODEL: 'm' }).apiKey).toBeNull();
  });

  it('reads the minimum request interval from the flag or EVAL_MIN_INTERVAL_MS', () => {
    expect(readConfig({ EVAL_MIN_INTERVAL_MS: '1100' }).minIntervalMs).toBe(1100);
    expect(readConfig({ EVAL_MIN_INTERVAL_MS: '1100' }, { minIntervalMs: '250' }).minIntervalMs).toBe(250);
    expect(() => readConfig({ EVAL_MIN_INTERVAL_MS: '-1' })).toThrow(/EVAL_MIN_INTERVAL_MS/);
    expect(() => readConfig({}, { minIntervalMs: '1.5s' })).toThrow(/--min-interval-ms/);
    expect(parseArgs(['--min-interval-ms', '1100']).minIntervalMs).toBe('1100');
  });

  it('fails clearly when the openai provider lacks a base URL or model', () => {
    expect(() => readConfig({ EVAL_PROVIDER: 'openai', EVAL_MODEL: 'm' })).toThrow(MISSING_BASE_URL_MESSAGE);
    expect(() => readConfig({ EVAL_BASE_URL: 'https://api.mistral.ai/v1' })).toThrow(MISSING_MODEL_MESSAGE);
    expect(() => readConfig({ EVAL_BASE_URL: 'api.mistral.ai', EVAL_MODEL: 'm' })).toThrow(/EVAL_BASE_URL is not a valid URL/);
    expect(() => readConfig({}, { provider: 'openai', baseUrl: 'ftp://x', model: 'm' })).toThrow(/--base-url must be an http/);
  });

  it('selects the provider from the flag, EVAL_PROVIDER or the base URL', () => {
    expect(selectProvider({})).toBe('anthropic');
    expect(selectProvider({ EVAL_BASE_URL: 'https://api.mistral.ai/v1' })).toBe('openai');
    expect(selectProvider({}, { baseUrl: 'http://localhost:11434/v1' })).toBe('openai');
    expect(selectProvider({ EVAL_PROVIDER: 'openai' })).toBe('openai');
    expect(selectProvider({ EVAL_BASE_URL: 'https://x/v1', EVAL_PROVIDER: 'anthropic' })).toBe('anthropic');
    expect(selectProvider({ EVAL_PROVIDER: 'openai' }, { provider: 'anthropic' })).toBe('anthropic');
    expect(selectProvider({ EVAL_PROVIDER: ' ' })).toBe('anthropic');
    expect(() => selectProvider({ EVAL_PROVIDER: 'gemini' })).toThrow(/anthropic, openai/);
    expect(baseUrlHost('http://localhost:11434/v1')).toBe('localhost:11434');
    expect(baseUrlHost('not a url')).toBe('not a url');
  });

  it('parses CLI flags', () => {
    const args = parseArgs(['--only', '2,5', '--dry-run']);
    expect(args.only).toEqual([2, 5]);
    expect(args.dryRun).toBe(true);
    expect(args.file).toMatch(/evals[/\\]vault\.xml$/);
    expect(
      parseArgs(['--provider', 'openai', '--base-url', 'https://api.mistral.ai/v1', '--model', 'm', '--api-key-env', 'K']),
    ).toMatchObject({ provider: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'm', apiKeyEnv: 'K' });
    expect(() => parseArgs(['--model'])).toThrow(/--model needs a value/);
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
    expect(out).toContain('Provider: anthropic (Claude Messages API)');
    expect(out).toContain('Base URL: https://api.anthropic.com');
    expect(out).toContain('Model:    claude-opus-5-5, effort high');
    expect(out).toContain('API key:  from ANTHROPIC_API_KEY (not set)');
    expect(out).toContain('No model calls were made.');
    expect(out).toMatch(/Fixture: \d+ files \(\d+ from evals\/fixture-vault\/, \d+ generated with seed \d+\)/);
  });

  it('dry run shows the openai provider, base URL and model without a key', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const env = {
      EVAL_BASE_URL: 'https://api.mistral.ai/v1',
      EVAL_MODEL: 'mistral-large-latest',
      EVAL_SCHEMA_DROP: 'additionalProperties',
    };
    await expect(main(['--dry-run', '--only', '1'], env)).resolves.toBe(0);
    const out = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('Provider: openai (OpenAI-compatible Chat Completions)');
    expect(out).toContain('Base URL: https://api.mistral.ai/v1');
    expect(out).toContain('Model:    mistral-large-latest\n');
    expect(out).toContain('API key:  from EVAL_API_KEY (not set)');
    expect(out).toContain('Dropped schema keywords: $schema, additionalProperties');
    expect(out).toMatch(/\d+ tools converted for the OpenAI-compatible API/);
    expect(out).toContain('No model calls were made.');
  });

  it('formats a baseline row for the README table', () => {
    expect(
      baselineRow({
        date: '2026-11-09',
        version: '4.0.1',
        provider: 'anthropic',
        host: 'api.anthropic.com',
        model: 'claude-opus-5-5',
        effort: 'high',
        passed: 9,
        total: 10,
        toolCalls: 123,
      }),
    ).toBe(
      `| 2026-11-09 | 4.0.1 | anthropic | api.anthropic.com | claude-opus-5-5 | high | ${String(BULK_SEED)} | 9/10 (90%) | 12.3 |`,
    );
    expect(
      baselineRow({
        date: '2026-11-10',
        version: '5.0.0',
        provider: 'openai',
        host: 'api.mistral.ai',
        model: 'mistral-large-latest',
        effort: '-',
        passed: 0,
        total: 0,
        toolCalls: 0,
      }),
    ).toBe(`| 2026-11-10 | 5.0.0 | openai | api.mistral.ai | mistral-large-latest | - | ${String(BULK_SEED)} | 0/0 (0%) | 0.0 |`);
    expect(pluginVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
