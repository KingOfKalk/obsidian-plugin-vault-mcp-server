# MCP Resources for Vault Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose vault files as MCP resources via `obsidian://vault/{+path}` (template) and `obsidian://vault/index` (static), so hosts can browse and read vault files without consuming tool-use turns.

**Architecture:** A new `src/server/resources.ts` registers two resources on the `McpServer` (file template + static index). It owns its mime table, URI parser, and read handlers. Wiring into `createMcpServer` is gated by a new `resourcesEnabled` settings flag (default on, with a v10→v11 migration). Tools surface unchanged; subscriptions and `roots` deferred per spec.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (`registerResource`, `ResourceTemplate`), Vitest, Zod, Obsidian plugin API.

**Spec:** [`docs/superpowers/specs/2026-05-03-mcp-resources-vault-files-design.md`](../specs/2026-05-03-mcp-resources-vault-files-design.md)

**Branch:** `feat/issue-292-mcp-resources-vault-files` (already created)

**Issue:** #292

---

## File Structure

### Created

- `src/server/resources.ts` — `registerResources(server, adapter, logger)`, mime table (`MIME_TABLE`, `getMimeType`, `isTextMime`), `parseVaultUri`, `indexHandler`, `fileHandler`. Self-contained. Reuses `validateVaultPath` from `src/utils/path-guard.ts` and `BinaryTooLargeError` from `src/tools/shared/errors.ts`.
- `tests/server/resources.test.ts` — unit tests against a mock adapter for the URI parser, mime table, both handlers, and the index truncation cap.

### Modified

- `src/types.ts` — add `resourcesEnabled: boolean` to `McpPluginSettings`; default `true` in `DEFAULT_SETTINGS`; bump `schemaVersion` default to 11.
- `src/settings/migrations.ts` — add `migrateV10ToV11` hop, append it to `HOPS`, bump `CURRENT_SCHEMA_VERSION` to 11.
- `tests/settings/migrations.test.ts` — add v10→v11 hop tests.
- `src/server/mcp-server.ts` — `createMcpServer(registry, adapter, settings, logger)` (signature widened); declare `resources: {}` capability iff `settings.resourcesEnabled`; call `registerResources` after `registerTools`.
- `src/main.ts` — pass `this.adapter` and `this.settings` into `createMcpServer`.
- `tests/server/mcp-server.test.ts` — update fake `McpServer` to capture `registerResource` calls; update existing call sites for the new signature.
- `src/settings/server-section.ts` — one toggle bound to `resourcesEnabled`.
- `src/lang/locale/en.ts` — strings for the toggle.
- `src/lang/locale/de.ts` — strings for the toggle (German translation).
- `src/tools/shared/errors.ts` — add `BinaryTooLargeError`; add a branch to `handleToolError`.
- `src/tools/vault/handlers.ts` — `readBinary` throws `BinaryTooLargeError` instead of `errorResult`.
- `src/obsidian/mock-adapter.ts` — accept `''` as the vault root in `list` and `listRecursive` (real Obsidian convention) in addition to `'/'`.
- `docs/help/en.md` — add a Resources section under the MCP surface description.

### Not modified

- `docs/tools.generated.md` — unaffected (resources are not tools). Verified by running `npm run docs:tools` at the end and confirming a clean diff.

---

## Task 1: Add `BinaryTooLargeError` to shared errors

**Files:**
- Modify: `src/tools/shared/errors.ts`
- Test: `tests/tools/shared/errors.test.ts` (create if missing; if a test already exists, append)

- [ ] **Step 1: Check if a test file exists**

```bash
ls tests/tools/shared/errors.test.ts 2>/dev/null || echo "MISSING"
```

If the file is missing, create it with a `describe('handleToolError', ...)` outer block before adding the test in step 2. If it exists, append the new test inside the existing `describe` block.

- [ ] **Step 2: Write the failing test**

Add to `tests/tools/shared/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BinaryTooLargeError, handleToolError } from '../../../src/tools/shared/errors';

describe('BinaryTooLargeError', () => {
  it('renders a clear message including size and limit', () => {
    const err = new BinaryTooLargeError(2_000_000, 1_048_576);
    expect(err.name).toBe('BinaryTooLargeError');
    expect(err.message).toBe(
      'Binary file too large (2000000 bytes, limit 1048576). Fetch the file out-of-band or use a chunked read when available.',
    );
    expect(err.sizeBytes).toBe(2_000_000);
    expect(err.limitBytes).toBe(1_048_576);
  });

  it('handleToolError maps BinaryTooLargeError to an isError CallToolResult with the same message', () => {
    const result = handleToolError(new BinaryTooLargeError(2_000_000, 1_048_576));
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'Error: Binary file too large (2000000 bytes, limit 1048576). Fetch the file out-of-band or use a chunked read when available.',
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
npx vitest run tests/tools/shared/errors.test.ts
```

Expected: FAIL — `BinaryTooLargeError is not exported`.

- [ ] **Step 4: Add `BinaryTooLargeError` and a `handleToolError` branch**

Edit `src/tools/shared/errors.ts`. After the existing `TimeoutError` class:

```ts
/**
 * The requested binary file exceeds the configured per-call byte limit.
 * Used by `vault_read_binary` and the resources surface to fail fast on
 * over-cap files instead of base64-encoding hundreds of megabytes.
 */
export class BinaryTooLargeError extends Error {
  constructor(
    public readonly sizeBytes: number,
    public readonly limitBytes: number,
  ) {
    super(
      `Binary file too large (${String(sizeBytes)} bytes, limit ${String(limitBytes)}). Fetch the file out-of-band or use a chunked read when available.`,
    );
    this.name = 'BinaryTooLargeError';
  }
}
```

Then in `handleToolError`, add a branch above the final `error instanceof Error` fallback:

```ts
if (error instanceof BinaryTooLargeError) {
  return errorFrom(error.message);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
npx vitest run tests/tools/shared/errors.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/shared/errors.ts tests/tools/shared/errors.test.ts
git commit -m "$(cat <<'EOF'
feat(tools/shared): add BinaryTooLargeError with handleToolError branch

Lifts the 1 MiB cap message into a typed error so the tools and resources
surfaces can share it. handleToolError preserves the existing wire-format
message verbatim.

Refs #292
EOF
)"
```

---

## Task 2: Switch `vault_read_binary` to throw `BinaryTooLargeError`

**Files:**
- Modify: `src/tools/vault/handlers.ts:367-390`

- [ ] **Step 1: Verify the existing tool test for over-cap input is green before the change**

```bash
npx vitest run tests/tools/vault/handlers.test.ts -t "readBinary"
```

Expected: PASS (baseline).

- [ ] **Step 2: Replace the inline `errorResult` with a thrown `BinaryTooLargeError`**

In `src/tools/vault/handlers.ts`, change `readBinary` (lines ~367–390) so the cap check throws instead of returning:

