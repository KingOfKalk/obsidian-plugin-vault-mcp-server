# LLM evaluation for the MCP tools

Unit and integration tests check that the tools *work*. This evaluation checks that a model can *use* them: that the tool names, descriptions, parameters, error messages and server instructions lead Claude to the right calls. It follows the [mcp-builder evaluation format](https://github.com/anthropics/skills/tree/main/skills/mcp-builder).

It runs **locally only**, on demand. It calls the Claude API, which needs an API key and costs money, so no GitHub Actions workflow runs it and no API key is stored anywhere in the repository or its workflows. CI checks only the answer key, with scripted solutions and no model (see [How the answers are checked](#how-the-answers-are-checked)).

## What is here

| Path | What it is |
| --- | --- |
| `fixture-vault/` | The hand-written part of the fixture: 14 notes with folders, frontmatter, inline tags, resolved and unresolved wikilinks, aliases, heading and block embeds, a block reference, nested headings, a template in `templates/`, and `reference/Station Log.md` (over 25 000 characters, so `vault_read` has to page with `offset`). No images. |
| `fixture-generator.ts` | Generates the bulk part of the fixture in memory from a fixed seed (`BULK_SEED`), see [The fixture](#the-fixture). Nothing generated is committed. |
| `fixture-adapter.ts` | Loads both parts into `MockObsidianAdapter` and parses the metadata Obsidian would cache (frontmatter, tags, headings, links, embeds). Links resolve by file name, like Obsidian. |
| `harness.ts` | Starts the real server code (`createMcpServer` + `HttpMcpServer`) on the fixture, without Obsidian, on `127.0.0.1` with bearer token `eval-fixture-token`. Every module and tool is enabled. |
| `vault.xml` | The 10 questions and expected answers. |
| `run.ts` | The runner behind `npm run eval`. |
| `lib.ts` | XML parsing and answer comparison. |

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

Run it on your own machine, with your own key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # never commit this
npm run eval
```

For each question the runner starts a fresh server on the fixture, connects an MCP client over Streamable HTTP, gives Claude the server's tools and instructions, and runs a tool-use loop until Claude answers in `<response>` tags. It prints pass/fail, tool calls per question, and the overall accuracy:

```
PASS  Q1  4 tool calls (vault_get_aspect×3, search_by_frontmatter×1), 5 turns, 21.4s
FAIL  Q6  2 tool calls (vault_read×1, search_fulltext×1), 3 turns, 9.8s
      expected: 5.4
      got:      6.5  [stop: end_turn]
...
Accuracy: 9/10 (90.0%)
Tool calls: 41 total, 4.1 per question
```

Options:

| Flag | Effect |
| --- | --- |
| `--only 2,5` | Run only these questions (1-based). |
| `--report out.json` | Also write a JSON report, including Claude's summary of its approach and its feedback on the tools. |
| `--file other.xml` | Use another evaluation file. |
| `--dry-run` | Start the harness (including the generated notes), convert the tools and load the questions, but make no API calls. Prints the fixture size and every question with its expected answer. Needs no key. |

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (required) | Claude API key. The runner reads it from the environment only. |
| `EVAL_MODEL` | `claude-opus-5-5` | Model to evaluate with. |
| `EVAL_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh` or `max`. |
| `EVAL_MAX_TURNS` | `30` | Model turns per question before it counts as failed. |

Requests use adaptive thinking. On models that support it, the runner also turns on the API's server-side refusal fallback (`fallbacks: "default"`), so a safety-classifier decline is retried on a fallback model instead of failing the question.

The exit code is 0 when every question ran (whatever the score), 1 when a question hit an API or harness error, and 2 when the key is missing.

To poke at the server with any MCP client, run `npx tsx evals/harness.ts` (set `EVAL_PORT` to pick the port). It prints the URL and token and runs until Ctrl+C.

The eval is run manually only. There is no GitHub Actions workflow for it, so no API key is stored in the repository.

## Baseline score

Record a baseline so changes to tool names, descriptions, parameters, errors or server instructions can be compared before and after. Scores vary a little between runs, so compare against a baseline from the same model and effort, and re-run a question before trusting a single flip.

To record one:

1. Start from a clean checkout of the commit you want to measure (usually the latest `main`).
2. Run the full set with the defaults, so the row compares with earlier rows:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm run eval -- --report eval-report.json
   ```

   The default model is `claude-opus-5-5` with effort `high` (see `EVAL_MODEL` and `EVAL_EFFORT` above). Do not commit the report; it is for reading the per-question feedback.
3. At the end of a full run (without `--only`) the runner prints a ready-made table row: date, plugin version from `package.json`, model, effort, fixture seed, accuracy, and tool calls per question.
4. Add that row to the table below, newest first, in the same PR as the change it measures. If the score changed, say in the PR which questions flipped and why you think they did (the report's `summary` and `feedback` fields help).

Record a new row when tools or server instructions change in a way the model sees, when the questions or the fixture change, or when the default model changes. Do not edit old rows.

| Date | Version | Model | Effort | Seed | Score | Tool calls per question |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

No baseline has been recorded yet. The first full local run after #466 should fill in the first row.

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
4. Run `npm test`, then `npm run eval -- --only <n>` locally to see how Claude does.

## How the answers are checked

`tests/evals/answers.test.ts` is part of `npm test`, so CI runs it on every change, without a model and without an API key. For each question it starts the harness with the generated notes for `BULK_SEED`, calls the real tools over MCP, follows `nextOffset` through every page, and derives the answer from the results. It fails if the derived answer no longer matches `vault.xml`, if a "most" answer becomes a tie, or if a question no longer needs paging. `tests/evals/fixture-generator.test.ts` checks that the generator is deterministic and that the fixture stays large enough to need paging.

Answers are compared after normalisation: case, surrounding whitespace, quotes, bold, backticks and one trailing period are ignored, and plain numbers compare by value (`5.40` equals `5.4`). Anything looser, such as thousands separators or units, belongs in the question's format instruction.
