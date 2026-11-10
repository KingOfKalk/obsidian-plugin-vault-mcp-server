/**
 * OpenAI-compatible provider of the eval runner (#483), checked against a
 * mocked fetch and a local mock HTTP server: no network, no key. The agent
 * loop runs against the real eval harness, so tool calls go through MCP.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/client';
import { connectClient, startHarness } from '../../evals/harness';
import {
  ProviderAuthError,
  chatCompletionsUrl,
  openAIProvider,
  parseToolArguments,
  postChatCompletion,
  retryWaitMs,
  sanitizeSchema,
  toOpenAITool,
  type OpenAIOptions,
  type OpenAIRequest,
} from '../../evals/openai';
import { main, runAgent } from '../../evals/run';

afterEach(() => {
  vi.restoreAllMocks();
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: OpenAIRequest;
}

/** A fetch that answers with the scripted responses in order and records every request. */
function mockFetch(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fn: typeof fetch = (input, init) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as OpenAIRequest,
    });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('unexpected extra request'));
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return Promise.resolve(new Response(text, { status: next.status ?? 200, headers: next.headers }));
  };
  return { fetch: fn, calls };
}

function toolCallReply(
  calls: Array<{ id?: string; name: string; arguments: unknown }>,
  content: string | null = null,
): unknown {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content,
          tool_calls: calls.map((c, i) => ({
            ...(c.id === undefined ? {} : { id: c.id }),
            index: i,
            type: 'function',
            function: { name: c.name, arguments: c.arguments },
          })),
        },
      },
    ],
  };
}

function finalReply(content: unknown, finish = 'stop'): unknown {
  return { choices: [{ finish_reason: finish, message: { role: 'assistant', content } }] };
}

const ANSWER = '<summary>s</summary><feedback>f</feedback><response>Hydrology</response>';
const qa = { question: 'Which team?', answer: 'Hydrology' };

function options(fetchFn: typeof fetch, extra: Partial<OpenAIOptions> = {}): OpenAIOptions {
  return {
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey: 'test-key',
    apiKeyEnv: 'EVAL_API_KEY',
    model: 'mistral-large-latest',
    fetch: fetchFn,
    sleep: () => Promise.resolve(),
    log: () => undefined,
    ...extra,
  };
}

describe('MCP tools in the OpenAI format', () => {
  const tool: Tool = {
    name: 'vault_read',
    description: 'Read a note.',
    inputSchema: {
      type: 'object',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: {
        path: { type: 'string', minLength: 1 },
        // A property named like a keyword is not a keyword.
        additionalProperties: { type: 'boolean' },
        opts: { type: 'object', properties: { x: { type: 'integer' } }, additionalProperties: false },
        list: { type: 'array', items: { anyOf: [{ type: 'string', additionalProperties: false }] } },
      },
      required: ['path'],
      additionalProperties: false,
    },
  };

  it('wraps name, description and parameters and drops $schema', () => {
    const converted = toOpenAITool(tool);
    expect(converted.type).toBe('function');
    expect(converted.function.name).toBe('vault_read');
    expect(converted.function.description).toBe('Read a note.');
    expect(converted.function.parameters.$schema).toBeUndefined();
    expect(converted.function.parameters.additionalProperties).toBe(false);
    expect(converted.function.parameters.required).toEqual(['path']);
    expect(tool.inputSchema.$schema).toBeDefined(); // the input is not mutated
  });

  it('drops extra keywords in every schema position but keeps property names', () => {
    const params = toOpenAITool(tool, ['additionalProperties', 'minLength']).function.parameters;
    expect(params).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string' },
        additionalProperties: { type: 'boolean' },
        opts: { type: 'object', properties: { x: { type: 'integer' } } },
        list: { type: 'array', items: { anyOf: [{ type: 'string' }] } },
      },
      required: ['path'],
    });
    expect(sanitizeSchema([{ $schema: 'x', type: 'string' }], new Set(['$schema']))).toEqual([{ type: 'string' }]);
  });

  it('falls back to the title or name when there is no description', () => {
    const bare = { name: 't', inputSchema: { type: 'object' } } as Tool;
    expect(toOpenAITool(bare).function.description).toBe('t');
    expect(toOpenAITool({ ...bare, title: 'T' }).function.description).toBe('T');
  });

  it('converts every tool the harness serves', async () => {
    const harness = await startHarness();
    const client = await connectClient(harness);
    try {
      const { tools } = await client.listTools();
      for (const t of tools) {
        const converted = toOpenAITool(t);
        expect(converted.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
        expect(converted.function.parameters.type).toBe('object');
        expect(JSON.stringify(converted.function.parameters)).not.toContain('$schema');
      }
    } finally {
      await client.close();
      await harness.close();
    }
  });
});

