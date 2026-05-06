# `/fix-broken-links` MCP prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth MCP prompt `/fix-broken-links` to [`src/server/prompts.ts`](../../../src/server/prompts.ts) that seeds Claude with a `search_unresolved_links` call and a four-strategy triage loop (retarget / stub / delete / leave), with an optional `path` argument that scopes the triage to one note and an autocomplete that lists vault notes currently containing unresolved links.

**Architecture:** Pure prompt orchestration over existing primitives. New handler + completer functions in [`src/server/prompts.ts`](../../../src/server/prompts.ts). New `registerPrompt(...)` call in `registerPrompts(...)`. Tests in [`tests/server/prompts.test.ts`](../../../tests/server/prompts.test.ts) and [`tests/integration/prompts.test.ts`](../../../tests/integration/prompts.test.ts). Doc update to [`docs/help/en.md`](../../help/en.md). No new tool, no new adapter method, no settings change.

**Tech Stack:** TypeScript, Zod, `@modelcontextprotocol/sdk`, Vitest.

**Spec:** [`docs/superpowers/specs/2026-05-06-fix-broken-links-prompt-design.md`](../specs/2026-05-06-fix-broken-links-prompt-design.md)

**Branch:** `feat/issue-305-fix-broken-links-prompt` (already created, spec already committed).

---

## File map

- **Modify** [`src/server/prompts.ts`](../../../src/server/prompts.ts) — add `createFixBrokenLinksHandler`, `createUnresolvedSourcesCompleter`, and a fifth `server.registerPrompt(...)` call inside `registerPrompts(...)`.
- **Modify** [`tests/server/prompts.test.ts`](../../../tests/server/prompts.test.ts) — new `describe` blocks for the handler and completer.
- **Modify** [`tests/integration/prompts.test.ts`](../../../tests/integration/prompts.test.ts) — extend `prompts/list` expectation, add `prompts/get` smoke checks, add `completion/complete` check.
- **Modify** [`docs/help/en.md`](../../help/en.md) — bump prompt count from `four` to `five`, add the new prompt to the host-rendering example, the settings table, the **Available prompts** list, and the **Autocomplete** section.

No file creations. No `docs/tools.generated.md` regeneration (no new tool).

---

## Task 1: Vault-wide handler — failing test + minimal impl

Establishes the handler skeleton with the no-arg path. TDD discipline: red first, then green.

**Files:**
- Modify: `tests/server/prompts.test.ts` (append new `describe` block)
- Modify: `src/server/prompts.ts` (append new exported handler + private body builder; do NOT touch `registerPrompts(...)` yet)

- [ ] **Step 1: Add the failing test for the vault-wide body**

Append to [`tests/server/prompts.test.ts`](../../../tests/server/prompts.test.ts) (at the end of the file). First, extend the existing import block from `'../../src/server/prompts'`:

```ts
import {
  createSummarizeNoteHandler,
  createFindRelatedHandler,
  createExpandTemplateHandler,
  createTemplateCompleter,
  createDailyNoteHandler,
  createFixBrokenLinksHandler,        // NEW
  createUnresolvedSourcesCompleter,   // NEW (used by Task 4 — adding here keeps the import block edited once)
} from '../../src/server/prompts';
```

Then append the new describe block at the end of the file:

```ts
describe('fix-broken-links handler', () => {
  it('returns the vault-wide body when called with no path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFixBrokenLinksHandler(adapter);

    const result = await handler({});

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = (message.content as { type: 'text'; text: string }).text;
    expect(text).toContain('Fix broken links across the vault');
    expect(text).toContain('search_unresolved_links');
    expect(text).toContain('vault_create');
    expect(text).toContain('vault_update');
    expect(text).toContain('Retarget');
    expect(text).toContain('Create a stub');
    expect(text).toContain('Delete the link');
    expect(text).toContain('Leave as-is');
    expect(text).toContain('~20');
    expect(text).toContain('one at a time');
    // Single-note opener must NOT appear in the vault-wide body
    expect(text).not.toContain('Fix broken links in `');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails on the missing export**

