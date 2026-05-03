# MCP Prompts (Slash Commands) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose three canned MCP prompts (`/summarize-note`, `/find-related`, `/expand-template`) as a `prompts: {}` capability so MCP hosts surface them as slash commands.

**Architecture:** A new `src/server/prompts.ts` registers three prompts on the `McpServer`. It owns the placeholder extractor, the per-prompt argument schemas, the handlers, and a `templateCompleter` closure that powers autocomplete on `/expand-template`'s `template` argument. Wiring into `createMcpServer` is gated by a new `promptsEnabled` settings flag (default on, with a v11→v12 migration). Tools and resources surfaces unchanged.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (`registerPrompt`, `completable`), Vitest, Zod, Obsidian plugin API.

**Spec:** [`docs/superpowers/specs/2026-05-03-mcp-prompts-slash-commands-design.md`](../specs/2026-05-03-mcp-prompts-slash-commands-design.md)

**Branch:** `feat/issue-293-mcp-prompts-slash-commands` (already created)

**Issue:** #293

---

## File Structure

### Created

- `src/server/prompts.ts` — exports `registerPrompts(server, adapter, logger)`. Contains:
  - `extractPlaceholders(body: string): string[]` — pure helper, scans for `{{name}}` placeholders, dedupes, strips built-ins (`date`, `time`, `title`).
  - `createSummarizeNoteHandler(adapter)` — returns the prompt handler for `summarize-note`.
  - `createFindRelatedHandler(adapter)` — returns the prompt handler for `find-related`.
  - `createExpandTemplateHandler(adapter)` — returns the prompt handler for `expand-template`.
  - `createTemplateCompleter(adapter)` — returns the autocomplete callback for the `template` argument.
  - `registerPrompts(server, adapter, logger)` — wires the three handlers into `server.registerPrompt(...)`.
- `tests/server/prompts.test.ts` — unit tests against a mock adapter for `extractPlaceholders`, all three handlers, the completer, and helper edge cases.
- `tests/integration/prompts.test.ts` — end-to-end smoke through the in-memory MCP transport covering `prompts/list`, `prompts/get`, and `completion/complete`.

### Modified

- `src/types.ts` — add `promptsEnabled: boolean` to `McpPluginSettings`; default `true` in `DEFAULT_SETTINGS`; bump `schemaVersion` default to `12`.
- `src/settings/migrations.ts` — add `migrateV11ToV12` hop, append it to `HOPS`, bump `CURRENT_SCHEMA_VERSION` to `12`.
- `tests/settings/migrations.test.ts` — import `migrateV11ToV12`, add per-hop tests, add a v11 → v12 chain test.
- `tests/types.test.ts` — bump the `schemaVersion: 11` assertion to `12`.
- `tests/utils/debug-info.test.ts` — bump the `schemaVersion: 11` fixture to `12`; add `promptsEnabled: true`.
- `tests/settings.test.ts` — bump every `expect(result.schemaVersion).toBe(11)` to `12`.
- `src/server/mcp-server.ts` — declare `prompts: {}` capability iff `settings.promptsEnabled`; call `registerPrompts(server, adapter, logger)` after `registerResources`.
- `tests/server/mcp-server.test.ts` — capture `registerPrompt` calls on the fake `McpServer`; add tests for `promptsEnabled` toggle gating; add a `prompts?` field to `CapturedOptions`.
- `src/settings/server-section.ts` — one new toggle bound to `promptsEnabled`, sibling to the `resourcesEnabled` toggle.
- `src/lang/locale/en.ts` — strings for the toggle (`setting_prompts_enabled_name`, `setting_prompts_enabled_desc`).
- `src/lang/locale/de.ts` — strings for the toggle (German).
- `docs/help/en.md` — add a Prompts section under the existing Resources section, plus a row in the Server Settings table.

### Not modified

- `docs/tools.generated.md` — unaffected (prompts are not tools). Verified by running `npm run docs:tools` at the end and confirming a clean diff.

---

## Task 1: Add `promptsEnabled` to settings types and defaults

**Files:**
- Modify: `src/types.ts:25-32` (add field), `src/types.ts:101-123` (DEFAULT_SETTINGS)

- [ ] **Step 1: Verify the baseline test is green**

Run:
```bash
npx vitest run tests/types.test.ts
```

Expected: PASS.

- [ ] **Step 2: Update `tests/types.test.ts` to assert v12 + `promptsEnabled: true`**

Open `tests/types.test.ts`. Find the line `expect(DEFAULT_SETTINGS.schemaVersion).toBe(11);` (around line 26) and change to:

```ts
expect(DEFAULT_SETTINGS.schemaVersion).toBe(12);
```

Then add a new assertion right below it:

```ts
expect(DEFAULT_SETTINGS.promptsEnabled).toBe(true);
```

- [ ] **Step 3: Run tests; expect failure**

Run:
```bash
npx vitest run tests/types.test.ts
```

Expected: FAIL — `Expected: 12, Received: 11`.

- [ ] **Step 4: Add the field to the interface**

In `src/types.ts`, after the existing `resourcesEnabled` JSDoc + field (around line 26-31), add:

```ts
  /**
   * When true, the server exposes canned slash-command prompts via the
   * MCP prompts surface (`/summarize-note`, `/find-related`,
   * `/expand-template`). Default true.
   */
  promptsEnabled: boolean;
```