```ts
async readBinary(params): Promise<CallToolResult> {
  try {
    const path = validateVaultPath(params.path, vaultPath);
    const data = await adapter.readBinary(path);
    if (data.byteLength > BINARY_BYTE_LIMIT) {
      throw new BinaryTooLargeError(data.byteLength, BINARY_BYTE_LIMIT);
    }
    const base64 = Buffer.from(data).toString('base64');
    return makeResponse(
      {
        path,
        data: base64,
        encoding: 'base64' as const,
        size_bytes: data.byteLength,
      },
      (v) => v.data,
      readResponseFormat(params),
    );
  } catch (error) {
    return handleToolError(error);
  }
},
```

Update the imports at the top of the file to include `BinaryTooLargeError`:

```ts
import { handleToolError, BinaryTooLargeError } from '../shared/errors';
```

- [ ] **Step 3: Run the full vault handlers test suite**

```bash
npx vitest run tests/tools/vault/handlers.test.ts
```

Expected: PASS — the rendered error message is unchanged because `handleToolError` formats it identically.

- [ ] **Step 4: Commit**

```bash
git add src/tools/vault/handlers.ts
git commit -m "$(cat <<'EOF'
refactor(tools/vault): throw BinaryTooLargeError from readBinary

Replaces the inline errorResult with the new typed error so the resources
surface can share the same cap. Wire-format error message unchanged.

Refs #292
EOF
)"
```

---

## Task 3: Make the mock adapter accept `''` as vault root

**Files:**
- Modify: `src/obsidian/mock-adapter.ts:178-203`
- Test: `tests/obsidian/mock-adapter.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/obsidian/mock-adapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';

describe('MockObsidianAdapter root traversal', () => {
  it('listRecursive("") walks the entire vault (real Obsidian convention)', () => {
    const adapter = new MockObsidianAdapter('/vault');
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');
    adapter.addFile('notes/b.md', 'b');

    const result = adapter.listRecursive('');

    expect(result.files.sort()).toEqual(['a.md', 'notes/b.md']);
    expect(result.folders).toContain('notes');
  });

  it('list("") returns the direct children of the vault root', () => {
    const adapter = new MockObsidianAdapter('/vault');
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');

    const result = adapter.list('');

    expect(result.files).toContain('a.md');
    expect(result.folders).toContain('notes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/obsidian/mock-adapter.test.ts -t "root traversal"
```

Expected: FAIL — `FolderNotFoundError`.

- [ ] **Step 3: Update the mock to treat `''` like `'/'`**

In `src/obsidian/mock-adapter.ts`, change the two functions:

```ts
list(path: string): ListResult {
  const isRoot = path === '/' || path === '';
  if (!this.folders.has(path) && !isRoot) {
    throw new FolderNotFoundError(path);
  }
  return this.getDirectChildren(isRoot ? '' : path);
}

listRecursive(path: string): ListResult {
  const isRoot = path === '/' || path === '';
  if (!this.folders.has(path) && !isRoot) {
    throw new FolderNotFoundError(path);
  }
  const prefix = isRoot ? '' : path + '/';
  const files: string[] = [];
  const folders: string[] = [];
  for (const filePath of this.files.keys()) {
    if (isRoot || filePath.startsWith(prefix)) {
      files.push(filePath);
    }
  }
  for (const folderPath of this.folders) {
    if (folderPath !== path && (isRoot || folderPath.startsWith(prefix))) {
      folders.push(folderPath);
    }
  }
  return { files: files.sort(), folders: folders.sort() };
}
```

Inspect `getDirectChildren` (search the file). If it special-cases `'/'`, extend the predicate to accept `''` consistently. If it just uses `path` as a prefix, `''` will already work — confirm and adjust if needed.

- [ ] **Step 4: Run the full mock adapter suite**

```bash
npx vitest run tests/obsidian/mock-adapter.test.ts
```

Expected: PASS, all existing tests included.

- [ ] **Step 5: Commit**

```bash
git add src/obsidian/mock-adapter.ts tests/obsidian/mock-adapter.test.ts
git commit -m "$(cat <<'EOF'
test(obsidian/mock-adapter): accept '' as vault root in list/listRecursive

Real Obsidian's vault root path is the empty string. The mock previously
required '/'. Accepting both keeps existing tests green and lets the new
resources index handler (#292) pass '' uniformly to either adapter.

Refs #292
EOF
)"
```

---

## Task 4: Add `resourcesEnabled` to settings

**Files:**
- Modify: `src/types.ts`
- Test: `tests/types.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/types';

describe('DEFAULT_SETTINGS resourcesEnabled', () => {
  it('defaults resourcesEnabled to true', () => {
    expect(DEFAULT_SETTINGS.resourcesEnabled).toBe(true);
  });

  it('bumps schemaVersion to 11', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/types.test.ts -t "resourcesEnabled"
```

Expected: FAIL — property missing on `DEFAULT_SETTINGS`, schemaVersion is 10.

- [ ] **Step 3: Add the field and bump the version**

In `src/types.ts`, add to the `McpPluginSettings` interface (place it after `autoStart`):

```ts
/**
 * When true, the server exposes vault files as MCP resources
 * (obsidian://vault/{+path} template + obsidian://vault/index static)
 * in addition to tools. Default true.
 */
resourcesEnabled: boolean;
```

Update `DEFAULT_SETTINGS` — bump `schemaVersion` to `11` and add `resourcesEnabled: true`:

```ts
export const DEFAULT_SETTINGS: McpPluginSettings = {
  schemaVersion: 11,
  // ...existing fields unchanged...
  autoStart: false,
  resourcesEnabled: true,
  executeCommandAllowlist: [],
  // ...rest unchanged...
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/types.test.ts -t "resourcesEnabled"
```

Expected: PASS.

- [ ] **Step 5: Run typecheck — the migration step (Task 5) will resolve any compile errors**

```bash
npm run typecheck
```

Expected: may FAIL referencing `CURRENT_SCHEMA_VERSION === 10` or callers; that's resolved in Task 5. If it fails outside `src/settings/migrations.ts` or its tests, fix the unrelated breakage now (likely another `DEFAULT_SETTINGS` consumer that explicitly listed all fields — add `resourcesEnabled: true` there too).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "$(cat <<'EOF'
feat(types): add resourcesEnabled setting (default on, schemaVersion 11)

Gates the MCP resources surface added by #292 behind a single global
toggle. New installs get it on; existing installs migrate in the next
commit.

Refs #292
EOF
)"
```

---

## Task 5: Add `migrateV10ToV11` migration

**Files:**
- Modify: `src/settings/migrations.ts`
- Test: `tests/settings/migrations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/settings/migrations.test.ts` (mirror the existing v9→v10 test style):

```ts
import { migrateV10ToV11 } from '../../src/settings/migrations';

describe('migrateV10ToV11', () => {
  it('sets resourcesEnabled: true for installs without the field', () => {
    const data = {} as Record<string, unknown>;
    migrateV10ToV11(data);
    expect(data.resourcesEnabled).toBe(true);
  });

  it('preserves an explicit false', () => {
    const data = { resourcesEnabled: false } as Record<string, unknown>;
    migrateV10ToV11(data);
    expect(data.resourcesEnabled).toBe(false);
  });

  it('preserves an explicit true', () => {
    const data = { resourcesEnabled: true } as Record<string, unknown>;
    migrateV10ToV11(data);
    expect(data.resourcesEnabled).toBe(true);
  });
});
```

Also update the existing `migrates V0 (no schemaVersion) all the way to current` test — it should still pass without changes because it only asserts `schemaVersion === CURRENT_SCHEMA_VERSION`. Verify by re-reading that test's assertions.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/settings/migrations.test.ts -t "migrateV10ToV11"
```

