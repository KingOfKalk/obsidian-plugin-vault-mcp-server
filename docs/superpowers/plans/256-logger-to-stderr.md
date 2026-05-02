# Plan — #256 route all log levels to stderr

## Why

`src/utils/logger.ts` currently sends `debug`/`info` JSON lines to
`console.log` (stdout). Stdio MCP transport reserves stdout for JSON-RPC
frames; any other byte on stdout corrupts the stream. Even though the
plugin runs over Streamable HTTP today, the rubric requires the logger to
be safe for stdio swap. Solution: route every level through stderr.

## Scope

- `src/utils/logger.ts`: replace the `console.log(json)` call in the
  `debug`/`info` branch of the `switch (level)` with `console.error(json)`.
- Add one short comment above the switch explaining the WHY.
- Keep the existing `// eslint-disable-next-line no-console` directives
  (project allows `no-console` here intentionally).
- Do NOT touch the `sink` path — it's a plain-text routing concern,
  orthogonal to the stdout/stderr question.

## Tests

`tests/utils/logger.test.ts`:
- Migrate every `console.log` spy that asserts a routing call for
  `debug`/`info` to spy on `console.error` instead. JSON-shape assertions
  stay the same.
- Sink tests that mock `console.log` purely to silence output also move to
  `console.error` so nothing leaks.
- Add one focused regression test that asserts `console.log` is NEVER
  called for any level, while `console.error` IS called for `debug`/`info`.

## Verification

- `npm run lint`
- `npm test`
- `npm run typecheck`

All three must pass before push.

## Commits

1. `docs(plans/256): plan for logger stderr routing` — this file.
2. `fix(utils/logger): route all log levels to stderr for stdio transport compatibility`
   — code + test changes together so the suite stays green at every commit.

Each commit body references `Refs #256`.