describe('tool arguments', () => {
  it('accepts a JSON string, an object, or nothing', () => {
    expect(parseToolArguments('{"path":"a.md"}')).toEqual({ input: { path: 'a.md' } });
    expect(parseToolArguments({ path: 'a.md' })).toEqual({ input: { path: 'a.md' } });
    expect(parseToolArguments('')).toEqual({ input: {} });
    expect(parseToolArguments(undefined)).toEqual({ input: {} });
  });

  it('reports arguments that are not a JSON object', () => {
    expect(parseToolArguments('{oops').error).toMatch(/not valid JSON/);
    expect(parseToolArguments('[1]').error).toMatch(/JSON object/);
    expect(parseToolArguments(42).error).toMatch(/JSON object/);
  });
});

describe('the agent loop against a mocked OpenAI-compatible server', () => {
  it('runs a tool call, sends the result back and grades the final answer', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: toolCallReply([
          { id: 'abc123XYZ', name: 'vault_get_aspect', arguments: '{"path":"people/Mira Chen.md","aspect":"frontmatter"}' },
        ]),
      },
      { body: finalReply(ANSWER) },
    ]);
    const result = await runAgent(openAIProvider(options(fetch)), { maxTurns: 5 }, qa, 1);

    expect(result.passed).toBe(true);
    expect(result.toolCalls).toEqual({ vault_get_aspect: 1 });
    expect(result.turns).toBe(2);
    expect(result.stopReason).toBe('stop');
    expect(result.summary).toBe('s');

    expect(calls[0].url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(calls[0].headers.authorization).toBe('Bearer test-key');
    const first = calls[0].body;
    expect(first.model).toBe('mistral-large-latest');
    expect(first.tool_choice).toBe('auto');
    expect(first.tools.length).toBeGreaterThan(40);
    expect(first.messages[0].role).toBe('system');
    expect(first.messages[0].content).toContain('Instructions from the MCP server');
    expect(first.messages[1]).toEqual({ role: 'user', content: 'Which team?' });

    const second = calls[1].body.messages;
    expect(second[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'abc123XYZ',
          type: 'function',
          function: { name: 'vault_get_aspect', arguments: '{"path":"people/Mira Chen.md","aspect":"frontmatter"}' },
        },
      ],
    });
    expect(second[3]).toMatchObject({ role: 'tool', tool_call_id: 'abc123XYZ', name: 'vault_get_aspect' });
    expect(second[3].content).toContain('Hydrology');
  });

  it('runs parallel tool calls and answers each with its own tool message', async () => {
    const { fetch, calls } = mockFetch([
      {
        body: toolCallReply(
          [
            { id: 'call00001', name: 'vault_get_aspect', arguments: { path: 'people/Mira Chen.md', aspect: 'frontmatter' } },
            { id: 'call00002', name: 'no_such_tool', arguments: '{}' },
            { id: 'call00003', name: 'search_tags', arguments: '{not json' },
            { name: 'search_tags', arguments: '' },
          ],
          'Let me look.',
        ),
      },
      { body: finalReply([{ type: 'text', text: ANSWER }]) },
    ]);
    const result = await runAgent(openAIProvider(options(fetch)), { maxTurns: 5 }, qa, 1);

    expect(result.passed).toBe(true);
    expect(result.toolCalls).toEqual({ vault_get_aspect: 1, '(unknown tool)': 1, search_tags: 2 });
    const messages = calls[1].body.messages;
    const assistant = messages[2] as { content: string; tool_calls: Array<{ id: string; function: { arguments: string } }> };
    expect(assistant.content).toBe('Let me look.');
    // Object arguments are echoed as a JSON string; a missing id is generated (9 alphanumerics).
    expect(assistant.tool_calls[0].function.arguments).toBe('{"path":"people/Mira Chen.md","aspect":"frontmatter"}');
    expect(assistant.tool_calls[3].id).toMatch(/^[a-zA-Z0-9]{9}$/);
    const tools = messages.slice(3) as Array<{ role: string; tool_call_id: string; content: string }>;
    expect(tools.map((m) => m.role)).toEqual(['tool', 'tool', 'tool', 'tool']);
    expect(tools.map((m) => m.tool_call_id)).toEqual(['call00001', 'call00002', 'call00003', assistant.tool_calls[3].id]);
    expect(tools[0].content).toContain('Hydrology');
    expect(tools[1].content).toMatch(/^Error: Tool call failed: Unknown tool "no_such_tool"/);
    expect(tools[2].content).toMatch(/^Error: Tool call failed: Tool arguments are not valid JSON/);
    expect(tools[3].content).not.toMatch(/^Error/);
  });

  it('fails the question when the model runs out of turns', async () => {
    const reply = toolCallReply([{ id: 'x', name: 'search_tags', arguments: '{}' }]);
    const { fetch, calls } = mockFetch([{ body: reply }, { body: reply }]);
    const result = await runAgent(openAIProvider(options(fetch)), { maxTurns: 2 }, qa, 1);
    expect(result.passed).toBe(false);
    expect(result.stopReason).toBe('max_turns');
    expect(result.totalToolCalls).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('stops the run on 401 with the provider, base URL and key variable', async () => {
    const { fetch } = mockFetch([{ status: 401, body: { message: 'Unauthorized' } }]);
    const run = runAgent(openAIProvider(options(fetch, { apiKeyEnv: 'MISTRAL_API_KEY' })), { maxTurns: 5 }, qa, 1);
    await expect(run).rejects.toBeInstanceOf(ProviderAuthError);
    await expect(
      runAgent(
        openAIProvider(options(mockFetch([{ status: 403, body: 'nope' }]).fetch, { apiKeyEnv: 'MISTRAL_API_KEY' })),
        { maxTurns: 5 },
        qa,
        1,
      ),
    ).rejects.toThrow(/openai provider: HTTP 403 from https:\/\/api\.mistral\.ai\/v1 .*MISTRAL_API_KEY/);
  });

  it('counts invented tool names under one key and never calls MCP with them', async () => {
    // Seen with Mistral: the "name" of a tool call is a made-up JSON tool result.
    const invented = '{"total": 3, "items": [{"path": "Field_Visits/2023-07-15_Birke_Station_3.md"}]}';
    const { fetch, calls } = mockFetch([
      { body: toolCallReply([{ id: 'call00001', name: invented, arguments: '{}' }]) },
      { body: finalReply(ANSWER) },
    ]);
    const result = await runAgent(openAIProvider(options(fetch)), { maxTurns: 5 }, qa, 1);
    expect(result.toolCalls).toEqual({ '(unknown tool)': 1 });
    expect(result.totalToolCalls).toBe(1);
    const reply = calls[1].body.messages[3] as { content: string };
    expect(reply.content).toMatch(/^Error: Tool call failed: Unknown tool "\{"total": 3/);
    expect(reply.content).toContain('Call one of the listed tools');
  });

  it('scores finish_reason "error" as ERROR, not as a wrong answer', async () => {
    const { fetch } = mockFetch([{ body: finalReply('', 'error') }]);
    const result = await runAgent(openAIProvider(options(fetch)), { maxTurns: 5 }, qa, 1);
    expect(result.outcome).toBe('error');
    expect(result.stopReason).toBe('error');
    expect(result.turns).toBe(1);
    expect(result.error).toMatch(/finish_reason "error"/);
  });

  it('keeps the turn count when a later request fails', async () => {
    const { fetch } = mockFetch([
      { body: toolCallReply([{ id: 'x', name: 'search_tags', arguments: '{}' }]) },
      { status: 400, body: { message: 'Invalid schema' } },
    ]);
    const result = await runAgent(openAIProvider(options(fetch)), { maxTurns: 5 }, qa, 1);
    expect(result.outcome).toBe('error');
    expect(result.turns).toBe(2);
    expect(result.totalToolCalls).toBe(1);
  });

  it('records other HTTP errors on the question and carries on', async () => {
    const { fetch } = mockFetch([{ status: 400, body: { message: 'Invalid schema' } }]);
    const result = await runAgent(openAIProvider(options(fetch)), { maxTurns: 5 }, qa, 1);
    expect(result.passed).toBe(false);
    expect(result.stopReason).toBe('error');
    expect(result.error).toMatch(/HTTP 400 .*Invalid schema/);
  });
});

describe('postChatCompletion', () => {
  const body: OpenAIRequest = { model: 'm', messages: [], tools: [], tool_choice: 'auto' };

  it('retries after 429, waiting for Retry-After, and logs the wait', async () => {
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const log = vi.fn();
    const { fetch, calls } = mockFetch([
      { status: 429, body: 'slow down', headers: { 'retry-after': '3' } },
      { status: 429, body: '{"message":"Rate limit exceeded","code":"1300"}' },
      { body: finalReply('ok') },
    ]);
    await expect(postChatCompletion(options(fetch, { sleep, log }), body)).resolves.toEqual(finalReply('ok'));
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[3000], [4000]]);
    expect(log.mock.calls).toEqual([
      ['  rate limited, waiting 3s (attempt 1/6)'],
      ['  rate limited, waiting 4s (attempt 2/6)'],
    ]);
  });

  it('retries 503 too', async () => {
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const log = vi.fn();
    const { fetch } = mockFetch([{ status: 503, body: 'busy' }, { body: finalReply('ok') }]);
    await expect(postChatCompletion(options(fetch, { sleep, log }), body)).resolves.toEqual(finalReply('ok'));
    expect(sleep.mock.calls).toEqual([[2000]]);
    expect(log).toHaveBeenCalledWith('  service unavailable (HTTP 503), waiting 2s (attempt 1/6)');
  });

  it.each([502, 504])('retries HTTP %i (gateway errors) too', async (status) => {
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const log = vi.fn();
    const { fetch } = mockFetch([{ status, body: 'upstream request failed' }, { body: finalReply('ok') }]);
    await expect(postChatCompletion(options(fetch, { sleep, log }), body)).resolves.toEqual(finalReply('ok'));
    expect(sleep.mock.calls).toEqual([[2000]]);
    expect(log).toHaveBeenCalledWith(`  server error (HTTP ${String(status)}), waiting 2s (attempt 1/6)`);
  });

  it('backs off exponentially up to 60 s and gives up after 6 retries', async () => {
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const log = vi.fn();
    const { fetch, calls } = mockFetch(
      Array.from({ length: 7 }, () => ({ status: 429, body: '{"message":"Rate limit exceeded"}' })),
    );
    await expect(postChatCompletion(options(fetch, { sleep, log }), body)).rejects.toThrow(
      /HTTP 429 from https:\/\/api\.mistral\.ai\/v1\/chat\/completions after 6 retries: .*Rate limit exceeded/,
    );
    expect(calls).toHaveLength(7);
    expect(sleep.mock.calls).toEqual([[2000], [4000], [8000], [16000], [32000], [60000]]);
    expect(log).toHaveBeenLastCalledWith('  rate limited, waiting 60s (attempt 6/6)');
  });

  it('computes the retry wait from Retry-After or the attempt', () => {
    expect(retryWaitMs(1, null)).toBe(2000);
    expect(retryWaitMs(5, null)).toBe(32000);
    expect(retryWaitMs(6, null)).toBe(60000);
    expect(retryWaitMs(1, '0.5')).toBe(500);
    expect(retryWaitMs(1, '600')).toBe(60000);
    expect(retryWaitMs(3, 'Wed, 21 Oct 2026 07:28:00 GMT')).toBe(8000);
    expect(retryWaitMs(2, '')).toBe(4000);
  });

  it('keeps the minimum interval between requests across questions', async () => {
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const { fetch } = mockFetch([{ body: finalReply('a') }, { body: finalReply('b') }]);
    const provider = openAIProvider(options(fetch, { sleep, minIntervalMs: 1100 }));
    await provider.start({ tools: [], system: 's', question: 'q1' }).send([]);
    expect(sleep).not.toHaveBeenCalled();
    await provider.start({ tools: [], system: 's', question: 'q2' }).send([]);
    expect(sleep).toHaveBeenCalledTimes(1);
    const waited = (sleep.mock.calls as unknown as number[][])[0][0];
    expect(waited).toBeGreaterThan(1000);
    expect(waited).toBeLessThanOrEqual(1100);
  });

  it('sends no Authorization header without a key and names an unset key on 401', async () => {
    const { fetch, calls } = mockFetch([{ status: 401, body: '' }]);
    await expect(postChatCompletion(options(fetch, { apiKey: null }), body)).rejects.toThrow(
      /EVAL_API_KEY, which is not set/,
    );
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('reports network failures and malformed responses with the URL', async () => {
    const failing = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    await expect(postChatCompletion(options(failing, { baseUrl: 'http://localhost:11434/v1/' }), body)).rejects.toThrow(
      'request to http://localhost:11434/v1/chat/completions failed: ECONNREFUSED',
    );
    await expect(postChatCompletion(options(mockFetch([{ body: 'not json' }]).fetch), body)).rejects.toThrow(
      /is not JSON/,
    );
    const provider = openAIProvider(options(mockFetch([{ body: { choices: [] } }]).fetch));
    const session = provider.start({ tools: [], system: 's', question: 'q' });
    await expect(session.send([])).rejects.toThrow(/no choices\[0\]\.message/);
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1//')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

describe('main with the openai provider', () => {
  const env = {
    EVAL_BASE_URL: 'https://api.mistral.ai/v1',
    EVAL_MODEL: 'mistral-large-latest',
    EVAL_API_KEY: 'test-key',
  };

  it('runs a question through the mocked server', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { fetch, calls } = mockFetch([{ body: finalReply('<response>NOT_FOUND</response>') }]);
    await expect(main(['--only', '1'], env, { fetch })).resolves.toBe(0);
    const out = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('with openai mistral-large-latest at api.mistral.ai (max 30 turns)');
    expect(out).toMatch(/FAIL {2}Q1 {2}0 tool calls/);
    expect(calls).toHaveLength(1);
  });

  it('runs without a key, with a note, for local servers', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { fetch, calls } = mockFetch([{ body: finalReply('<response>x</response>') }]);
    const local = { EVAL_BASE_URL: 'http://localhost:11434/v1', EVAL_MODEL: 'qwen3' };
    await expect(main(['--only', '1'], local, { fetch })).resolves.toBe(0);
    expect(String(stderr.mock.calls[0][0])).toContain('EVAL_API_KEY is not set');
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it('turns a 401 into a run-stopping error', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { fetch } = mockFetch([{ status: 401, body: '{"message":"Unauthorized"}' }]);
    await expect(main(['--only', '1,2'], env, { fetch })).rejects.toThrow(
      /openai provider: HTTP 401 from https:\/\/api\.mistral\.ai\/v1 .*EVAL_API_KEY/,
    );
  });
});

describe('scoring with API errors', () => {
  const env = { EVAL_BASE_URL: 'https://api.mistral.ai/v1', EVAL_MODEL: 'mistral-large-latest', EVAL_API_KEY: 'k' };

  /** Answers every request with NOT_FOUND, except the given request numbers, which get HTTP 500. */
  function scriptedFetch(failing: number[]): typeof fetch {
    let n = 0;
    return () => {
      n++;
      return Promise.resolve(
        failing.includes(n)
          ? new Response('{"message":"internal"}', { status: 500 })
          : new Response(JSON.stringify(finalReply('<response>NOT_FOUND</response>')), { status: 200 }),
      );
    };
  }

  it('reports API errors as ERROR and withholds the baseline row', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(main([], env, { fetch: scriptedFetch([2, 5]) })).resolves.toBe(1);
    const out = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toMatch(/^FAIL {2}Q1 /m);
    expect(out).toMatch(/^ERROR Q2 /m);
    expect(out).toMatch(/^ERROR Q5 /m);
    expect(out).toContain('error:    openai provider: HTTP 500');
    expect(out).toContain('Results: 0 passed, 8 failed, 2 errored');
    expect(out).toContain('Not a valid baseline: 2 question(s) errored, so no baseline row is printed. Re-run them with --only 2,5');
    expect(out).not.toContain('Baseline row for evals/README.md');
  });

  it('prints the baseline row for a full run without errors', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(main(['--min-interval-ms', '0'], env, { fetch: scriptedFetch([]) })).resolves.toBe(0);
    const out = stdout.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('Results: 0 passed, 10 failed, 0 errored');
    expect(out).toContain('Baseline row for evals/README.md (full run only):');
    expect(out).toMatch(/\| openai \| api\.mistral\.ai \| mistral-large-latest \| - \| \d+ \| 0\/10 \(0%\) \| 0\.0 \|/);
    expect(out).not.toContain('Not a valid baseline');
  });
});

describe('real fetch against a local mock server', () => {
  it('talks plain HTTP Chat Completions with a Bearer key', async () => {
    const seen: Array<{ path: string; auth: string | undefined; body: OpenAIRequest }> = [];
    const replies = [
      toolCallReply([
        { id: 'loc000001', name: 'vault_get_aspect', arguments: '{"path":"people/Mira Chen.md","aspect":"frontmatter"}' },
      ]),
      finalReply(ANSWER),
    ];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
      });
      req.on('end', () => {
        seen.push({ path: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(raw) as OpenAIRequest });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(replies.shift()));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const provider = openAIProvider({
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        apiKey: 'local-key',
        apiKeyEnv: 'EVAL_API_KEY',
        model: 'mistral-large-latest',
      });
      const result = await runAgent(provider, { maxTurns: 5 }, qa, 1);
      expect(result.passed).toBe(true);
      expect(seen.map((s) => s.path)).toEqual(['/v1/chat/completions', '/v1/chat/completions']);
      expect(seen[0].auth).toBe('Bearer local-key');
      expect(seen[1].body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'loc000001' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
