# LLM evaluation for the MCP tools

Unit and integration tests check that the tools *work*. This evaluation checks that a model can *use* them: that the tool names, descriptions, parameters, error messages and server instructions lead Claude to the right calls. It follows the [mcp-builder evaluation format](https://github.com/anthropics/skills/tree/main/skills/mcp-builder).

It is manual and on demand only. It is not part of required CI, because it calls the Claude API and costs money.

## What is here

| Path | What it is |
| --- | --- |
| `fixture-vault/` | A small, fixed vault of markdown notes: folders, frontmatter, inline tags, resolved and unresolved wikilinks, aliases, heading and block embeds, a block reference, nested headings, a template in `templates/`, and `reference/Station Log.md` (over 25 000 characters, so `vault_read` has to page with `offset`). No images. |
| `fixture-adapter.ts` | Loads the fixture into `MockObsidianAdapter` and parses the metadata Obsidian would cache (frontmatter, tags, headings, links, embeds). Links resolve by file name, like Obsidian. |
| `harness.ts` | Starts the real server code (`createMcpServer` + `HttpMcpServer`) on the fixture, without Obsidian, on `127.0.0.1` with bearer token `eval-fixture-token`. Every module and tool is enabled. |
| `vault.xml` | The 10 questions and expected answers. |
| `run.ts` | The runner behind `npm run eval`. |
| `lib.ts` | XML parsing and answer comparison. |

Nothing here is imported by `src/`, so none of it ends up in `main.js`.

## Running it

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
| `--dry-run` | Start the harness, convert the tools and load the questions, but make no API calls. Needs no key. |

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

## Adding or changing questions

Follow the rules in the mcp-builder guide. Each question must be:

- **read-only:** answerable without any write tool;
- **multi-step:** it needs several tool calls, e.g. search, then read, then follow links;
- **verifiable:** one short answer that can be compared as a string; say the format in the question ("Answer with a number only");
- **stable:** derived only from `fixture-vault/`;
- **not a keyword search:** paraphrase instead of quoting the note's words.

Steps:

1. If the question needs new content, add or edit notes in `fixture-vault/`. Keep it small and free of images. Check that the existing answers still hold.
2. Add a `<qa_pair>` to `vault.xml`.
3. Add a scripted solution to `tests/evals/answers.test.ts` in the same position. It must solve the question through the MCP tools (read-only ones only) and derive the answer from their results. This is how every answer is verified, and CI re-checks them on every change.
4. Run `npm test`, then `npm run eval -- --only <n>` to see how Claude does.

Answers are compared after normalisation: case, surrounding whitespace, quotes, bold, backticks and one trailing period are ignored, and plain numbers compare by value (`5.40` equals `5.4`). Anything looser, such as thousands separators or units, belongs in the question's format instruction.