Run: `npx vitest run tests/server/prompts.test.ts -t "fix-broken-links handler"`

Expected: FAIL — `createFixBrokenLinksHandler` (and `createUnresolvedSourcesCompleter`) is not exported. The error is a TypeScript / module-resolution error, not an assertion failure. That's the correct red state.

- [ ] **Step 3: Add the vault-wide body constant + exported handler**

Open [`src/server/prompts.ts`](../../../src/server/prompts.ts). Append at the end of the file (after `createDailyNoteHandler`, before `registerPrompts`):

```ts
const FIX_BROKEN_LINKS_VAULT_WIDE_BODY = `Fix broken links across the vault. First call \`search_unresolved_links\` to enumerate them — the result is a \`Record<source, Record<target, count>>\` mapping each note containing broken links to its unresolved targets. If more than ~20 source notes are returned, work on the first 20 and report the remaining count so the user can re-run this prompt to continue. For each broken link, propose **one** fix as a single tool call so the user can confirm before it's applied:

- **Retarget** to an existing note: locate the intended target with \`search_fulltext\` or \`vault_list_recursive\`, then read the source note with \`vault_read\`, rewrite the link, and write it back with \`vault_update\` (or \`editor_replace\` if the source is the active editor and you know the exact range).
- **Create a stub** for the missing note: call \`vault_create\` at the link's target path with a minimal placeholder body.
- **Delete the link**: read the source with \`vault_read\`, remove just the wikilink (keep surrounding prose), and write back with \`vault_update\`.
- **Leave as-is**: skip and explain why (e.g. it's an intentional placeholder).

Apply fixes one at a time. Wait for the user to confirm each tool call before moving on.`;

interface FixBrokenLinksArgs {
  path?: string;
}

export function createFixBrokenLinksHandler(
  _adapter: ObsidianAdapter,
): (args: FixBrokenLinksArgs) => Promise<GetPromptResult> {
  // async so a synchronous throw from validateVaultPath (added in Task 3)
  // surfaces as a rejected promise rather than a synchronous throw at the
  // call site.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (_args) => {
    return userTextMessage(FIX_BROKEN_LINKS_VAULT_WIDE_BODY);
  };
}
```

(The `_adapter` and `_args` underscore prefixes silence "unused" lints. Both will be used in later tasks. Adapter parameter stays so the function signature matches the other `create*Handler(adapter)` factories.)

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/server/prompts.test.ts -t "fix-broken-links handler"`

Expected: PASS — one test (the vault-wide variant).

- [ ] **Step 5: Commit**

```bash
git add tests/server/prompts.test.ts src/server/prompts.ts
git commit -m "test(server/prompts): vault-wide /fix-broken-links handler

Refs #305"
```

---

## Task 2: Single-note variant — branch on `path`

Adds the `path`-bearing branch.

**Files:**
- Modify: `tests/server/prompts.test.ts` (extend existing `describe('fix-broken-links handler', …)` block)
- Modify: `src/server/prompts.ts` (extend the handler)

- [ ] **Step 1: Add the failing test for the single-note body**

Inside the existing `describe('fix-broken-links handler', …)` block, append:

```ts
  it('returns the single-note body when called with a path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFixBrokenLinksHandler(adapter);

    const result = await handler({ path: 'notes/foo.md' });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text).toContain('Fix broken links in `notes/foo.md`');
    expect(text).toContain('search_unresolved_links');
    expect(text).toContain('pull out the entry whose source matches');
    expect(text).toContain('tell the user the note has no unresolved links and stop');
    expect(text).toContain('Retarget');
    expect(text).toContain('Create a stub');
    expect(text).toContain('Delete the link');
    expect(text).toContain('Leave as-is');
    expect(text).toContain('one at a time');
    // Vault-wide opener must NOT appear in the single-note body
    expect(text).not.toContain('Fix broken links across the vault');
  });
```

- [ ] **Step 2: Run the test and verify it fails on the assertion**