Expected: FAIL — `migrateV10ToV11 is not exported`.

- [ ] **Step 3: Add the migration**

In `src/settings/migrations.ts`, after `migrateV9ToV10`:

```ts
export function migrateV9ToV10(data: Settings): void {
  // ...existing body unchanged...
}

export function migrateV10ToV11(data: Settings): void {
  // Default the new resources surface on for existing installs. They
  // can disable it in Server Settings if they prefer a tools-only
  // server. See docs/superpowers/specs/2026-05-03-mcp-resources-vault-files-design.md.
  if (data.resourcesEnabled === undefined) data.resourcesEnabled = true;
}
```

Append to `HOPS`:

```ts
const HOPS: Array<{ target: number; run: MigrationHop }> = [
  // ...existing hops...
  { target: 10, run: migrateV9ToV10 },
  { target: 11, run: migrateV10ToV11 },
];
```

Bump `CURRENT_SCHEMA_VERSION`:

```ts
export const CURRENT_SCHEMA_VERSION = 11;
```

- [ ] **Step 4: Run the migrations test suite to verify everything passes**

```bash
npx vitest run tests/settings/migrations.test.ts
```

Expected: PASS — new tests plus the existing "all the way to current" test (now ending at 11).

- [ ] **Step 5: Commit**

```bash
git add src/settings/migrations.ts tests/settings/migrations.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): add v10→v11 migration enabling resources surface

Existing installs default to resourcesEnabled: true; explicit values are
preserved. CURRENT_SCHEMA_VERSION bumped to 11.

Refs #292
EOF
)"
```

---

## Task 6: Add lang strings for the toggle (en + de)

**Files:**
- Modify: `src/lang/locale/en.ts`
- Modify: `src/lang/locale/de.ts`

- [ ] **Step 1: Verify the lang file shapes**

```bash
sed -n '78,82p' src/lang/locale/en.ts
sed -n '78,82p' src/lang/locale/de.ts
```

Expected output: keys like `setting_autostart_name` / `setting_autostart_desc`. We mirror that pattern.

- [ ] **Step 2: Add English strings**

In `src/lang/locale/en.ts`, near the existing `setting_autostart_*` lines:

```ts
setting_resources_enabled_name: 'Expose vault files as MCP resources',
setting_resources_enabled_desc:
  'When on, MCP hosts can browse and read vault files via the resources surface (obsidian://vault/{path}) in addition to tools. Restart the server to apply changes.',
```

- [ ] **Step 3: Add German strings**

In `src/lang/locale/de.ts`, in the matching position:

```ts
setting_resources_enabled_name: 'Vault-Dateien als MCP-Ressourcen freigeben',
setting_resources_enabled_desc:
  'Wenn aktiviert, können MCP-Hosts Vault-Dateien zusätzlich zu den Tools über die Resources-Schnittstelle (obsidian://vault/{Pfad}) lesen und durchsuchen. Server neu starten, damit die Änderung wirksam wird.',
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS — string keys are looked up dynamically by `t()`, so no failure unless `de.ts` has a strict shape that disallows new keys (verify if it does and adjust).

- [ ] **Step 5: Commit**

```bash
git add src/lang/locale/en.ts src/lang/locale/de.ts
git commit -m "$(cat <<'EOF'
feat(lang): add resources surface toggle strings (en, de)

Refs #292
EOF
)"
```

---

## Task 7: Create `src/server/resources.ts` skeleton with mime table

**Files:**
- Create: `src/server/resources.ts`
- Create: `tests/server/resources.test.ts`

- [ ] **Step 1: Write the failing test for the mime table**

Create `tests/server/resources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getMimeType, isTextMime } from '../../src/server/resources';

