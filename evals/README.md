# LLM evaluation for the MCP tools

Unit and integration tests check that the tools *work*. This evaluation checks that a model can *use* them: that the tool names, descriptions, parameters, error messages and server instructions lead a model (Claude, Mistral or any other model behind an OpenAI-compatible API) to the right calls. It follows the [mcp-builder evaluation format](https://github.com/anthropics/skills/tree/main/skills/mcp-builder).

It runs **locally only**, on demand. It calls a model API (Anthropic, or any OpenAI-compatible API such as Mistral), which needs an API key and usually costs money, so no GitHub Actions workflow runs it and no API key is stored anywhere in the repository or its workflows. CI checks only the answer key, with scripted solutions and no model (see [How the answers are checked](#how-the-answers-are-checked)).

## What is here

| Path | What it is |
| --- | --- |
| `fixture-vault/` | The hand-written part of the fixture: 14 notes with folders, frontmatter, inline tags, resolved and unresolved wikilinks, aliases, heading and block embeds, a block reference, nested headings, a template in `templates/`, and `reference/Station Log.md` (over 25 000 characters, so `vault_read` has to page with `offset`). No images. |
| `fixture-generator.ts` | Generates the bulk part of the fixture in memory from a fixed seed (`BULK_SEED`), see [The fixture](#the-fixture). Nothing generated is committed. |
| `fixture-adapter.ts` | Loads both parts into `MockObsidianAdapter` and parses the metadata Obsidian would cache (frontmatter, tags, headings, links, embeds). Links resolve by file name, like Obsidian. |
| `harness.ts` | Starts the real server code (`createMcpServer` + `HttpMcpServer`) on the fixture, without Obsidian, on `127.0.0.1` with bearer token `eval-fixture-token`. Every module and tool is enabled. |
| `vault.xml` | The 10 questions and expected answers. |
| `run.ts` | The runner behind `npm run eval`: settings, the agent loop shared by both providers, the Anthropic provider, report and baseline row. |
| `openai.ts` | The OpenAI-compatible provider (plain `fetch`): tool conversion, request, response parsing, retries and auth errors. |
| `lib.ts` | XML parsing, answer comparison, `.env` loading and the provider interface. |
| `tool-cli.ts` | A command-line MCP client for the harness, for checking questions with a coding agent instead of a model API (see [Cross-check with a coding agent](#cross-check-with-a-coding-agent)). |

Nothing here is imported by `src/`, so none of it ends up in `main.js`.

## The fixture

The eval runs on one vault made of two parts:

- **Hand-written notes** in `fixture-vault/` (14 files): a small team with projects, people, meetings, a template and reference notes.
- **Generated notes** from `fixture-generator.ts` (434 files), made fresh in memory every time the eval, the harness or the answer-key test starts. The generator uses a seeded PRNG (mulberry32, seed `BULK_SEED`), so the same seed always gives the same notes, byte for byte:

  | Folder | Notes | Content |
  | --- | --- | --- |
  | `stations/` | 48 | Monitoring stations: `river`, `elevation`, `installed`, `status` (`operational` or `retired`), `retired` date, `maintainer`; links to the maintainer; `#station`. |
  | `staff/` | 20 | Staff notes: `role`, `team`, `joined`; `#person`. |
  | `visits/` | 360 | Field visit reports named `YYYY-MM-DD ST-nn.md`: `date`, `station`, `outcome`; links to the station, the technician (often Lena Fischer from the hand-written notes) and `Field Protocol`; sometimes a spare part; `#visit` and nested `#issue/<kind>` tags. |
  | `parts/` | 5 | Notes for 5 of the 14 spare parts; the other 9 are unresolved links. |
  | `reference/Calibration Ledger.md` | 1 | A table of 1 400 calibrations, about 62 000 characters. |

The generated part is large on purpose: folder listings, backlinks, the link maps, tag and frontmatter searches and full-text search return more than one page, so the agent has to follow `hasMore`/`nextOffset`, and the ledger needs several `vault_read` pages. To look at the generated notes, write them to a folder outside the repository:

```bash
npx tsx evals/fixture-generator.ts /tmp/eval-bulk
```

Changing the generator or `BULK_SEED` changes the answers. `tests/evals/answers.test.ts` then fails and shows the new derived values; update `vault.xml` to match and record a new baseline.

## Running it

Run it on your own machine, with your own key. The runner talks to one of two providers:

- **`openai`:** any API that speaks the OpenAI Chat Completions format with function calling (`POST {base URL}/chat/completions`, `Authorization: Bearer <key>`): Mistral, OpenAI, OpenRouter, a local Ollama or LM Studio, and so on. It uses plain `fetch`, no vendor SDK.
- **`anthropic`:** the Claude Messages API, with adaptive thinking and an effort level.

Both use the same questions, harness, grading, output, dry run and baseline row.

### Settings and `.env`

Put the settings in a `.env` file in the repository root. The runner loads it on start (like `process.loadEnvFile`), so `npm run eval` works without exporting anything. Variables already set in the shell win over the file. `.env` is gitignored; never commit a key.

### Mistral

```bash
# .env
EVAL_BASE_URL=https://api.mistral.ai/v1
EVAL_MODEL=mistral-large-latest
EVAL_API_KEY=your-mistral-key
# Free tier: about one request per second; pace requests so the run is not rate limited.
EVAL_MIN_INTERVAL_MS=1100
```

```bash
npm run eval -- --dry-run    # check: shows provider, base URL, model, and whether the key is set
npm run eval -- --only 1     # one question first
npm run eval                 # the full set
```

Mistral limits requests per second and per minute, more tightly on the free tier. `EVAL_MIN_INTERVAL_MS=1100` keeps requests at least 1.1 s apart, which suits the free tier's limit of about one request per second; on a paid tier you can lower it or leave it out. Rate-limited requests are retried anyway (see [Rate limits](#rate-limits)), but pacing avoids most of the waiting.

### Other OpenAI-compatible APIs

Same three variables, another base URL and model:

| API | `EVAL_BASE_URL` | `EVAL_MODEL` (example) | Key |
| --- | --- | --- | --- |
| Mistral | `https://api.mistral.ai/v1` | `mistral-large-latest` | `EVAL_API_KEY` |
| OpenAI | `https://api.openai.com/v1` | `gpt-5` | `EVAL_API_KEY` |
| OpenRouter | `https://openrouter.ai/api/v1` | `mistralai/mistral-large` | `EVAL_API_KEY` |
| Ollama (local) | `http://localhost:11434/v1` | `qwen3` | none needed |

Without a key the runner sends no `Authorization` header and prints a note; that is fine for a local server. To keep several keys side by side, name the variable the key comes from: `npm run eval -- --api-key-env MISTRAL_API_KEY`. Every setting also has a flag, which wins over the variable:

```bash
npm run eval -- --base-url https://openrouter.ai/api/v1 --model mistralai/mistral-large --api-key-env OPENROUTER_API_KEY
```

The model has to support function calling (tools). Notes on how the runner talks to these APIs:

- Tools are sent as `tools: [{type: "function", function: {name, description, parameters}}]` with `tool_choice: "auto"`. `parameters` is the tool's MCP input schema without `$schema`. Some providers reject other JSON Schema keywords; list them in `EVAL_SCHEMA_DROP` (comma-separated, e.g. `EVAL_SCHEMA_DROP=additionalProperties,propertyNames`) and the runner drops them everywhere in the schema. The MCP server still validates every call with the full schema.
- Tool results go back as one `role: "tool"` message per call, with `tool_call_id` and `name`, as text: data tools as their JSON text, document tools as plain text, an image block as the placeholder `[image content omitted]`. An error result starts with `Error: `.
- Several tool calls in one turn (parallel calls) all run and are answered in order. Arguments may come as a JSON string or as an object; arguments that are not valid JSON go back to the model as an error without calling the tool. A tool call without an `id` gets one.
- No `max_tokens`, temperature or effort is sent; the provider's defaults apply. `EVAL_EFFORT` is ignored for `openai`.
- HTTP 429, 502, 503 and 504 are retried (see [Rate limits](#rate-limits)). Any other error, or one of these that is still there after all retries, ends that question as `ERROR` and the run goes on. So does a reply with `finish_reason: "error"` (Mistral sends it when a generation fails on its side). HTTP 401 or 403 stops the run with a message that names the provider, the base URL and the variable the key came from.

### Rate limits

- **Retries:** a request that gets HTTP 429 (rate limited), 502 or 504 (gateway errors, e.g. Mistral's `upstream request failed`) or 503 (unavailable) is retried up to 6 times. The runner waits for `Retry-After` when the server sends it, else 2, 4, 8, 16, 32 and 60 s; no wait is longer than 60 s. Each wait prints one line, e.g. `rate limited, waiting 4s (attempt 2/6)` or `server error (HTTP 502), waiting 2s (attempt 1/6)`. The Anthropic SDK retries 429 and 5xx up to 6 times as well, with its own backoff.
- **Pacing:** `EVAL_MIN_INTERVAL_MS` (or `--min-interval-ms`) keeps model requests at least that many milliseconds apart, across all questions, for both providers. Default `0` (no pacing). For Mistral's free tier use `1100`.

### Anthropic

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

Then `npm run eval`. Requests use adaptive thinking and `EVAL_EFFORT`. On models that support it, the runner also turns on the API's server-side refusal fallback (`fallbacks: "default"`), so a safety-classifier decline is retried on a fallback model instead of failing the question.

### Choosing the provider

`--provider anthropic|openai` or `EVAL_PROVIDER`. Without either, the provider is `openai` when a base URL is set (`EVAL_BASE_URL` or `--base-url`), otherwise `anthropic`. To run Claude while `.env` holds Mistral settings, pass `--provider anthropic --model claude-opus-5-5` (`EVAL_MODEL` applies to whichever provider runs).

### Output

For each question the runner starts a fresh server on the fixture, connects an MCP client over Streamable HTTP, gives the model the server's tools and instructions, and runs a tool-use loop until the model answers in `<response>` tags. It prints `PASS`, `FAIL` or `ERROR`, tool calls per question, and the totals:

```
PASS  Q1  4 tool calls (vault_get_aspect×3, search_by_frontmatter×1), 5 turns, 21.4s
FAIL  Q6  2 tool calls (vault_read×1, search_fulltext×1), 3 turns, 9.8s
      expected: 5.4
      got:      6.5  [stop: end_turn]
ERROR Q7  3 tool calls (search_by_tag×3), 4 turns, 131.2s
      expected: 2025-07
      got:      (no <response> tag)  [stop: error]
      error:    openai provider: HTTP 429 from https://api.mistral.ai/v1/chat/completions after 6 retries: ...
...
Accuracy: 8/10 (80.0%)
Results: 8 passed, 1 failed, 1 errored
Tool calls: 41 total, 4.1 per question
```

`FAIL` means the model answered wrongly or not at all. `ERROR` means the question ended on an API or harness error (rate limit after all retries, network, HTTP 5xx, `finish_reason: "error"`), so it says nothing about the tools; re-run it with `--only`. Accuracy counts errored questions as not passed.

A call to a tool name the server does not have is counted as `(unknown tool)` in the tool-call summary and answered with an error, without reaching the server. Some models invent tool calls whose name is a made-up tool result; a high `(unknown tool)` count points to that.

Options:

| Flag | Effect |
| --- | --- |
| `--only 2,5` | Run only these questions (1-based). |
| `--report out.json` | Also write a JSON report, including the model's summary of its approach and its feedback on the tools. |
| `--file other.xml` | Use another evaluation file. |
| `--dry-run` | Start the harness (including the generated notes), convert the tools for the provider and load the questions, but make no API calls. Prints the provider, base URL, model, whether the key is set (never the key), the fixture size and every question with its expected answer. Needs no key. |
| `--provider anthropic\|openai` | Provider; overrides `EVAL_PROVIDER`. |
| `--base-url <url>` | Base URL; overrides `EVAL_BASE_URL` (for `anthropic`, `ANTHROPIC_BASE_URL`). |
| `--model <id>` | Model; overrides `EVAL_MODEL`. |
| `--api-key-env <NAME>` | Read the key from this variable instead of `EVAL_API_KEY` (`openai`) or `ANTHROPIC_API_KEY` (`anthropic`). |
| `--min-interval-ms <ms>` | Minimum gap between model requests; overrides `EVAL_MIN_INTERVAL_MS`. |

Environment variables (in `.env` or the shell):

| Variable | Default | Meaning |
| --- | --- | --- |
| `EVAL_PROVIDER` | see above | `anthropic` or `openai`. |
| `EVAL_BASE_URL` | (required for `openai`) | Base URL of the OpenAI-compatible API; `/chat/completions` is appended. |
| `EVAL_API_KEY` | (none) | Key for the `openai` provider. Optional for local servers. |
| `ANTHROPIC_API_KEY` | (required for `anthropic`) | Claude API key. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Claude API base URL. |
| `EVAL_MODEL` | `claude-opus-5-5` for `anthropic`; required for `openai` | Model to evaluate with. |
| `EVAL_EFFORT` | `high` | `anthropic` only: `low`, `medium`, `high`, `xhigh` or `max`. |
| `EVAL_MAX_TURNS` | `30` | Model turns per question before it counts as failed. |
| `EVAL_SCHEMA_DROP` | (none) | `openai` only: extra JSON Schema keywords to drop from tool parameters. |
| `EVAL_MIN_INTERVAL_MS` | `0` | Minimum gap in ms between model requests (pacing); `1100` for Mistral's free tier. |

The exit code is 0 when every question ran (whatever the score), 1 when a question ended as `ERROR` or the key was rejected, and 2 when `ANTHROPIC_API_KEY` is missing for the `anthropic` provider. A missing base URL or model for `openai` stops with a message that says which variable to set.

To poke at the server with any MCP client, run `npx tsx evals/harness.ts` (set `EVAL_PORT` to pick the port). It prints the URL and token and runs until Ctrl+C.

The eval is run manually only. There is no GitHub Actions workflow for it, so no API key is stored in the repository.

## Baseline score

Record a baseline so changes to tool names, descriptions, parameters, errors or server instructions can be compared before and after. Scores vary a little between runs and a lot between models, so compare only against a baseline from the same provider, model and effort, and re-run a question before trusting a single flip.

To record one:

1. Start from a clean checkout of the commit you want to measure (usually the latest `main`).
2. Run the full set with your provider settings in `.env` (for Mistral, the example above):

   ```bash
   npm run eval -- --report eval-report.json
   ```

   Keep the same provider, model and (for Anthropic) effort as the rows you compare with. Do not commit the report; it is for reading the per-question feedback.
3. At the end of a full run (without `--only`) the runner prints a ready-made table row: date, plugin version from `package.json`, provider, base URL host, model, effort (`-` for `openai`), fixture seed, accuracy, and tool calls per question. If any question ended as `ERROR`, it prints `Not a valid baseline: N question(s) errored` instead of the row: fix the cause (for rate limits, raise `EVAL_MIN_INTERVAL_MS`) and run the full set again.
4. Add that row to the table below, newest first, in the same PR as the change it measures. If the score changed, say in the PR which questions flipped and why you think they did (the report's `summary` and `feedback` fields help).

Record a new row when tools or server instructions change in a way the model sees, when the questions or the fixture change, or when you start measuring with another model. Do not edit old rows.

| Date | Version | Provider | Host | Model | Effort | Seed | Score | Tool calls per question |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-10 | 5.0.0 | openai | api.mistral.ai | mistral-large-latest | - | 505 | 5/10 (50%) | 31.0 |
| 2026-11-10 | 5.0.0 | openai | api.mistral.ai | mistral-large-latest | - | 505 | 7/10 (70%) | 19.7 |
| 2026-11-10 | 5.0.0 | openai | api.mistral.ai | mistral-large-latest | - | 505 | 4/10 (40%) | 28.4 |

The three Mistral rows of 2026-11-10 are three full runs of the same commit, back to back: one run of 10 questions swings by 30 points, so compare a change against the mean of several runs (here 5.3/10), not against one row. In all three runs Q2, Q5 and Q7 failed and Q3, Q4, Q8 and Q10 passed.

## Cross-check with a coding agent

When no model API key is at hand, or to see whether a question is solvable at all with the current tools, a coding agent (for example a Claude Code subagent) can answer the questions through `tool-cli.ts`. It talks to the same harness and prints tool results the way the runner shows them to the model. This is a check, not a baseline: the prompt and the tool loop differ from `npm run eval`, nothing is graded automatically, and the agent could read the answer key if it ignored its instructions. Do not add such results to the baseline table.

1. Start the harness on a fixed port and leave it running:

   ```bash
   EVAL_PORT=47811 npx tsx evals/harness.ts
   ```

2. Check the CLI in another shell:

   ```bash
   npx tsx evals/tool-cli.ts tools
   ```

   Commands: `instructions`, `tools` (one line per tool), `schema <tool>`, `call <tool> '<json-args>'`. A tool error prints `Error: ...` and exits with 1.

3. Give each question to a fresh agent that has not seen `vault.xml`, with a prompt like this:

   ```text
   You are connected to an Obsidian vault through MCP tools, exposed via a command-line client.
   Answer one question using only what these tools return.

   Run from the repository root:
   - npx tsx evals/tool-cli.ts instructions    (read first)
   - npx tsx evals/tool-cli.ts tools
   - npx tsx evals/tool-cli.ts schema <tool>
   - npx tsx evals/tool-cli.ts call <tool> '<json arguments>'

   Rules: use only tool-cli.ts to get information. Do not read, list or search any file in the
   repository. Do not call tools that change the vault. Use as many tool calls as you need; do not guess.

   Question: <question from vault.xml>

   Reply with a short <summary> of your steps, <feedback> on the tools, the answer in
   <response> tags, and the number of tool calls you made.
   ```

4. Compare each `<response>` with the answer in `vault.xml` yourself. The `<feedback>` is the useful part: it names tools whose descriptions or results got in the way.

On 2026-11-10 Claude subagents answered the five questions Mistral failed most often (Q2, Q5, Q6, Q7, Q9) correctly, with 10 to about 60 tool calls each. That shows the answer key holds and the questions are solvable with the tools as they are; the findings are in #499.

## Adding or changing questions

Follow the rules in the mcp-builder guide. Each question must be:

- **read-only:** answerable without any write tool;
- **multi-step:** it needs several tool calls, e.g. search, then read, then follow links;
- **verifiable:** one short answer that can be compared as a string; say the format in the question ("Answer with a number only");
- **stable:** derived only from `fixture-vault/` and the generated notes for `BULK_SEED`;
- **unique:** for "most" or "earliest" questions, the winner must lead by a clear margin, not by one, so a small generator change shows up as a test failure rather than a silent tie;
- **not a keyword search:** paraphrase instead of quoting the note's words.

Steps:

1. If the question needs new content, add hand-written notes to `fixture-vault/` (small, no images) or extend `fixture-generator.ts` (bulk content, kept deterministic: use the seeded `rng`, never `Math.random()` or the clock). Check that the existing answers still hold.
2. Add a `<qa_pair>` to `vault.xml`. Keep the total around 10.
3. Add a scripted solution to `tests/evals/answers.test.ts` in the same position. It must solve the question through the MCP tools (read-only ones only), page through results like an agent would, and derive the answer from the tool results. This is how every answer is verified.
4. Run `npm test`, then `npm run eval -- --only <n>` locally to see how the model does.

## How the answers are checked

`tests/evals/answers.test.ts` is part of `npm test`, so CI runs it on every change, without a model and without an API key. For each question it starts the harness with the generated notes for `BULK_SEED`, calls the real tools over MCP, follows `nextOffset` through every page, and derives the answer from the results. It fails if the derived answer no longer matches `vault.xml`, if a "most" answer becomes a tie, or if a question no longer needs paging. `tests/evals/fixture-generator.test.ts` checks that the generator is deterministic and that the fixture stays large enough to need paging.

Answers are compared after normalisation: case, surrounding whitespace, quotes, bold, backticks and one trailing period are ignored, and plain numbers compare by value (`5.40` equals `5.4`). Anything looser, such as thousands separators or units, belongs in the question's format instruction.