Run: `npx vitest run tests/server/prompts.test.ts -t "fix-broken-links handler"`

Expected: FAIL on the second test — `text` contains the vault-wide body, not the single-note body. The first test still passes.

- [ ] **Step 3: Add the single-note body builder and branch the handler**

In [`src/server/prompts.ts`](../../../src/server/prompts.ts), insert the body builder just above `FIX_BROKEN_LINKS_VAULT_WIDE_BODY` (so both definitions live together):

```ts
function fixBrokenLinksSingleNoteBody(path: string): string {
  return `Fix broken links in \`${path}\`. First call \`search_unresolved_links\` and pull out the entry whose source matches \`${path}\` — the value is a \`Record<target, count>\` of unresolved targets in this note. If \`${path}\` is not in the result, tell the user the note has no unresolved links and stop. For each broken link, propose **one** fix as a single tool call so the user can confirm before it's applied:

- **Retarget** to an existing note: locate the intended target with \`search_fulltext\` or \`vault_list_recursive\`, then read \`${path}\` with \`vault_read\`, rewrite the link, and write it back with \`vault_update\` (or \`editor_replace\` if \`${path}\` is the active editor and you know the exact range).
- **Create a stub** for the missing note: call \`vault_create\` at the link's target path with a minimal placeholder body.
- **Delete the link**: read \`${path}\` with \`vault_read\`, remove just the wikilink (keep surrounding prose), and write back with \`vault_update\`.
- **Leave as-is**: skip and explain why.

Apply fixes one at a time. Wait for the user to confirm each tool call before moving on.`;
}
```

Then change the body of `createFixBrokenLinksHandler` from:

```ts
  return async (_args) => {
    return userTextMessage(FIX_BROKEN_LINKS_VAULT_WIDE_BODY);
  };
```

to:

```ts
  return async (args) => {
    const text = args.path
      ? fixBrokenLinksSingleNoteBody(args.path)
      : FIX_BROKEN_LINKS_VAULT_WIDE_BODY;
    return userTextMessage(text);
  };
```

(Drop the underscore on `args` — it's used now.)

- [ ] **Step 4: Run the tests and verify both pass**

Run: `npx vitest run tests/server/prompts.test.ts -t "fix-broken-links handler"`

Expected: PASS — both tests (vault-wide and single-note).

- [ ] **Step 5: Commit**

```bash
git add tests/server/prompts.test.ts src/server/prompts.ts
git commit -m "feat(server/prompts): single-note variant of /fix-broken-links