In `DEFAULT_SETTINGS` (around line 101-123), bump `schemaVersion: 11` to `schemaVersion: 12` and add `promptsEnabled: true,` next to `resourcesEnabled: true,`:

```ts
export const DEFAULT_SETTINGS: McpPluginSettings = {
  schemaVersion: 12,
  // ... rest unchanged ...
  resourcesEnabled: true,
  promptsEnabled: true,
  // ... rest unchanged ...
};
```

- [ ] **Step 5: Run tests; expect pass**

Run:
```bash
npx vitest run tests/types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "$(cat <<'EOF'
feat(types): add promptsEnabled flag and bump schemaVersion to 12

Adds the settings field that gates the new MCP prompts surface; default
true, parallel to resourcesEnabled. Schema version bumped so existing
installs can be migrated in the next step.

Refs #293
EOF
)"
```

---

## Task 2: Add `migrateV11ToV12` migration hop

**Files:**
- Modify: `src/settings/migrations.ts:134-156`
- Modify: `tests/settings/migrations.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/settings/migrations.test.ts`, update the import block at the top to include `migrateV11ToV12`:

```ts
import {
  migrateV0ToV1,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
  migrateV10ToV11,
  migrateV11ToV12,
  migrateSettings,
  CURRENT_SCHEMA_VERSION,
} from '../../src/settings/migrations';
```

Then, after the existing `describe('migrateV10ToV11', ...)` block (around line 240-258), add:

```ts
describe('migrateV11ToV12', () => {
  it('sets promptsEnabled: true for installs without the field', () => {
    const data = {} as Record<string, unknown>;
    migrateV11ToV12(data);
    expect(data.promptsEnabled).toBe(true);
  });

  it('preserves an explicit false', () => {
    const data = { promptsEnabled: false } as Record<string, unknown>;
    migrateV11ToV12(data);
    expect(data.promptsEnabled).toBe(false);
  });

  it('preserves an explicit true', () => {
    const data = { promptsEnabled: true } as Record<string, unknown>;
    migrateV11ToV12(data);
    expect(data.promptsEnabled).toBe(true);
  });
});
```

Also add a chain test inside the existing `describe('migrateSettings — composition', ...)` block (after the v10→v11 chain test, around line 287-294):

```ts
it('migrates a v11 install to v12 with promptsEnabled defaulted on', () => {
  const result = migrateSettings({ schemaVersion: 11 }) as {
    schemaVersion: number;
    promptsEnabled: boolean;
  };
  expect(result.schemaVersion).toBe(12);
  expect(result.promptsEnabled).toBe(true);
});
```

- [ ] **Step 2: Run tests; expect failure**

Run:
```bash
npx vitest run tests/settings/migrations.test.ts
```

Expected: FAIL — `migrateV11ToV12 is not a function` (export missing).

- [ ] **Step 3: Add the migration hop**

In `src/settings/migrations.ts`, after the existing `migrateV10ToV11` function (around line 134-139), add:

```ts
export function migrateV11ToV12(data: Settings): void {
  // Default the new prompts surface on for existing installs. They can
  // disable it in Server Settings if they prefer to skip the
  // slash-command prompts. See
  // docs/superpowers/specs/2026-05-03-mcp-prompts-slash-commands-design.md.
  if (data.promptsEnabled === undefined) data.promptsEnabled = true;
}
```

In the `HOPS` array (around line 141-153), append:

```ts
  { target: 12, run: migrateV11ToV12 },
```

Bump `CURRENT_SCHEMA_VERSION`:

```ts
export const CURRENT_SCHEMA_VERSION = 12;
```

- [ ] **Step 4: Run tests; expect pass**

Run:
```bash
npx vitest run tests/settings/migrations.test.ts
```

Expected: PASS — all the new tests AND every existing chain test (which uses `CURRENT_SCHEMA_VERSION`) still passes.

- [ ] **Step 5: Update `tests/settings.test.ts` to expect v12**

`tests/settings.test.ts` has many `expect(result.schemaVersion).toBe(11)` assertions. Replace ALL of them with `12`:

```bash
sed -i 's/expect(result.schemaVersion).toBe(11)/expect(result.schemaVersion).toBe(12)/g' tests/settings.test.ts
```

(If `sed -i` differs on macOS, use `sed -i ''` instead.)

- [ ] **Step 6: Update `tests/utils/debug-info.test.ts` fixture**

Open `tests/utils/debug-info.test.ts`. Around line 69 the fixture has `schemaVersion: 11,`. Change to `schemaVersion: 12,` and add `promptsEnabled: true,` right after `resourcesEnabled: true,` (line 81):

```ts
  resourcesEnabled: true,
  promptsEnabled: true,
```

- [ ] **Step 7: Run the affected suites**

Run:
```bash
npx vitest run tests/settings.test.ts tests/utils/debug-info.test.ts tests/settings/migrations.test.ts
```

Expected: PASS for all three.

- [ ] **Step 8: Run the full test suite to catch any other v11 fixtures**

Run:
```bash
npm test
```

Expected: PASS. If anything else asserts `schemaVersion: 11` (e.g. another fixture), update it the same way and re-run.

- [ ] **Step 9: Commit**