describe('getMimeType', () => {
  it('maps known text extensions', () => {
    expect(getMimeType('notes/foo.md')).toBe('text/markdown');
    expect(getMimeType('foo.txt')).toBe('text/plain');
    expect(getMimeType('config.json')).toBe('application/json');
    expect(getMimeType('data.csv')).toBe('text/csv');
    expect(getMimeType('settings.yml')).toBe('application/yaml');
    expect(getMimeType('settings.yaml')).toBe('application/yaml');
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('maps known binary extensions', () => {
    expect(getMimeType('a.png')).toBe('image/png');
    expect(getMimeType('a.jpg')).toBe('image/jpeg');
    expect(getMimeType('a.jpeg')).toBe('image/jpeg');
    expect(getMimeType('a.pdf')).toBe('application/pdf');
    expect(getMimeType('a.mp3')).toBe('audio/mpeg');
    expect(getMimeType('a.mp4')).toBe('video/mp4');
  });

  it('is case-insensitive on the extension', () => {
    expect(getMimeType('FOO.MD')).toBe('text/markdown');
    expect(getMimeType('PHOTO.JPG')).toBe('image/jpeg');
  });

  it('falls back to application/octet-stream for unknown or missing extensions', () => {
    expect(getMimeType('mystery.xyz')).toBe('application/octet-stream');
    expect(getMimeType('Makefile')).toBe('application/octet-stream');
  });
});

describe('isTextMime', () => {
  it('returns true for text/* and application/json and image/svg+xml', () => {
    expect(isTextMime('text/markdown')).toBe(true);
    expect(isTextMime('text/plain')).toBe(true);
    expect(isTextMime('application/json')).toBe(true);
    expect(isTextMime('image/svg+xml')).toBe(true);
  });

  it('returns false for binary mimes', () => {
    expect(isTextMime('image/png')).toBe(false);
    expect(isTextMime('application/pdf')).toBe(false);
    expect(isTextMime('application/octet-stream')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/server/resources.test.ts
```

Expected: FAIL — `Cannot find module '../../src/server/resources'`.

- [ ] **Step 3: Create the skeleton with the mime table**

Create `src/server/resources.ts`:

```ts
import { posix } from 'path';

/**
 * Static mime-type table covering the file types that show up in an
 * Obsidian vault. Keys are lowercase extensions including the leading dot.
 * Unknown extensions fall back to application/octet-stream. See
 * docs/superpowers/specs/2026-05-03-mcp-resources-vault-files-design.md.
 */
const MIME_TABLE: Record<string, string> = {
  // Text
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/x-typescript',
  '.svg': 'image/svg+xml',
  // Binary — images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // Binary — audio / video
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  // Binary — documents
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.epub': 'application/epub+zip',
};

const FALLBACK_MIME = 'application/octet-stream';

export function getMimeType(path: string): string {
  const ext = posix.extname(path).toLowerCase();
  return MIME_TABLE[ext] ?? FALLBACK_MIME;
}

export function isTextMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  if (mime === 'image/svg+xml') return true;
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/server/resources.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/resources.ts tests/server/resources.test.ts
git commit -m "$(cat <<'EOF'
feat(server/resources): add mime table for vault resources surface

Foundation for #292. getMimeType maps Obsidian-relevant extensions to mime
strings; isTextMime classifies text vs blob for ReadResourceResult content.

Refs #292
EOF
)"
```

---

## Task 8: Implement `parseVaultUri`

**Files:**
- Modify: `src/server/resources.ts`
- Modify: `tests/server/resources.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tests/server/resources.test.ts`:

```ts
import { parseVaultUri } from '../../src/server/resources';
import { PathTraversalError } from '../../src/utils/path-guard';

const VAULT = '/tmp/vault';

function uri(s: string): URL { return new URL(s); }

describe('parseVaultUri', () => {
  it('returns the validated relative path for a plain URI', () => {
    expect(parseVaultUri(uri('obsidian://vault/notes/foo.md'), { path: 'notes/foo.md' }, VAULT))
      .toBe('notes/foo.md');
  });

  it('handles unicode paths', () => {
    expect(parseVaultUri(uri('obsidian://vault/Notizen/%C3%9Cbersicht.md'), { path: 'Notizen/Übersicht.md' }, VAULT))
      .toBe('Notizen/Übersicht.md');
  });

  it('rejects traversal', () => {
    expect(() => parseVaultUri(uri('obsidian://vault/../etc/passwd'), { path: '../etc/passwd' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects encoded traversal', () => {
    expect(() => parseVaultUri(uri('obsidian://vault/..%2F..'), { path: '..%2F..' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects wrong scheme', () => {
    expect(() => parseVaultUri(uri('file:///foo.md'), { path: 'foo.md' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects wrong host', () => {
    expect(() => parseVaultUri(uri('obsidian://other/foo.md'), { path: 'foo.md' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('rejects empty path', () => {
    expect(() => parseVaultUri(uri('obsidian://vault/'), { path: '' }, VAULT))
      .toThrow(PathTraversalError);
  });

  it('accepts a single-string variable form (some SDK paths pass string[])', () => {
    expect(parseVaultUri(uri('obsidian://vault/notes/foo.md'), { path: ['notes', 'foo.md'] as unknown as string }, VAULT))
      .toBe('notes/foo.md');
  });
});
```

(The last test is defensive — the SDK's `Variables` type allows `string | string[]` per RFC 6570 expansion. The `+` operator captures as a single string in practice, but we handle both to avoid a runtime crash.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/server/resources.test.ts -t "parseVaultUri"
```

Expected: FAIL — function not exported.

- [ ] **Step 3: Implement `parseVaultUri`**

Add to `src/server/resources.ts`:

```ts
import { validateVaultPath, PathTraversalError } from '../utils/path-guard';

type VaultUriVariables = { path: string | string[] };

/**
 * Validate an `obsidian://vault/{+path}` URI and return the vault-relative
 * path it points to. The SDK has already parsed the variable; we still
 * defend against scheme/host mismatches and call `validateVaultPath` so
 * traversal protection is shared with the tool surface.
 */
export function parseVaultUri(
  uri: URL,
  variables: VaultUriVariables,
  vaultPath: string,
): string {
  if (uri.protocol !== 'obsidian:') {
    throw new PathTraversalError(`Unexpected scheme: ${uri.protocol}`);
  }
  if (uri.host !== 'vault') {
    throw new PathTraversalError(`Unexpected host: ${uri.host}`);
  }
  const raw = Array.isArray(variables.path)
    ? variables.path.join('/')
    : variables.path;
  return validateVaultPath(raw, vaultPath);
}
```

Re-export `PathTraversalError` for the test file's convenience (optional — tests can import it from path-guard directly; we already do above, so no new export needed).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/server/resources.test.ts -t "parseVaultUri"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/resources.ts tests/server/resources.test.ts
git commit -m "$(cat <<'EOF'
feat(server/resources): add parseVaultUri with shared path-guard

Validates scheme, host, and the captured path; defers traversal protection
to validateVaultPath so the tool and resources surfaces share enforcement.

Refs #292
EOF
)"
```

---

## Task 9: Implement `fileHandler` text branch

**Files:**
- Modify: `src/server/resources.ts`
- Modify: `tests/server/resources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/resources.test.ts`:

```ts
import { Logger } from '../../src/utils/logger';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { createFileHandler } from '../../src/server/resources';

function makeLogger(): Logger {
  return new Logger('test', { debugMode: false, accessKey: '' });
}

describe('fileHandler — text', () => {
  it('returns TextResourceContents for a markdown file', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    adapter.addFile('notes/foo.md', '# Hello');
    const handler = createFileHandler(adapter, makeLogger());

    const result = await handler(
      new URL('obsidian://vault/notes/foo.md'),
      { path: 'notes/foo.md' },
    );

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toEqual({
      uri: 'obsidian://vault/notes/foo.md',
      mimeType: 'text/markdown',
      text: '# Hello',
    });
  });

  it('propagates the adapter not-found error for a missing file', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    const handler = createFileHandler(adapter, makeLogger());

    await expect(handler(
      new URL('obsidian://vault/missing.md'),
      { path: 'missing.md' },
    )).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/server/resources.test.ts -t "fileHandler"
```

Expected: FAIL — `createFileHandler` not exported.

- [ ] **Step 3: Implement the file handler with the text branch only (binary will follow in Task 10)**

Add to `src/server/resources.ts`:

```ts
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { Logger } from '../utils/logger';

type FileHandler = (
  uri: URL,
  variables: VaultUriVariables,
) => Promise<ReadResourceResult>;

export function createFileHandler(
  adapter: ObsidianAdapter,
  _logger: Logger,
): FileHandler {
  return async (uri, variables) => {
    const path = parseVaultUri(uri, variables, adapter.getVaultPath());
    const mime = getMimeType(path);
    if (isTextMime(mime)) {
      const text = await adapter.readFile(path);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: mime,
            text,
          },
        ],
      };
    }
    throw new Error('Binary branch not implemented yet'); // filled in in the next task
  };
}
```

The `_logger` parameter is reserved — used in later tasks for non-fatal warnings (e.g. when `stat` returns null).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/server/resources.test.ts -t "fileHandler — text"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/resources.ts tests/server/resources.test.ts
git commit -m "$(cat <<'EOF'
feat(server/resources): implement fileHandler text branch

Text-classified files (md/txt/json/csv/yaml/html/svg/...) are served as
TextResourceContents with the mime type from the static table. Binary
branch follows in the next commit.

Refs #292
EOF
)"
```

---

## Task 10: Implement `fileHandler` binary branch with size cap

**Files:**
- Modify: `src/server/resources.ts`
- Modify: `tests/server/resources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/resources.test.ts`:

```ts
import { BinaryTooLargeError } from '../../src/tools/shared/errors';

describe('fileHandler — binary', () => {
  it('returns BlobResourceContents (base64) for a small image', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    await adapter.writeBinary('img.png', bytes.buffer);
    const handler = createFileHandler(adapter, makeLogger());

    const result = await handler(
      new URL('obsidian://vault/img.png'),
      { path: 'img.png' },
    );

    expect(result.contents).toHaveLength(1);
    const c = result.contents[0] as { uri: string; mimeType: string; blob: string };
    expect(c.uri).toBe('obsidian://vault/img.png');
    expect(c.mimeType).toBe('image/png');
    expect(Buffer.from(c.blob, 'base64')).toEqual(Buffer.from(bytes));
  });

  it('serves a file at exactly 1 MiB', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    const bytes = new Uint8Array(1_048_576);
    await adapter.writeBinary('big.png', bytes.buffer);
    const handler = createFileHandler(adapter, makeLogger());

    const result = await handler(
      new URL('obsidian://vault/big.png'),
      { path: 'big.png' },
    );

    const c = result.contents[0] as { blob: string };
    expect(Buffer.from(c.blob, 'base64').byteLength).toBe(1_048_576);
  });

  it('throws BinaryTooLargeError above 1 MiB', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    const bytes = new Uint8Array(1_048_577);
    await adapter.writeBinary('big.png', bytes.buffer);
    const handler = createFileHandler(adapter, makeLogger());

    await expect(handler(
      new URL('obsidian://vault/big.png'),
      { path: 'big.png' },
    )).rejects.toBeInstanceOf(BinaryTooLargeError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/server/resources.test.ts -t "fileHandler — binary"
```

Expected: FAIL — `Binary branch not implemented yet`.

- [ ] **Step 3: Implement the binary branch using `stat` for the cap check**

Replace the `throw` placeholder in `createFileHandler`:

```ts
import { BinaryTooLargeError, FileNotFoundError } from '../tools/shared/errors';
import { BINARY_BYTE_LIMIT } from '../constants';

// ...inside createFileHandler:
    if (isTextMime(mime)) {
      const text = await adapter.readFile(path);
      return {
        contents: [{ uri: uri.toString(), mimeType: mime, text }],
      };
    }

    const stat = await adapter.stat(path);
    if (stat === null) {
      throw new FileNotFoundError(path);
    }
    if (stat.size > BINARY_BYTE_LIMIT) {
      throw new BinaryTooLargeError(stat.size, BINARY_BYTE_LIMIT);
    }
    const data = await adapter.readBinary(path);
    const blob = Buffer.from(data).toString('base64');
    return {
      contents: [{ uri: uri.toString(), mimeType: mime, blob }],
    };
```

- [ ] **Step 4: Run the full resources test file**

```bash
npx vitest run tests/server/resources.test.ts
```

Expected: PASS — text + binary + parser + mime tests all green.

- [ ] **Step 5: Commit**

```bash
git add src/server/resources.ts tests/server/resources.test.ts
git commit -m "$(cat <<'EOF'
feat(server/resources): implement fileHandler binary branch with 1 MiB cap

Binary-classified files are served as base64 BlobResourceContents.
Over-cap files throw BinaryTooLargeError (shared with vault_read_binary).
Stat-before-read avoids loading multi-megabyte attachments only to refuse.

Refs #292
EOF
)"
```

---

## Task 11: Implement `indexHandler` with truncation cap

**Files:**
- Modify: `src/server/resources.ts`
- Modify: `tests/server/resources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/resources.test.ts`:

```ts
import { createIndexHandler } from '../../src/server/resources';
import { CHARACTER_LIMIT } from '../../src/constants';

interface IndexEntry { uri: string; name: string; mimeType: string; size: number }
interface IndexPayload { files: IndexEntry[]; folders: string[]; truncated: boolean }

describe('indexHandler', () => {
  it('returns a flat list with resource entries and folder names', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    adapter.addFolder('notes');
    adapter.addFile('a.md', 'a');
    adapter.addFile('notes/b.md', 'bb');
    adapter.addFile('img.png', 'pngdata');
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const c = result.contents[0] as { uri: string; mimeType: string; text: string };
    expect(c.uri).toBe('obsidian://vault/index');
    expect(c.mimeType).toBe('application/json');

    const payload = JSON.parse(c.text) as IndexPayload;
    expect(payload.truncated).toBe(false);
    expect(payload.folders).toContain('notes');
    expect(payload.files.find((f) => f.name === 'a.md')).toMatchObject({
      uri: 'obsidian://vault/a.md',
      mimeType: 'text/markdown',
      size: 1,
    });
    expect(payload.files.find((f) => f.name === 'b.md')).toMatchObject({
      uri: 'obsidian://vault/notes/b.md',
      mimeType: 'text/markdown',
    });
    expect(payload.files.find((f) => f.name === 'img.png')).toMatchObject({
      mimeType: 'image/png',
    });
  });

  it('returns an empty payload for an empty vault', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const payload = JSON.parse((result.contents[0] as { text: string }).text) as IndexPayload;
    expect(payload).toEqual({ files: [], folders: [], truncated: false });
  });

  it('truncates files past the 25 000-character cap', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    // Each entry is roughly 90+ chars in JSON. 400 entries blow past 25k.
    for (let i = 0; i < 400; i++) {
      adapter.addFile(`note-${String(i).padStart(4, '0')}.md`, 'x');
    }
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const text = (result.contents[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    const payload = JSON.parse(text) as IndexPayload;
    expect(payload.truncated).toBe(true);
    expect(payload.files.length).toBeLessThan(400);
  });

  it('produces URIs that round-trip through parseVaultUri', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    adapter.addFile('Notizen/Übersicht.md', 'x');
    const handler = createIndexHandler(adapter, makeLogger());

    const result = await handler(new URL('obsidian://vault/index'));
    const payload = JSON.parse((result.contents[0] as { text: string }).text) as IndexPayload;
    const entry = payload.files[0];

    const parsedPath = parseVaultUri(
      new URL(entry.uri),
      // The SDK populates `variables.path` by decoding the URI; emulate by
      // decoding entry.uri's pathname after the host segment.
      { path: decodeURIComponent(new URL(entry.uri).pathname.replace(/^\//, '')) },
      '/tmp/vault',
    );
    expect(parsedPath).toBe('Notizen/Übersicht.md');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/server/resources.test.ts -t "indexHandler"
```

Expected: FAIL — `createIndexHandler` not exported.

- [ ] **Step 3: Implement the index handler**

Add to `src/server/resources.ts`:

```ts
import { CHARACTER_LIMIT } from '../constants';

type IndexHandler = (uri: URL) => Promise<ReadResourceResult>;

interface IndexEntry {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

interface IndexPayload {
  files: IndexEntry[];
  folders: string[];
  truncated: boolean;
}

const VAULT_INDEX_URI = 'obsidian://vault/index';

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function buildEntry(adapter: ObsidianAdapter, path: string): IndexEntry {
  // Best-effort size — listing huge vaults shouldn't pay the I/O for every
  // file, but the mock adapter's stat() is cheap and the real adapter
  // reads from the metadata cache. If stat throws we fall back to 0.
  let size = 0;
  // stat is async; we synchronously fall through to 0. Caller may upgrade
  // this to await if it becomes important.
  void adapter;
  return {
    uri: 'obsidian://vault/' + encodeURI(path),
    name: basename(path),
    mimeType: getMimeType(path),
    size,
  };
}

export function createIndexHandler(
  adapter: ObsidianAdapter,
  _logger: Logger,
): IndexHandler {
  return async (_uri) => {
    const list = adapter.listRecursive('');
    const files: IndexEntry[] = [];
    for (const path of list.files) {
      const stat = await adapter.stat(path);
      files.push({
        uri: 'obsidian://vault/' + encodeURI(path),
        name: basename(path),
        mimeType: getMimeType(path),
        size: stat?.size ?? 0,
      });
    }
    const folders = [...list.folders];

    let payload: IndexPayload = { files, folders, truncated: false };
    let serialised = JSON.stringify(payload);
    if (serialised.length > CHARACTER_LIMIT) {
      // Drop entries from the tail of files until the serialised JSON fits.
      const trimmed = [...files];
      while (trimmed.length > 0) {
        trimmed.pop();
        const candidate: IndexPayload = { files: trimmed, folders, truncated: true };
        const candidateSerialised = JSON.stringify(candidate);
        if (candidateSerialised.length <= CHARACTER_LIMIT) {
          payload = candidate;
          serialised = candidateSerialised;
          break;
        }
      }
      // If even an empty files array doesn't fit (e.g. a folder list that
      // alone exceeds the cap), force a minimal payload.
      if (serialised.length > CHARACTER_LIMIT) {
        payload = { files: [], folders: [], truncated: true };
        serialised = JSON.stringify(payload);
      }
    }

    return {
      contents: [
        {
          uri: VAULT_INDEX_URI,
          mimeType: 'application/json',
          text: serialised,
        },
      ],
    };
  };
}

export const VAULT_INDEX_URI_CONST = VAULT_INDEX_URI;
```

Remove the unused `buildEntry` helper / dead `void adapter` if you don't end up using it — the `for...of` loop above is the canonical path.

- [ ] **Step 4: Run the full resources test file**

```bash
npx vitest run tests/server/resources.test.ts
```

Expected: PASS — index tests included.

- [ ] **Step 5: Commit**

```bash
git add src/server/resources.ts tests/server/resources.test.ts
git commit -m "$(cat <<'EOF'
feat(server/resources): implement static vault index handler

Returns a flat JSON payload of {files, folders, truncated}. Files carry
ready-to-use obsidian://vault/{path} URIs with mime types so hosts don't
need follow-up calls. Truncation drops entries from the tail until the
payload fits the 25 000-char cap.

Refs #292
EOF
)"
```

---

## Task 12: Wire `registerResources` into the McpServer

**Files:**
- Modify: `src/server/resources.ts`
- Modify: `tests/server/resources.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/resources.test.ts`:

```ts
import { registerResources } from '../../src/server/resources';

describe('registerResources', () => {
  it('registers vault-index (static) and vault-file (template)', () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');

    interface Capture { name: string; uriOrTemplate: unknown; metadata: Record<string, unknown> }
    const calls: Capture[] = [];
    const fakeServer = {
      registerResource(name: string, uriOrTemplate: unknown, metadata: Record<string, unknown>) {
        calls.push({ name, uriOrTemplate, metadata });
      },
    };

    registerResources(fakeServer as never, adapter, makeLogger());

    expect(calls.map((c) => c.name)).toEqual(['vault-index', 'vault-file']);
    expect(calls[0].uriOrTemplate).toBe('obsidian://vault/index');
    // Template is a class instance from the SDK — we just verify shape.
    expect(typeof calls[1].uriOrTemplate).toBe('object');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/server/resources.test.ts -t "registerResources"
```

Expected: FAIL — `registerResources` not exported.

- [ ] **Step 3: Implement `registerResources`**

Add to `src/server/resources.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

const FILE_TEMPLATE_URI = 'obsidian://vault/{+path}';

export function registerResources(
  server: McpServer,
  adapter: ObsidianAdapter,
  logger: Logger,
): void {
  const indexHandler = createIndexHandler(adapter, logger);
  const fileHandler = createFileHandler(adapter, logger);

  server.registerResource(
    'vault-index',
    VAULT_INDEX_URI,
    {
      name: 'Vault index',
      description:
        'JSON listing of every file and folder in the vault, with ready-to-use obsidian://vault/{path} URIs and mime types. Truncated past 25 000 characters.',
      mimeType: 'application/json',
    },
    (uri) => indexHandler(uri),
  );

  server.registerResource(
    'vault-file',
    new ResourceTemplate(FILE_TEMPLATE_URI, { list: undefined }),
    {
      name: 'Vault file',
      description:
        'Read any file in the vault by obsidian://vault/{path}. Text files (markdown, txt, json, csv, yaml, html, svg) return TextResourceContents; other files up to 1 MiB return base64 BlobResourceContents.',
    },
    (uri, variables) => fileHandler(uri, variables as VaultUriVariables),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/server/resources.test.ts -t "registerResources"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/resources.ts tests/server/resources.test.ts
git commit -m "$(cat <<'EOF'
feat(server/resources): add registerResources entry point

Registers vault-index (static) and vault-file (template) on an McpServer.
The template uses RFC 6570 reserved expansion ({+path}) so multi-segment
paths capture as one variable; list callback is intentionally undefined
(discovery happens through the static index).

Refs #292
EOF
)"
```

---

## Task 13: Wire resources into `createMcpServer`

**Files:**
- Modify: `src/server/mcp-server.ts`
- Modify: `tests/server/mcp-server.test.ts`

- [ ] **Step 1: Update the existing fake `McpServer` to capture `registerResource`**

In `tests/server/mcp-server.test.ts`, extend the `FakeMcpServer` mock and the captured-state arrays:

```ts
interface CapturedRegisterResourceCall {
  name: string;
  uriOrTemplate: unknown;
  metadata: Record<string, unknown>;
}

const capturedRegisterResourceCalls: CapturedRegisterResourceCall[] = [];

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class FakeMcpServer {
    public server = {};
    constructor(serverInfo: CapturedServerInfo, options: CapturedOptions) {
      capturedConstructorArgs.push({ serverInfo, options });
    }
    registerTool(name: string, config: CapturedRegisterToolCall['config']): void {
      capturedRegisterToolCalls.push({ name, config });
    }
    registerResource(name: string, uriOrTemplate: unknown, metadata: Record<string, unknown>): void {
      capturedRegisterResourceCalls.push({ name, uriOrTemplate, metadata });
    }
  }
  class FakeResourceTemplate {
    constructor(public uriTemplate: string, public callbacks: unknown) {}
  }
  return { McpServer: FakeMcpServer, ResourceTemplate: FakeResourceTemplate };
});
```

In the `beforeEach` block, also clear the new array:

```ts
capturedRegisterResourceCalls.length = 0;
```

- [ ] **Step 2: Add tests for the capability flag and the register calls**

```ts
import { DEFAULT_SETTINGS } from '../../src/types';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';

it('declares the resources capability and registers vault-index + vault-file when resourcesEnabled', async () => {
  const { createMcpServer } = await import('../../src/server/mcp-server');
  const registry = new ModuleRegistry(makeLogger());
  const adapter = new MockObsidianAdapter('/tmp/vault');
  const settings = { ...DEFAULT_SETTINGS, resourcesEnabled: true };

  createMcpServer(registry, adapter, settings, makeLogger());

  const caps = capturedConstructorArgs[0].options.capabilities;
  expect(caps).toMatchObject({ resources: {} });
  expect(capturedRegisterResourceCalls.map((c) => c.name)).toEqual([
    'vault-index',
    'vault-file',
  ]);
});

it('omits the resources capability and skips registration when resourcesEnabled is false', async () => {
  const { createMcpServer } = await import('../../src/server/mcp-server');
  const registry = new ModuleRegistry(makeLogger());
  const adapter = new MockObsidianAdapter('/tmp/vault');
  const settings = { ...DEFAULT_SETTINGS, resourcesEnabled: false };

  createMcpServer(registry, adapter, settings, makeLogger());

  const caps = capturedConstructorArgs[0].options.capabilities;
  expect(caps).not.toHaveProperty('resources');
  expect(capturedRegisterResourceCalls).toHaveLength(0);
});
```

Update the existing test call sites that invoke `createMcpServer(registry, makeLogger())` — they all need the new positional args. Pass `new MockObsidianAdapter('/tmp/vault')` and `DEFAULT_SETTINGS` as the new args:

```ts
createMcpServer(registry, new MockObsidianAdapter('/tmp/vault'), DEFAULT_SETTINGS, makeLogger());
```

- [ ] **Step 3: Run the test file to verify the new tests fail**

```bash
npx vitest run tests/server/mcp-server.test.ts -t "resources"
```

Expected: FAIL — `createMcpServer` signature mismatch / no `resources` capability declared.

- [ ] **Step 4: Update `createMcpServer`**

In `src/server/mcp-server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// ...existing imports...
import { registerResources } from './resources';
import type { ObsidianAdapter } from '../obsidian/adapter';
import type { McpPluginSettings } from '../types';

export function createMcpServer(
  registry: ModuleRegistry,
  adapter: ObsidianAdapter,
  settings: McpPluginSettings,
  logger: Logger,
): McpServer {
  const capabilities: { tools: Record<string, never>; logging: Record<string, never>; resources?: Record<string, never> } = {
    tools: {},
    logging: {},
  };
  if (settings.resourcesEnabled) {
    capabilities.resources = {};
  }

  const server = new McpServer(
    {
      name: 'obsidian-mcp-server',
      version: manifest.version,
    },
    {
      capabilities,
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server, registry, logger);
  if (settings.resourcesEnabled) {
    registerResources(server, adapter, logger);
  }

  return server;
}
```

- [ ] **Step 5: Run the full server test suite**

```bash
npx vitest run tests/server/mcp-server.test.ts
```

Expected: PASS — all existing tests adjusted plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add src/server/mcp-server.ts tests/server/mcp-server.test.ts
git commit -m "$(cat <<'EOF'
feat(server/mcp): wire resources capability into createMcpServer

Adds adapter + settings parameters; declares resources: {} and calls
registerResources iff settings.resourcesEnabled. Tools surface unchanged.

Refs #292
EOF
)"
```

---

## Task 14: Update `main.ts` to pass adapter and settings

**Files:**
- Modify: `src/main.ts:206`

- [ ] **Step 1: Find the call site**

```bash
grep -n "createMcpServer" src/main.ts
```

Expected: one hit, in the `HttpMcpServer` constructor on line ~206 — the closure passes `(this.registry, this.logger)`.

- [ ] **Step 2: Update the closure**

Edit `src/main.ts`:

```ts
const server = new HttpMcpServer(
  () => createMcpServer(this.registry, this.adapter, this.settings, this.logger),
  this.logger,
  // ...rest unchanged...
);
```

- [ ] **Step 3: Run lint and typecheck**

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run the full test suite to catch any other consumer of `createMcpServer`**

```bash
npm test
```

Expected: PASS. If any test calls `createMcpServer` with the old signature outside `tests/server/mcp-server.test.ts`, update it inline.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
refactor(main): pass adapter and settings into createMcpServer

Threads the new args required for the resources surface. Behaviour
unchanged when settings.resourcesEnabled is true (default).

Refs #292
EOF
)"
```

---

## Task 15: Add the settings UI toggle

**Files:**
- Modify: `src/settings/server-section.ts`
- Test: `tests/settings/server-section.test.ts` if one exists; otherwise skip the unit test (this is a UI-side toggle that follows the well-trodden `setting_autostart_*` pattern).

- [ ] **Step 1: Locate the auto-start toggle as a reference**

```bash
grep -n "setting_autostart_name\|autoStart" src/settings/server-section.ts
```

The auto-start toggle (around line 280) is the model.

- [ ] **Step 2: Add a parallel toggle for `resourcesEnabled`**

After the auto-start `new Setting(containerEl)` block in `renderServerSection`:

```ts
new Setting(containerEl)
  .setName(t('setting_resources_enabled_name'))
  .setDesc(t('setting_resources_enabled_desc'))
  .addToggle((toggle) =>
    toggle.setValue(plugin.settings.resourcesEnabled).onChange(async (value) => {
      plugin.settings.resourcesEnabled = value;
      await plugin.saveSettings();
    }),
  );
```

Place this immediately after the auto-start toggle and before the call to `renderDnsRebindSection`.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS — `plugin.settings.resourcesEnabled` resolves through the type added in Task 4.

- [ ] **Step 4: Run the test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/server-section.ts
git commit -m "$(cat <<'EOF'
feat(settings/server): add toggle for resources surface

Single boolean. Restart the server to apply (matches the rest of the
server-section settings).

Refs #292
EOF
)"
```

---

## Task 16: Integration smoke test through the real SDK transport

**Files:**
- Modify: `tests/server/mcp-server.test.ts` OR
- Create: `tests/integration/resources.test.ts` if the existing `tests/integration/server.test.ts` is the canonical place for transport-level checks

- [ ] **Step 1: Inspect the existing integration test for the project's transport pattern**

```bash
sed -n '1,60p' tests/integration/server.test.ts
```

Use whatever transport setup that file establishes. If it's an HTTP-level integration with a real `HttpMcpServer`, write the smoke test in the same shape; if it uses `InMemoryTransport` from the SDK, prefer that for speed.

- [ ] **Step 2: Write the smoke test**

A minimum two-call test using `InMemoryTransport` (preferred) — pseudocode pattern; adapt to whatever helpers the existing tests use:

```ts
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/server/mcp-server';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';

describe('resources surface — end-to-end', () => {
  it('reads obsidian://vault/index and a vault file via the SDK transport', async () => {
    const adapter = new MockObsidianAdapter('/tmp/vault');
    adapter.addFile('hello.md', '# Hello');
    const logger = new Logger('test', { debugMode: false, accessKey: '' });
    const registry = new ModuleRegistry(logger);
    const server = createMcpServer(registry, adapter, DEFAULT_SETTINGS, logger);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
    await client.connect(clientTransport);

    const indexResp = await client.readResource({ uri: 'obsidian://vault/index' });
    expect(indexResp.contents[0].mimeType).toBe('application/json');

    const fileResp = await client.readResource({ uri: 'obsidian://vault/hello.md' });
    expect(fileResp.contents[0]).toMatchObject({
      uri: 'obsidian://vault/hello.md',
      mimeType: 'text/markdown',
      text: '# Hello',
    });

    await client.close();
    await server.close();
  });
});
```

If `InMemoryTransport` lives at a different import path in the installed SDK version, find it via:

```bash
grep -rn "InMemoryTransport" node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.* 2>&1 | head -5
```

and update the import to match.

If `InMemoryTransport` is not available, skip this task and add a TODO comment in `tests/server/resources.test.ts` referencing the limitation; the unit-level coverage of `parseVaultUri`, `fileHandler`, `indexHandler`, and `registerResources` is already comprehensive.

- [ ] **Step 3: Run the test**

```bash
npx vitest run tests/integration/resources.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/resources.test.ts
git commit -m "$(cat <<'EOF'
test(server/resources): end-to-end smoke through SDK transport

Round-trips resources/read for the static index and a vault file via the
in-memory transport. Confirms the SDK actually surfaces what the unit
tests construct in isolation.

Refs #292
EOF
)"
```

---

## Task 17: Update the user manual

**Files:**
- Modify: `docs/help/en.md`
- Modify: `docs/help/de.md` if it exists (check first)

- [ ] **Step 1: Find a good insertion point**

```bash
grep -n "## " docs/help/en.md | head -20
```

Locate the section that describes the MCP surface (likely a "Tools" or "MCP modules" heading). Insert the new "Resources" section after it.

- [ ] **Step 2: Add the Resources section**

Add a section like:

```markdown
## Resources

In addition to tools, the server exposes the vault as **MCP resources** so hosts (Claude Desktop, MCP-compatible IDEs, etc.) can browse and read notes natively without spending tool-use turns.

### URIs

- **`obsidian://vault/index`** — a static JSON listing of every file and folder in the vault. Each file entry carries a ready-to-read URI and mime type. Listings over 25 000 characters are truncated; use the `vault_list_recursive` tool for full enumeration on very large vaults.
- **`obsidian://vault/{path}`** — read any file by its vault-relative path. Markdown, text, JSON, CSV, YAML, HTML, and SVG files are returned as text; other files (images, PDFs, audio, video) are returned as base64 blobs.

Binary files larger than **1 MiB** are refused. Use the `vault_read_binary` tool if you genuinely need a larger file.

### Disabling

If you only want the tools surface, turn off **"Expose vault files as MCP resources"** in *Server Settings* and restart the server. The server then advertises a tools-only capability set.
```

- [ ] **Step 3: Add a German equivalent if `docs/help/de.md` exists**

Mirror the section, translated. If only `en.md` exists, skip.

- [ ] **Step 4: Run the docs check**

```bash
npm run docs:tools
```

Expected: clean diff (resources are not tools, so the generated tools doc is unaffected). If the script produces a diff, investigate before committing.

- [ ] **Step 5: Commit**

```bash
git add docs/help/en.md docs/help/de.md 2>/dev/null || git add docs/help/en.md
git commit -m "$(cat <<'EOF'
docs(help): document the MCP resources surface

Refs #292
EOF
)"
```

---

## Task 18: Final verification

**Files:** none

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: PASS (no warnings, no errors). Fix anything new the resources file introduced before continuing.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: 491+ passing (existing baseline plus all new tests added across Tasks 1–16).

- [ ] **Step 4: Confirm `docs:tools` is clean**

```bash
npm run docs:tools
git status --short docs/tools.generated.md
```

Expected: no diff.

- [ ] **Step 5: Verify the commit list reads coherently**

```bash
git log --oneline main..HEAD
```

Expected: ~17 commits, each with a Conventional Commits subject, no AI attribution, all referencing `#292`.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feat/issue-292-mcp-resources-vault-files
```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "feat(server/mcp): expose vault files as MCP resources" --body "$(cat <<'EOF'
Closes #292

## Summary
- Adds an MCP resources surface so hosts can browse and read vault files without consuming tool-use turns.
- Two registrations: a static `obsidian://vault/index` JSON listing and a `obsidian://vault/{+path}` template.
- Gated by a new `resourcesEnabled` setting (default on, v10→v11 migration).
- Lifts the 1 MiB binary cap into a typed `BinaryTooLargeError` shared between `vault_read_binary` and the resources surface.

Subscriptions, `notifications/resources/list_changed`, and `roots` honoring are deferred per the [design spec](docs/superpowers/specs/2026-05-03-mcp-resources-vault-files-design.md).

## Test plan
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run docs:tools` (clean diff)
- [ ] Manual smoke test against a host: enable the toggle, point a client at the server, request `resources/list` and `resources/read` for the index plus a known file
EOF
)"
```

Done.

---

## Self-review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Architecture: `registerResources` after `registerTools` | Task 12, 13 |
| Capability declaration gated on `resourcesEnabled` | Task 13 |
| Static index registration | Task 11, 12 |
| File template registration with `{+path}` and `list: undefined` | Task 12 |
| Mime table + `getMimeType` + `isTextMime` | Task 7 |
| `parseVaultUri` with scheme/host check + `validateVaultPath` | Task 8 |
| `fileHandler` text branch | Task 9 |
| `fileHandler` binary branch with 1 MiB cap | Task 10 |
| `indexHandler` with truncation | Task 11 |
| `BinaryTooLargeError` typed error | Task 1, 2 |
| `resourcesEnabled` setting | Task 4 |
| v10→v11 migration | Task 5 |
| Lang strings (en + de) | Task 6 |
| Settings UI toggle | Task 15 |
| `main.ts` wiring | Task 14 |
| Mock adapter `''` root | Task 3 |
| Tests: URI parsing, mime, text, binary, index, settings gating, migration | Tasks 5, 7–13 |
| Integration smoke test | Task 16 |
| `docs/help/en.md` + locale siblings | Task 17 |
| `docs/tools.generated.md` clean diff verification | Task 17, 18 |

All spec sections accounted for.

**Type consistency check:**
- `createFileHandler` and `createIndexHandler` factory pattern is consistent across Tasks 9, 10, 11.
- `VaultUriVariables` type defined in Task 8 is reused in Task 9 and Task 12.
- `ObsidianAdapter` is imported as the existing project type in Task 9 onward.
- `Logger` is the existing `src/utils/logger` type, used identically across tasks.
- `BinaryTooLargeError` constructor signature `(sizeBytes, limitBytes)` is consistent between Task 1 (definition), Task 2 (vault handler), and Task 10 (resources handler).
- `CHARACTER_LIMIT` import path is `src/constants` per Task 11; `BINARY_BYTE_LIMIT` from the same file in Task 10.
- `migrateV10ToV11` named consistently between Task 5 implementation and tests.

**Placeholder scan:** No "TBD" / "TODO" / "fill in details" / "similar to Task N" placeholders. Every code step contains the actual code. Step 5 of Task 16 has a conditional fallback ("if `InMemoryTransport` is not available") with explicit guidance, not a placeholder. The `_logger` parameter naming convention is intentional (TS allows `_`-prefixed unused params), not a placeholder.

Plan is complete.