Refs #305"
```

---

## Task 3: Path validation (defense in depth)

`validateVaultPath` only when `args.path !== undefined`. Mirrors `summarize-note` / `find-related`.

**Files:**
- Modify: `tests/server/prompts.test.ts` (one more test in the existing describe block)
- Modify: `src/server/prompts.ts` (add validation call)

- [ ] **Step 1: Add the failing test for path traversal**

Append inside `describe('fix-broken-links handler', …)`:

```ts
  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFixBrokenLinksHandler(adapter);

    await expect(handler({ path: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/server/prompts.test.ts -t "fix-broken-links handler"`

Expected: FAIL on the traversal test — the handler currently does no validation, so it just returns a body containing the traversal string. The first two tests still pass.

- [ ] **Step 3: Add the validation call in the handler**

In [`src/server/prompts.ts`](../../../src/server/prompts.ts), change the handler body from:

```ts
  return async (args) => {
    const text = args.path
      ? fixBrokenLinksSingleNoteBody(args.path)
      : FIX_BROKEN_LINKS_VAULT_WIDE_BODY;
    return userTextMessage(text);
  };
```

to:

```ts
  return async (args) => {
    let text: string;
    if (args.path !== undefined) {
      const path = validateVaultPath(args.path, _adapter.getVaultPath());
      text = fixBrokenLinksSingleNoteBody(path);
    } else {
      text = FIX_BROKEN_LINKS_VAULT_WIDE_BODY;
    }
    return userTextMessage(text);
  };
```

Then drop the underscore on `_adapter` in the function signature — it's used now:

```ts
export function createFixBrokenLinksHandler(
  adapter: ObsidianAdapter,
): (args: FixBrokenLinksArgs) => Promise<GetPromptResult> {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (args) => {
    let text: string;
    if (args.path !== undefined) {
      const path = validateVaultPath(args.path, adapter.getVaultPath());
      text = fixBrokenLinksSingleNoteBody(path);
    } else {
      text = FIX_BROKEN_LINKS_VAULT_WIDE_BODY;
    }
    return userTextMessage(text);
  };
}
```

- [ ] **Step 4: Run the tests and verify all three pass**

Run: `npx vitest run tests/server/prompts.test.ts -t "fix-broken-links handler"`

Expected: PASS — three tests (vault-wide, single-note, traversal-rejected).

- [ ] **Step 5: Commit**

```bash
git add tests/server/prompts.test.ts src/server/prompts.ts
git commit -m "feat(server/prompts): validate path arg of /fix-broken-links

Refs #305"
```

---

## Task 4: Completer

`createUnresolvedSourcesCompleter` mirrors `createTemplateCompleter` but pulls keys from `adapter.getUnresolvedLinks()` instead of `adapter.list('templates').files`.

**Files:**
- Modify: `tests/server/prompts.test.ts` (new `describe('unresolvedSourcesCompleter', …)` block)
- Modify: `src/server/prompts.ts` (new exported function)

- [ ] **Step 1: Add the failing tests**

Append at the end of [`tests/server/prompts.test.ts`](../../../tests/server/prompts.test.ts):

```ts
describe('unresolvedSourcesCompleter', () => {
  it('returns [] when the adapter reports no unresolved links', async () => {
    const adapter = new MockObsidianAdapter();
    // No files, so getUnresolvedLinks() returns {}.
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('');

    expect(result).toEqual([]);
  });

  it('filters by case-insensitive substring match on the source path', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('notes/Weekly.md', '');
    adapter.setMetadata('notes/Weekly.md', { links: [{ link: 'missing-target' }] });
    adapter.addFile('notes/Daily.md', '');
    adapter.setMetadata('notes/Daily.md', { links: [{ link: 'also-missing' }] });
    adapter.addFile('notes/Monthly.md', '');
    adapter.setMetadata('notes/Monthly.md', { links: [{ link: 'still-missing' }] });
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('weEK');

    expect(result).toEqual(['notes/Weekly.md']);
  });

  it('caps results at 100', async () => {
    const adapter = new MockObsidianAdapter();
    for (let i = 0; i < 150; i++) {
      const path = `notes/n${String(i)}.md`;
      adapter.addFile(path, '');
      adapter.setMetadata(path, { links: [{ link: `missing-${String(i)}` }] });
    }
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('');

    expect(result.length).toBe(100);
  });

  it('returns [] when getUnresolvedLinks throws (no propagation)', async () => {
    const adapter = new MockObsidianAdapter();
    // Replace getUnresolvedLinks with a throwing stub. Cast through unknown
    // to satisfy strict typing without modifying the real adapter surface.
    (adapter as unknown as { getUnresolvedLinks: () => never }).getUnresolvedLinks = () => {
      throw new Error('boom');
    };
    const completer = createUnresolvedSourcesCompleter(adapter);

    const result = await completer('anything');

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail on the missing export**

Run: `npx vitest run tests/server/prompts.test.ts -t "unresolvedSourcesCompleter"`

Expected: FAIL — `createUnresolvedSourcesCompleter` is referenced in the import block (added in Task 1, Step 1) but not yet exported from the source module. The test loader fails.

- [ ] **Step 3: Add the completer function**

In [`src/server/prompts.ts`](../../../src/server/prompts.ts), append after `createFixBrokenLinksHandler` (and before `registerPrompts`):

```ts
export function createUnresolvedSourcesCompleter(
  adapter: ObsidianAdapter,
): (partial: string) => Promise<string[]> {
  // async so the return type matches the SDK's CompleteCallback signature
  // (string[] | Promise<string[]>), keeping this consistent with other
  // async-by-convention callbacks in this module.
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (partial) => {
    try {
      const map = adapter.getUnresolvedLinks();
      const needle = partial.toLowerCase();
      return Object.keys(map)
        .filter((p) => p.toLowerCase().includes(needle))
        .slice(0, COMPLETER_RESULT_LIMIT);
    } catch {
      return [];
    }
  };
}
```

`COMPLETER_RESULT_LIMIT` is already defined at the top of the file (set to `100`) — reuse it.

- [ ] **Step 4: Run the tests and verify all four pass**

Run: `npx vitest run tests/server/prompts.test.ts -t "unresolvedSourcesCompleter"`

Expected: PASS — four tests (empty, filter, cap, throw).

- [ ] **Step 5: Commit**

```bash
git add tests/server/prompts.test.ts src/server/prompts.ts
git commit -m "feat(server/prompts): autocomplete for /fix-broken-links path arg

Refs #305"
```

---

## Task 5: Register the prompt + integration tests

Wire the handler and completer into `registerPrompts(...)` and extend the integration test.

**Files:**
- Modify: `src/server/prompts.ts` (add `server.registerPrompt(...)` call inside `registerPrompts`)
- Modify: `tests/integration/prompts.test.ts` (extend single existing test)

- [ ] **Step 1: Update the `prompts/list` expectation in the integration test**

Open [`tests/integration/prompts.test.ts`](../../../tests/integration/prompts.test.ts). In the `it('lists all four prompts …')` test:

Rename the test description from `'lists all four prompts and serves prompts/get + completion/complete via the SDK transport'` to `'lists all five prompts and serves prompts/get + completion/complete via the SDK transport'`.

Update the `prompts/list` expectation:

```ts
    const list = await client.listPrompts();
    expect(list.prompts.map((p) => p.name).sort()).toEqual([
      'daily-note',
      'expand-template',
      'find-related',
      'fix-broken-links',         // NEW
      'summarize-note',
    ]);
```

- [ ] **Step 2: Add `prompts/get` and `completion/complete` checks**

In the same test, immediately after the `daily-note` block (after the `expect(dailyText).toContain('2026-05-05');` line and before `await client.close();`), append:

```ts
    // prompts/get for /fix-broken-links — no path → vault-wide body
    const fixVaultWide = await client.getPrompt({
      name: 'fix-broken-links',
      arguments: {},
    });
    expect(fixVaultWide.messages).toHaveLength(1);
    const fixVaultWideText = (fixVaultWide.messages[0].content as { type: 'text'; text: string }).text;
    expect(fixVaultWideText).toContain('Fix broken links across the vault');
    expect(fixVaultWideText).toContain('search_unresolved_links');

    // prompts/get for /fix-broken-links — with path → single-note body
    const fixOne = await client.getPrompt({
      name: 'fix-broken-links',
      arguments: { path: 'notes/foo.md' },
    });
    const fixOneText = (fixOne.messages[0].content as { type: 'text'; text: string }).text;
    expect(fixOneText).toContain('notes/foo.md');
    expect(fixOneText).toContain('search_unresolved_links');

    // completion/complete for /fix-broken-links's `path` argument.
    // Pre-populate the mock with a note whose link metadata points at a
    // non-existent target, so getUnresolvedLinks() reports it.
    adapter.addFile('notes/with-broken-link.md', '');
    adapter.setMetadata('notes/with-broken-link.md', { links: [{ link: 'does-not-exist' }] });
    const fixCompletion = await client.complete({
      ref: { type: 'ref/prompt', name: 'fix-broken-links' },
      argument: { name: 'path', value: 'broken' },
    });
    expect(fixCompletion.completion.values).toContain('notes/with-broken-link.md');
```

- [ ] **Step 3: Run the integration test and verify it fails**

Run: `npx vitest run tests/integration/prompts.test.ts`

Expected: FAIL — `prompts/list` does not include `fix-broken-links` yet (the prompt is not registered with the server).

- [ ] **Step 4: Register the prompt in `registerPrompts`**

In [`src/server/prompts.ts`](../../../src/server/prompts.ts), inside `registerPrompts(...)`, append after the `daily-note` `server.registerPrompt(...)` call:

```ts
  const fixBrokenLinks = createFixBrokenLinksHandler(adapter);
  const unresolvedSourcesCompleter = createUnresolvedSourcesCompleter(adapter);

  logger.debug('Registering prompt: fix-broken-links');
  server.registerPrompt(
    'fix-broken-links',
    {
      title: 'Triage broken (unresolved) wikilinks',
      description:
        'Enumerate broken wikilinks (vault-wide or for one note) and walk through retargeting, stubbing out, or deleting them.',
      argsSchema: {
        path: completable(
          z
            .string()
            .optional()
            .describe('Optional vault-relative path. Omit to triage the whole vault.'),
          (value) => unresolvedSourcesCompleter(value ?? ''),
        ),
      },
    },
    (args: { path?: string }, _extra) => fixBrokenLinks(args),
  );
```

The `value ?? ''` handles the optional schema: when the host requests completion before the user has typed anything, `value` is `undefined`; the completer expects a string, so coerce to `''` (which means "no filter").

- [ ] **Step 5: Run the integration test and verify it passes**

Run: `npx vitest run tests/integration/prompts.test.ts`

Expected: PASS.

If TypeScript complains about `completable(z.string().optional(), …)` (unlikely — `completable` is generic on `AnySchema`), fall back to:

```ts
        path: z
          .string()
          .optional()
          .describe('Optional vault-relative path. Omit to triage the whole vault.'),
```

without `completable()`, and remove the `completion/complete` block from the integration test (keep the two `prompts/get` blocks). Document the autocomplete loss in the commit message and in the docs section (Task 6) by removing the autocomplete sentence from the new bullet.

- [ ] **Step 6: Run the full test suite to confirm nothing else broke**

Run: `npm test`

Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add src/server/prompts.ts tests/integration/prompts.test.ts
git commit -m "feat(server/mcp): register /fix-broken-links prompt

Refs #305"
```

---

## Task 6: User-facing documentation

**Files:**
- Modify: `docs/help/en.md` (five spots: settings table row, Prompts intro, host-rendering example, Available prompts list, Autocomplete section)

- [ ] **Step 1: Bump the prompt count in the settings table**

In [`docs/help/en.md`](../../help/en.md), change the row at line 158:

Before:
```
| **Expose MCP slash-command prompts** | **on** | When on, MCP hosts surface canned vault workflows (`/summarize-note`, `/find-related`, `/expand-template`, `/daily-note`) as slash commands via the prompts surface. Restart the server to apply changes. See [Prompts](#prompts) below. |
```

After:
```
| **Expose MCP slash-command prompts** | **on** | When on, MCP hosts surface canned vault workflows (`/summarize-note`, `/find-related`, `/expand-template`, `/daily-note`, `/fix-broken-links`) as slash commands via the prompts surface. Restart the server to apply changes. See [Prompts](#prompts) below. |
```

- [ ] **Step 2: Bump the count in the Prompts section intro**

Line 312 currently reads:
```
In addition to tools and resources, the server exposes four canned **MCP prompts** so hosts surface them as slash commands. The user picks one, fills in the argument(s), and a pre-canned message lands in the conversation — no need to spell out the full tool sequence.
```

Change `four` to `five`.

- [ ] **Step 3: Add the new prompt to the host-rendering example**

Line 314 currently reads:
```
How the prompts appear depends on the host. Claude Code, for example, surfaces them as `/mcp__obsidian__summarize-note`, `/mcp__obsidian__find-related`, `/mcp__obsidian__expand-template`, and `/mcp__obsidian__daily-note`.
```

Change to:
```
How the prompts appear depends on the host. Claude Code, for example, surfaces them as `/mcp__obsidian__summarize-note`, `/mcp__obsidian__find-related`, `/mcp__obsidian__expand-template`, `/mcp__obsidian__daily-note`, and `/mcp__obsidian__fix-broken-links`.
```

- [ ] **Step 4: Add the new bullet under **Available prompts****

After the `daily-note` bullet (line 321), append a new bullet:

```
- **`fix-broken-links`** — argument: `path` (optional, vault-relative). Enumerates broken `[[wikilinks]]` via `search_unresolved_links` and walks Claude through fixing them — retarget to an existing note, create a stub, or delete the link. With `path`, scopes to that one source note; without, walks the whole vault (capped at ~20 source notes per run, re-run to continue). Each proposed edit lands as a separate tool call so you confirm or reject one at a time. Autocomplete on `path` lists vault notes that currently contain unresolved links.
```

(If the Task 5 fallback was used and `completable()` is not in play, drop the final sentence about autocomplete.)

- [ ] **Step 5: Extend the **Autocomplete** section**

Line 325 currently reads:
```
The `expand-template` prompt's `template` argument supports autocomplete: the server lists files in the vault's `templates/` folder and filters them by case-insensitive substring match (capped at 100 entries). Hosts that implement the MCP `completion/complete` protocol expose this as a dropdown next to the argument input.
```

Change to:
```
Two prompts support argument autocomplete:

- **`expand-template`** (`template`): the server lists files in the vault's `templates/` folder and filters them by case-insensitive substring match.
- **`fix-broken-links`** (`path`): the server lists vault notes that currently contain unresolved links (sourced from `search_unresolved_links`'s map keys) and filters them by case-insensitive substring match.

Both completers cap at 100 entries. Hosts that implement the MCP `completion/complete` protocol expose this as a dropdown next to the argument input.
```

(If the Task 5 fallback was used, leave the section unchanged and document the autocomplete loss in the new bullet's wording.)

- [ ] **Step 6: Verify the docs check passes**

Run: `npm run docs:check`

Expected: PASS — no new tools means no `docs/tools.generated.md` regeneration is needed; the check should be a no-op for our changes.

- [ ] **Step 7: Commit**

```bash
git add docs/help/en.md
git commit -m "docs(help): document /fix-broken-links prompt

Refs #305"
```

---

## Task 7: Final verification

Confirm lint, typecheck, and test all pass on the full surface — not just the changed files.

**Files:** none modified (verification only).

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: PASS — zero errors.

If errors surface (e.g. a stray `_args` left underscore-prefixed after Task 2, or an unused import), fix them in place and amend the most recent commit (`git commit --amend --no-edit` only if the fix is part of that commit's logical scope; otherwise create a new `chore:` or `style:` commit).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS — zero errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS — all suites green, including the new handler tests, completer tests, and the extended integration test.

- [ ] **Step 4: Inspect the commit log to confirm the working set**

Run: `git log --oneline -8`

Expected: Six commits on top of the spec commit (one per Task 1–6), all with `feat(server/prompts):`, `feat(server/mcp):`, `test(server/prompts):`, or `docs(help):` Conventional Commit prefixes, all referencing `Refs #305` in the body. The latest commit on `main` (one before the spec commit) should match the pre-branch `git log`.

---

## Task 8: Push and open the pull request

**Files:** none modified.

- [ ] **Step 1: Push the branch to the remote**

Run: `git push -u origin feat/issue-305-fix-broken-links-prompt`

Expected: Branch pushed, upstream set.

- [ ] **Step 2: Open the pull request**

Run:

```bash
gh pr create \
  --title "feat(server/mcp): /fix-broken-links prompt to triage unresolved links" \
  --body "$(cat <<'EOF'
Closes #305

## Summary

- Adds `/fix-broken-links` MCP prompt — the fifth and final prompt deferred from #293's candidate list.
- Optional `path` argument scopes the triage to a single source note; omitted, runs vault-wide with a soft cap of ~20 source notes per run.
- Autocomplete on `path` lists vault notes that currently contain unresolved links.
- Pure prompt orchestration over existing primitives (`search_unresolved_links`, `vault_read`, `vault_update`, `vault_create`, `editor_replace`, `search_fulltext`, `vault_list_recursive`). No new tool, no new adapter method.

## Test plan

- [x] `npm test` — handler (vault-wide, single-note, traversal-rejected), completer (empty, filter, cap, throw), integration (`prompts/list` includes the new entry, `prompts/get` returns each variant, `completion/complete` returns matching source paths).
- [x] `npm run lint`
- [x] `npm run typecheck`
- [ ] Manual smoke: enable the plugin in Obsidian, start the server, connect from Claude Code, run `/mcp__obsidian__fix-broken-links` with no argument and with a path. Confirm the seeded message appears.

## Spec & plan

- Spec: [`docs/superpowers/specs/2026-05-06-fix-broken-links-prompt-design.md`](docs/superpowers/specs/2026-05-06-fix-broken-links-prompt-design.md)
- Plan: [`docs/superpowers/plans/2026-05-06-fix-broken-links-prompt.md`](docs/superpowers/plans/2026-05-06-fix-broken-links-prompt.md)
EOF
)"
```

Expected: PR URL printed. Inspect the PR on GitHub to confirm CI runs.

- [ ] **Step 3: Wait for the user to merge**

Per project rules — never merge a PR yourself.

---

## Self-review

**Spec coverage check:**

| Spec section / requirement                                              | Implementing task                          |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| Register `/fix-broken-links` prompt                                     | Task 5                                     |
| Optional string argument `path`                                         | Tasks 2, 5                                 |
| Vault-wide body                                                         | Task 1                                     |
| Single-note body                                                        | Task 2                                     |
| Per-fix confirmation wording (`one at a time`, `propose **one** fix`)   | Task 1, 2 (asserted in test)               |
| Soft cap ~20                                                            | Task 1 (asserted in test)                  |
| Single-note empty case ("not in result, stop")                          | Task 2 (asserted in test)                  |
| `completable()` autocomplete on `path`                                  | Task 5 (with fallback path)                |
| Completer source: `Object.keys(adapter.getUnresolvedLinks())`           | Task 4                                     |
| Completer cap 100                                                       | Task 4 (asserted in test)                  |
| Path validation only when `args.path !== undefined`                     | Task 3                                     |
| Handler tests (vault-wide, single-note, traversal)                      | Tasks 1, 2, 3                              |
| Completer tests (empty, filter, cap, throw)                             | Task 4                                     |
| Integration test (list, get-vault-wide, get-single, completion)         | Task 5                                     |
| `docs/help/en.md` updates (settings row, intro, example, bullet, autocomplete) | Task 6                                |
| No `docs/tools.generated.md` change                                     | Task 6 Step 6 (verifies via `docs:check`)  |
| Lint / typecheck / test green                                           | Task 7                                     |
| Push + PR                                                               | Task 8                                     |

All spec requirements have an implementing task.

**Placeholder scan:**
- No "TBD" / "TODO" / "implement later" tokens.
- All test code is concrete.
- All commands are runnable as written (no placeholder pipes / values).
- Task 5 Step 5 includes a written-out fallback path — not a deferred decision.

**Type consistency:**
- `createFixBrokenLinksHandler(adapter)` signature is established in Task 1 and used unchanged in Task 5.
- `createUnresolvedSourcesCompleter(adapter)` signature is established in Task 4 and used unchanged in Task 5.
- `FixBrokenLinksArgs` interface (`{ path?: string }`) is consistent across all tasks.
- `FIX_BROKEN_LINKS_VAULT_WIDE_BODY` (constant) and `fixBrokenLinksSingleNoteBody(path)` (function) are consistently named where referenced.
- `COMPLETER_RESULT_LIMIT` is a pre-existing constant in [`src/server/prompts.ts`](../../../src/server/prompts.ts) and reused in Task 4 — verified by reading the file (line 81).