```bash
git add src/settings/migrations.ts tests/settings/migrations.test.ts tests/settings.test.ts tests/utils/debug-info.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): add v11→v12 migration enabling prompts surface

Defaults promptsEnabled to true for existing installs; parallels the
v10→v11 hop that introduced the resources surface.

Refs #293
EOF
)"
```

---

## Task 3: Add locale strings for the new toggle

**Files:**
- Modify: `src/lang/locale/en.ts:80-85`
- Modify: `src/lang/locale/de.ts:79-84`

- [ ] **Step 1: Add English strings**

Open `src/lang/locale/en.ts`. After the existing `setting_resources_enabled_desc` string (around line 83-84), add:

```ts
  setting_prompts_enabled_name: 'Expose MCP slash-command prompts',
  setting_prompts_enabled_desc:
    'When on, MCP hosts can run canned vault workflows (/summarize-note, /find-related, /expand-template) via the prompts surface. Restart the server to apply changes.',
```

- [ ] **Step 2: Add German strings**

Open `src/lang/locale/de.ts`. After the existing `setting_resources_enabled_desc` string (around line 82-83), add:

```ts
  setting_prompts_enabled_name: 'MCP-Slash-Befehle freigeben',
  setting_prompts_enabled_desc:
    'Wenn aktiviert, können MCP-Hosts vorgefertigte Vault-Abläufe (/summarize-note, /find-related, /expand-template) über die Prompts-Schnittstelle ausführen. Server neu starten, damit die Änderung wirksam wird.',
```

- [ ] **Step 3: Type-check the locale files**

Run:
```bash
npm run typecheck
```

Expected: PASS. (German is `Partial<typeof en>`, so the new keys must exist in `en.ts` first — which they do as of step 1.)

- [ ] **Step 4: Commit**

```bash
git add src/lang/locale/en.ts src/lang/locale/de.ts
git commit -m "$(cat <<'EOF'
feat(lang): add prompts surface toggle strings (en, de)

Refs #293
EOF
)"
```

---

## Task 4: Implement `extractPlaceholders` (TDD)

**Files:**
- Create: `src/server/prompts.ts`
- Create: `tests/server/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/server/prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractPlaceholders } from '../../src/server/prompts';

describe('extractPlaceholders', () => {
  it('returns [] for an empty body', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });

  it('returns [] when no placeholders are present', () => {
    expect(extractPlaceholders('# Hello world\n\nNo placeholders here.')).toEqual([]);
  });

  it('extracts a single placeholder', () => {
    expect(extractPlaceholders('# {{name}}')).toEqual(['name']);
  });

  it('dedupes repeated placeholders, preserving first-seen order', () => {
    expect(extractPlaceholders('{{a}}{{a}}{{b}}{{a}}')).toEqual(['a', 'b']);
  });

  it('preserves first-seen order across distinct placeholders', () => {
    expect(extractPlaceholders('{{b}} then {{a}} then {{c}}')).toEqual(['b', 'a', 'c']);
  });

  it('strips the built-ins date, time, title that template_expand auto-resolves', () => {
    expect(extractPlaceholders('{{date}} {{title}} {{author}} {{time}}')).toEqual(['author']);
  });

  it('does not match placeholders with whitespace inside the braces', () => {
    expect(extractPlaceholders('{{ name }}')).toEqual([]);
  });

  it('does not match unbalanced or empty braces', () => {
    expect(extractPlaceholders('{{name')).toEqual([]);
    expect(extractPlaceholders('{{}}')).toEqual([]);
    expect(extractPlaceholders('{name}')).toEqual([]);
  });

  it('matches identifier-style names (letters, digits, underscore; must start with letter or underscore)', () => {
    expect(extractPlaceholders('{{a1}} {{_b}} {{c_d}}')).toEqual(['a1', '_b', 'c_d']);
    // leading digit is invalid
    expect(extractPlaceholders('{{1foo}}')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/server/prompts.test.ts
```

Expected: FAIL — `Cannot find module '../../src/server/prompts'`.

- [ ] **Step 3: Create the file with `extractPlaceholders` only**

Create `src/server/prompts.ts`:

```ts
const TEMPLATE_BUILTIN_PLACEHOLDERS = new Set(['date', 'time', 'title']);

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/**
 * Scan a template body for `{{name}}` placeholders. Dedupes (preserving
 * first-seen order) and filters out the built-ins (`date`, `time`,
 * `title`) that the existing `template_expand` tool auto-resolves so the
 * `/expand-template` prompt only asks the user for placeholders that
 * actually need a value.
 */
export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (TEMPLATE_BUILTIN_PLACEHOLDERS.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
```

- [ ] **Step 4: Run tests; expect pass**

Run:
```bash
npx vitest run tests/server/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts.ts tests/server/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(server/prompts): add extractPlaceholders helper

Pure helper used by the upcoming /expand-template prompt to enumerate
the placeholders a user actually needs to fill in (built-ins date/time/
title are stripped because template_expand resolves them automatically).

Refs #293
EOF
)"
```

---

## Task 5: Implement `summarize-note` and `find-related` handlers (TDD)

**Files:**
- Modify: `src/server/prompts.ts`
- Modify: `tests/server/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/prompts.test.ts`:

```ts
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { PathTraversalError } from '../../src/utils/path-guard';
import {
  createSummarizeNoteHandler,
  createFindRelatedHandler,
} from '../../src/server/prompts';

describe('summarize-note handler', () => {
  it('returns a single user-role text message naming vault_read and the path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createSummarizeNoteHandler(adapter);

    const result = await handler({ path: 'notes/foo.md' });

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = (message.content as { type: 'text'; text: string }).text;
    expect(text).toContain('notes/foo.md');
    expect(text).toContain('vault_read');
  });

  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createSummarizeNoteHandler(adapter);

    await expect(handler({ path: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
});

describe('find-related handler', () => {
  it('returns a single user-role text message naming search_fulltext and vault_get_backlinks', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFindRelatedHandler(adapter);

    const result = await handler({ path: 'notes/foo.md' });

    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message.role).toBe('user');
    expect(message.content.type).toBe('text');
    const text = (message.content as { type: 'text'; text: string }).text;
    expect(text).toContain('notes/foo.md');
    expect(text).toContain('search_fulltext');
    expect(text).toContain('vault_get_backlinks');
  });

  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createFindRelatedHandler(adapter);

    await expect(handler({ path: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

Run:
```bash
npx vitest run tests/server/prompts.test.ts
```

Expected: FAIL — `createSummarizeNoteHandler is not exported`.

- [ ] **Step 3: Implement the two handlers**

In `src/server/prompts.ts`, append:

```ts
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ObsidianAdapter } from '../obsidian/adapter';
import { validateVaultPath } from '../utils/path-guard';

interface PathArgs {
  path: string;
}

function userTextMessage(text: string): GetPromptResult {
  return {
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
}

export function createSummarizeNoteHandler(
  adapter: ObsidianAdapter,
): (args: PathArgs) => Promise<GetPromptResult> {
  // async so a synchronous throw from validateVaultPath surfaces as a
  // rejected promise rather than a synchronous throw at the call site.
  return async (args) => {
    const path = validateVaultPath(args.path, adapter.getVaultPath());
    return userTextMessage(
      `Summarize the note at \`${path}\`. First call \`vault_read\` to fetch its contents, then produce a concise summary covering the main points and any actionable items.`,
    );
  };
}

export function createFindRelatedHandler(
  adapter: ObsidianAdapter,
): (args: PathArgs) => Promise<GetPromptResult> {
  return async (args) => {
    const path = validateVaultPath(args.path, adapter.getVaultPath());
    return userTextMessage(
      `Find notes related to \`${path}\`. First read it with \`vault_read\`, then run \`search_fulltext\` on its key terms and \`vault_get_backlinks\` on its path. Cross-reference the results and report the most relevant connections.`,
    );
  };
}
```

Move the existing `import` lines (if any) to the top so all imports are grouped. The final import block at the top of `src/server/prompts.ts` should look like:

```ts
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ObsidianAdapter } from '../obsidian/adapter';
import { validateVaultPath } from '../utils/path-guard';
```

- [ ] **Step 4: Run tests; expect pass**

Run:
```bash
npx vitest run tests/server/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts.ts tests/server/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(server/prompts): add summarize-note and find-related handlers

Both prompts return a single user-role text message that names the tools
Claude should drive (vault_read, search_fulltext, vault_get_backlinks).
Path arguments are validated through validateVaultPath so traversal
attempts surface as a clean prompts/get error.

Refs #293
EOF
)"
```

---

## Task 6: Implement `expand-template` handler and `templateCompleter` (TDD)

**Files:**
- Modify: `src/server/prompts.ts`
- Modify: `tests/server/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/prompts.test.ts`:

```ts
import {
  createExpandTemplateHandler,
  createTemplateCompleter,
} from '../../src/server/prompts';

describe('expand-template handler', () => {
  it('lists user-fillable placeholders from a template', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/weekly.md', '# {{title}} for {{week}}\n\n{{notes}}');
    const handler = createExpandTemplateHandler(adapter);

    const result = await handler({ template: 'templates/weekly.md' });

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text).toContain('templates/weekly.md');
    expect(text).toContain('week');
    expect(text).toContain('notes');
    // built-in `title` must not be listed as a user-fillable placeholder
    expect(text).not.toMatch(/placeholders[^.]*title/);
    expect(text).toContain('template_expand');
    expect(text).toContain('template_create_from');
  });

  it('handles templates with only built-ins by saying there are no user-fillable placeholders', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/today.md', '{{date}} {{time}}');
    const handler = createExpandTemplateHandler(adapter);

    const result = await handler({ template: 'templates/today.md' });

    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    expect(text.toLowerCase()).toContain('no user-fillable placeholders');
  });

  it('dedupes placeholders mentioned multiple times', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/dup.md', '{{a}}{{a}}{{b}}');
    const handler = createExpandTemplateHandler(adapter);

    const result = await handler({ template: 'templates/dup.md' });

    const text = (result.messages[0].content as { type: 'text'; text: string }).text;
    // Look for the placeholders list "a, b" (with no extra "a")
    expect(text).toMatch(/`a, b`/);
  });

  it('propagates FileNotFoundError when the template is missing', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    const handler = createExpandTemplateHandler(adapter);

    // MockObsidianAdapter.readFile throws plain Error on missing files.
    // The handler shouldn't transform the error; the SDK maps whatever
    // throws into a prompts/get error response. We assert the throw, not
    // the type, because the real adapter may throw FileNotFoundError
    // while the mock throws plain Error — both surface as errors to MCP.
    await expect(handler({ template: 'templates/missing.md' })).rejects.toThrow();
  });

  it('throws PathTraversalError on a traversal path', async () => {
    const adapter = new MockObsidianAdapter();
    const handler = createExpandTemplateHandler(adapter);

    await expect(handler({ template: '../etc/passwd' })).rejects.toThrow(PathTraversalError);
  });
});

describe('templateCompleter', () => {
  it('returns up to 100 entries from templates/ for an empty partial', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    for (let i = 0; i < 150; i++) {
      adapter.addFile(`templates/t${String(i)}.md`, `body ${String(i)}`);
    }
    const completer = createTemplateCompleter(adapter);

    const result = await completer('');

    expect(result.length).toBe(100);
  });

  it('filters by case-insensitive substring match', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/Weekly.md', '');
    adapter.addFile('templates/Daily.md', '');
    adapter.addFile('templates/Monthly.md', '');
    const completer = createTemplateCompleter(adapter);

    const result = await completer('weEK');

    expect(result).toEqual(['templates/Weekly.md']);
  });

  it('returns [] when the templates folder is missing (no throw)', async () => {
    const adapter = new MockObsidianAdapter();
    // No `templates` folder added.
    const completer = createTemplateCompleter(adapter);

    const result = await completer('anything');

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

Run:
```bash
npx vitest run tests/server/prompts.test.ts
```

Expected: FAIL — `createExpandTemplateHandler is not exported`.

- [ ] **Step 3: Implement the handler and completer**

The imports at the top of `src/server/prompts.ts` stay the same as after Task 5 — no new imports for this task. (The `completable` and `z` imports are added in Task 7 when `registerPrompts` actually uses them; introducing them here would trip the unused-import lint rule.)

Append the new code to `src/server/prompts.ts`:

```ts
interface TemplateArgs {
  template: string;
}

const TEMPLATES_FOLDER = 'templates';
const COMPLETER_RESULT_LIMIT = 100;

export function createExpandTemplateHandler(
  adapter: ObsidianAdapter,
): (args: TemplateArgs) => Promise<GetPromptResult> {
  return async (args) => {
    const template = validateVaultPath(args.template, adapter.getVaultPath());
    const body = await adapter.readFile(template);
    const placeholders = extractPlaceholders(body);
    const text = placeholders.length === 0
      ? `Expand the template at \`${template}\`. It has no user-fillable placeholders — call \`template_expand\` directly with the template body.`
      : `Expand the template at \`${template}\`. It contains these placeholders: \`${placeholders.join(', ')}\`. Ask the user for values for each placeholder, then call \`template_expand\` with the template body and the variables. If the user wants the result written to a new note, use \`template_create_from\` instead.`;
    return userTextMessage(text);
  };
}

export function createTemplateCompleter(
  adapter: ObsidianAdapter,
): (partial: string) => Promise<string[]> {
  return async (partial) => {
    try {
      const list = adapter.list(TEMPLATES_FOLDER);
      const needle = partial.toLowerCase();
      return list.files
        .filter((p) => p.toLowerCase().includes(needle))
        .slice(0, COMPLETER_RESULT_LIMIT);
    } catch {
      return [];
    }
  };
}
```

- [ ] **Step 4: Run tests; expect pass**

Run:
```bash
npx vitest run tests/server/prompts.test.ts
```

Expected: PASS — every test in this file (including those from Tasks 4 and 5).

- [ ] **Step 5: Run lint to check for unused imports**

Run:
```bash
npm run lint
```

Expected: PASS. If lint complains about unused imports, remove them.

- [ ] **Step 6: Commit**

```bash
git add src/server/prompts.ts tests/server/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(server/prompts): add expand-template handler and template completer

The handler reads the template, surfaces user-fillable placeholders, and
seeds a message instructing Claude to collect values and call
template_expand or template_create_from. The completer powers
autocomplete on the template argument by listing the vault's templates
folder (substring match, capped at 100 entries).

Refs #293
EOF
)"
```

---

## Task 7: Implement `registerPrompts(...)` entry point

**Files:**
- Modify: `src/server/prompts.ts`

- [ ] **Step 1: Add the entry point**

Update the top of `src/server/prompts.ts` to add the missing imports:

```ts
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { z } from 'zod';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { Logger } from '../utils/logger';
import { validateVaultPath } from '../utils/path-guard';
```

At the bottom of the file, append:

```ts
export function registerPrompts(
  server: McpServer,
  adapter: ObsidianAdapter,
  logger: Logger,
): void {
  const summarize = createSummarizeNoteHandler(adapter);
  const findRelated = createFindRelatedHandler(adapter);
  const expand = createExpandTemplateHandler(adapter);
  const templateCompleter = createTemplateCompleter(adapter);

  logger.debug('Registering prompt: summarize-note');
  server.registerPrompt(
    'summarize-note',
    {
      title: 'Summarize a vault note',
      description: 'Read a note and produce a concise summary covering its main points and any actionable items.',
      argsSchema: {
        path: z.string().min(1).describe('Vault-relative path to the note to summarize'),
      },
    },
    (args: { path: string }) => summarize(args),
  );

  logger.debug('Registering prompt: find-related');
  server.registerPrompt(
    'find-related',
    {
      title: 'Find notes related to a given note',
      description: "Cross-reference a note's content against the vault to surface related material.",
      argsSchema: {
        path: z.string().min(1).describe('Vault-relative path to the seed note'),
      },
    },
    (args: { path: string }) => findRelated(args),
  );

  logger.debug('Registering prompt: expand-template');
  server.registerPrompt(
    'expand-template',
    {
      title: 'Expand a vault template',
      description: 'Discover the placeholders in a template and walk through filling them in.',
      argsSchema: {
        template: completable(
          z.string().min(1).describe('Vault-relative path to the template file'),
          (value) => templateCompleter(value),
        ),
      },
    },
    (args: { template: string }) => expand(args),
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run typecheck
```

Expected: PASS. If the SDK requires `extras` in the prompt callback signature, check
`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` for the exact
signature of `registerPrompt` and adapt — the most likely fix is to ignore the
extra parameter (`(args, _extra) => …`).

- [ ] **Step 3: Run prompts test suite (sanity)**

Run:
```bash
npx vitest run tests/server/prompts.test.ts
```

Expected: PASS — the new function is not yet wired in `mcp-server.ts`, but its existence shouldn't break the existing handler tests.

- [ ] **Step 4: Run lint**

Run:
```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts.ts
git commit -m "$(cat <<'EOF'
feat(server/prompts): add registerPrompts entry point

Wires the three prompt handlers and the template completer into McpServer
via server.registerPrompt(...) calls. completable() supplies autocomplete
for the expand-template prompt's template argument; the other two
prompts (summarize-note, find-related) take a plain string path.

Refs #293
EOF
)"
```

---

## Task 8: Wire `registerPrompts` into `createMcpServer` (TDD)

**Files:**
- Modify: `src/server/mcp-server.ts`
- Modify: `tests/server/mcp-server.test.ts`

- [ ] **Step 1: Update `tests/server/mcp-server.test.ts` to capture `registerPrompt` calls**

Open `tests/server/mcp-server.test.ts`. Update `CapturedOptions`:

```ts
interface CapturedOptions {
  capabilities?: {
    tools?: unknown;
    logging?: unknown;
    resources?: unknown;
    prompts?: unknown;
  };
  instructions?: string;
}
```

Add a sibling type for prompt capture:

```ts
interface CapturedRegisterPromptCall {
  name: string;
  config: Record<string, unknown>;
}
```

Add a module-level captured array:

```ts
const capturedRegisterPromptCalls: CapturedRegisterPromptCall[] = [];
```

Inside the `vi.mock('@modelcontextprotocol/sdk/server/mcp.js', ...)` block's `FakeMcpServer` class (around line 49-67), add a new method:

```ts
registerPrompt(name: string, config: Record<string, unknown>): void {
  capturedRegisterPromptCalls.push({ name, config });
}
```

In the `beforeEach` (around line 75-79), add:

```ts
capturedRegisterPromptCalls.length = 0;
```

After the existing two resources tests (around line 228-255), add:

```ts
it('declares the prompts capability and registers all three prompts when promptsEnabled', async () => {
  const { createMcpServer } = await import('../../src/server/mcp-server');
  const registry = new ModuleRegistry(makeLogger());
  const adapter = new MockObsidianAdapter();
  const settings = { ...DEFAULT_SETTINGS, promptsEnabled: true };

  createMcpServer(registry, adapter, settings, makeLogger());

  const caps = capturedConstructorArgs[0].options.capabilities;
  expect(caps).toMatchObject({ prompts: {} });
  expect(capturedRegisterPromptCalls.map((c) => c.name)).toEqual([
    'summarize-note',
    'find-related',
    'expand-template',
  ]);
});

it('omits the prompts capability and skips registration when promptsEnabled is false', async () => {
  const { createMcpServer } = await import('../../src/server/mcp-server');
  const registry = new ModuleRegistry(makeLogger());
  const adapter = new MockObsidianAdapter();
  const settings = { ...DEFAULT_SETTINGS, promptsEnabled: false };

  createMcpServer(registry, adapter, settings, makeLogger());

  const caps = capturedConstructorArgs[0].options.capabilities;
  expect(caps).not.toHaveProperty('prompts');
  expect(capturedRegisterPromptCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run mcp-server tests; expect failure**

Run:
```bash
npx vitest run tests/server/mcp-server.test.ts
```

Expected: FAIL — both new tests fail because `mcp-server.ts` doesn't yet declare prompts capability or call `registerPrompts`.

- [ ] **Step 3: Wire `registerPrompts` into `createMcpServer`**

Open `src/server/mcp-server.ts`.

Update the imports near the top to add the new function:

```ts
import { registerPrompts } from './prompts';
```

Update the `capabilities` type and population block (around line 34-44):

```ts
const capabilities: {
  tools: Record<string, never>;
  logging: Record<string, never>;
  resources?: Record<string, never>;
  prompts?: Record<string, never>;
} = {
  tools: {},
  logging: {},
};
if (settings.resourcesEnabled) {
  capabilities.resources = {};
}
if (settings.promptsEnabled) {
  capabilities.prompts = {};
}
```

After the existing `if (settings.resourcesEnabled) { registerResources(...); }` block (around line 61-63), add:

```ts
if (settings.promptsEnabled) {
  registerPrompts(server, adapter, logger);
}
```

- [ ] **Step 4: Run mcp-server tests; expect pass**

Run:
```bash
npx vitest run tests/server/mcp-server.test.ts
```

Expected: PASS — both new tests pass.

- [ ] **Step 5: Run the full test suite**

Run:
```bash
npm test
```

Expected: PASS — all suites green.

- [ ] **Step 6: Commit**

```bash
git add src/server/mcp-server.ts tests/server/mcp-server.test.ts
git commit -m "$(cat <<'EOF'
feat(server/mcp): wire prompts capability into createMcpServer

Declares prompts: {} on the McpServer constructor and calls
registerPrompts after registerResources when settings.promptsEnabled is
on. Both gating tests assert the capability is present iff the toggle is
on and absent otherwise.

Refs #293
EOF
)"
```

---

## Task 9: Add an end-to-end SDK transport smoke test

**Files:**
- Create: `tests/integration/prompts.test.ts`

- [ ] **Step 1: Write the smoke test**

Create `tests/integration/prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

describe('prompts surface — end-to-end', () => {
  it('lists all three prompts and serves prompts/get + completion/complete via the SDK transport', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFolder('templates');
    adapter.addFile('templates/weekly.md', '# {{week}}\n\n{{notes}}');
    const logger = new Logger('test', { debugMode: false, accessKey: '' });
    const registry = new ModuleRegistry(logger);
    const server = createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client(
      { name: 'test', version: '0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    // prompts/list
    const list = await client.listPrompts();
    expect(list.prompts.map((p) => p.name).sort()).toEqual([
      'expand-template',
      'find-related',
      'summarize-note',
    ]);

    // prompts/get for /summarize-note
    const summarize = await client.getPrompt({
      name: 'summarize-note',
      arguments: { path: 'notes/foo.md' },
    });
    expect(summarize.messages).toHaveLength(1);
    const sumText = (summarize.messages[0].content as { type: 'text'; text: string }).text;
    expect(sumText).toContain('notes/foo.md');
    expect(sumText).toContain('vault_read');

    // prompts/get for /expand-template (placeholder discovery in the message)
    const expand = await client.getPrompt({
      name: 'expand-template',
      arguments: { template: 'templates/weekly.md' },
    });
    const expText = (expand.messages[0].content as { type: 'text'; text: string }).text;
    expect(expText).toContain('week');
    expect(expText).toContain('notes');

    // completion/complete for /expand-template's `template` argument
    const completion = await client.complete({
      ref: { type: 'ref/prompt', name: 'expand-template' },
      argument: { name: 'template', value: 'week' },
    });
    expect(completion.completion.values).toContain('templates/weekly.md');

    await client.close();
    await server.close();
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run:
```bash
npx vitest run tests/integration/prompts.test.ts
```

Expected: PASS. If `client.complete` rejects with "method not found", check that the SDK version supports the `complete` request and that `completable()` was correctly attached. The MCP SDK ≥ 1.x supports it; if you find a version mismatch, file a follow-up to upgrade rather than working around it.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/prompts.test.ts
git commit -m "$(cat <<'EOF'
test(server/prompts): end-to-end smoke through SDK transport

Drives prompts/list, prompts/get for two of the three prompts, and
completion/complete for the expand-template argument over the
in-memory MCP transport. Confirms the SDK wiring is functional, not
just the handler-level unit tests.

Refs #293
EOF
)"
```

---

## Task 10: Add the settings UI toggle

**Files:**
- Modify: `src/settings/server-section.ts:290-298`

- [ ] **Step 1: Add the toggle next to the resources toggle**

Open `src/settings/server-section.ts`. After the existing `setting_resources_enabled_*` `new Setting(containerEl)` block (around line 290-298), add:

```ts
  new Setting(containerEl)
    .setName(t('setting_prompts_enabled_name'))
    .setDesc(t('setting_prompts_enabled_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.promptsEnabled).onChange(async (value) => {
        plugin.settings.promptsEnabled = value;
        await plugin.saveSettings();
      }),
    );
```

- [ ] **Step 2: Type-check**

Run:
```bash
npm run typecheck
```

Expected: PASS — the locale keys were added in Task 3 and the field was added in Task 1.

- [ ] **Step 3: Run lint**

Run:
```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/settings/server-section.ts
git commit -m "$(cat <<'EOF'
feat(settings/server): add toggle for prompts surface

One sibling toggle to the resources toggle. Bound to settings.
promptsEnabled, calls saveSettings on change. Server restart required to
apply (same UX as the resources toggle).

Refs #293
EOF
)"
```

---

## Task 11: Document the prompts surface in the user manual

**Files:**
- Modify: `docs/help/en.md` (Server Settings table + new section)

- [ ] **Step 1: Add a row to the Server Settings table**

In `docs/help/en.md`, find the existing row for "Expose vault files as MCP resources" in the Server Settings table (around line 141). Right after that row, add:

```markdown
| **Expose MCP slash-command prompts** | **on** | When on, MCP hosts surface canned vault workflows (`/summarize-note`, `/find-related`, `/expand-template`) as slash commands via the prompts surface. Restart the server to apply changes. See [Prompts](#prompts) below. |
```

- [ ] **Step 2: Add a new "Prompts" section after "Resources"**

In `docs/help/en.md`, find the existing `## Resources` section (around line 276). After its `### Disabling` subsection (which ends around line 290), add:

```markdown
---

## Prompts

In addition to tools and resources, the server exposes three canned **MCP prompts** so hosts surface them as slash commands. The user picks one, fills in the argument(s), and a pre-canned message lands in the conversation — no need to spell out the full tool sequence.

How the prompts appear depends on the host. Claude Code, for example, surfaces them as `/mcp__obsidian__summarize-note`, `/mcp__obsidian__find-related`, and `/mcp__obsidian__expand-template`.

### Available prompts

- **`summarize-note`** — argument: `path` (vault-relative). Asks Claude to read the note with `vault_read` and produce a concise summary.
- **`find-related`** — argument: `path` (vault-relative). Asks Claude to read the seed note, then cross-reference it with `search_fulltext` and `vault_get_backlinks` and report the most relevant connections.
- **`expand-template`** — argument: `template` (vault-relative path to a template file in the vault's `templates/` folder). Reads the template, surfaces the placeholders that need values, and asks Claude to collect them and call `template_expand` (or `template_create_from` if the user wants a new note written).

### Autocomplete

The `expand-template` prompt's `template` argument supports autocomplete: the server lists files in the vault's `templates/` folder and filters them by case-insensitive substring match (capped at 100 entries). Hosts that implement the MCP `completion/complete` protocol expose this as a dropdown next to the argument input.

### Disabling

If you don't want the slash-command surface, turn off **"Expose MCP slash-command prompts"** in *Server Settings* and restart the server. The server then advertises a server without a prompts capability, and hosts will no longer surface the slash commands.
```

- [ ] **Step 3: Verify the docs build (no auto-generation step is required for help.md)**

Run:
```bash
npm run docs:tools
```

Expected: PASS, with no diff in `docs/tools.generated.md` (prompts are not tools).

- [ ] **Step 4: Commit**

```bash
git add docs/help/en.md
git commit -m "$(cat <<'EOF'
docs(help): document the MCP prompts surface

Adds a row to the Server Settings table and a new Prompts section under
Resources covering the three slash commands, autocomplete on the
template argument, and the disabling toggle.

Refs #293
EOF
)"
```

---

## Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Lint, typecheck, full test suite**

Run each, in sequence:

```bash
npm run lint
```

Expected: PASS.

```bash
npm run typecheck
```

Expected: PASS.

```bash
npm test
```

Expected: PASS — every suite green.

- [ ] **Step 2: Confirm `docs:check` is happy**

Run:
```bash
npm run docs:tools
git status docs/tools.generated.md
```

Expected: `git status` shows the file is unchanged (no diff). Prompts are not tools, so the generator output is unaffected.

- [ ] **Step 3: Push the branch and open a PR**

Push:

```bash
git push -u origin feat/issue-293-mcp-prompts-slash-commands
```

Open the PR via `gh`:

```bash
gh pr create --title "feat(server/mcp): expose canned MCP prompts (slash commands) for common vault workflows" --body "$(cat <<'EOF'
Closes #293

## Summary

- Adds the `prompts: {}` capability gated by a new `promptsEnabled` setting (default on, v11→v12 migration).
- Registers three canned prompts: `/summarize-note`, `/find-related`, `/expand-template`. The `template` argument autocompletes against the vault's `templates/` folder via the SDK's `completable()` helper.
- `/daily-note` and `/fix-broken-links` deferred to follow-up issues #304 and #305 (see spec).

## Test plan

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` — including new `tests/server/prompts.test.ts` (handler unit tests + completer) and `tests/integration/prompts.test.ts` (SDK transport smoke covering `prompts/list`, `prompts/get`, `completion/complete`).
- [ ] `npm run docs:tools` produces no diff (prompts are not tools).
- [ ] Manually disable the toggle in Server Settings, restart, and confirm the host no longer offers the slash commands.
EOF
)"
```

Expected: PR opened. Note the URL.

- [ ] **Step 4: Stop and wait for the user to merge**

Per project rules, never merge the PR yourself. Stop after the PR is open and let the user take it from here.

---

## Notes for the implementer

**TDD discipline.** Every task starts with a failing test. Don't skip the "run to verify it fails" step — it's the cheapest way to catch a typo'd assertion or a misplaced expectation.

**Don't gold-plate the prompt copy.** The exact wording of the user-role messages is testable but not load-bearing. Keep them short and stable; the spec lists the required tool-name mentions (`vault_read`, `search_fulltext`, `vault_get_backlinks`, `template_expand`, `template_create_from`) — those are what the tests assert.

**Path validation must run BEFORE any I/O.** Always call `validateVaultPath` at the top of every handler. The mock adapter doesn't enforce its own path guard, so a missing `validateVaultPath` would let traversal slip through silently in tests AND production.

**Autocomplete error policy.** If `adapter.list('templates')` throws (folder missing, permission error), return `[]`. Never propagate the error — autocomplete should never break the prompt's argument-entry UX.

**Keep `mcp-server.ts` thin.** The new wiring is exactly two lines: an `if (settings.promptsEnabled) { capabilities.prompts = {}; }` and an `if (settings.promptsEnabled) { registerPrompts(...); }`. Resist adding any prompt-specific logic there.

**The `extras` parameter on `registerPrompt` callbacks.** The MCP SDK passes a second `extras` argument to prompt handlers (auth context, etc.). The handlers in this plan ignore it. If TypeScript flags an unused parameter, prefix it with `_extras` per project convention.
