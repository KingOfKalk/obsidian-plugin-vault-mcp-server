# MCP resources for vault files

**Issue:** [#292](https://github.com/KingOfKalk/obsidian-plugin-mcp/issues/292)
**Date:** 2026-05-03
**Status:** Proposed

## Summary

Expose vault files as MCP resources alongside the existing tools surface, so
hosts can browse the vault and pull notes into context without driving Claude
through `vault_list` → `vault_read` round-trips. Adds two registrations:

- a static index at `obsidian://vault/index` returning a JSON tree, and
- a resource template at `obsidian://vault/{+path}` that serves any file in
  the vault as text or base64 blob.

Subscriptions, `notifications/resources/list_changed`, and per-file
`resources/list` enumeration are deferred to follow-up issues. The resource
surface ships gated by a single settings toggle (`resourcesEnabled`,
default on).

## Goals

- Surface the vault as a first-class MCP resource provider so hosts can
  attach notes without consuming tool-use turns.
- Keep the tool surface unchanged; resources are purely additive.
- Reuse `validateVaultPath` so traversal protection is shared.
- Keep code self-contained in one file (`src/server/resources.ts`) without
  widening `ModuleRegistry`.

## Non-goals

- Subscriptions (`resources/subscribe` + `notifications/resources/updated`).
  Deferred to a follow-up issue.
- `notifications/resources/list_changed`. Deferred.
- Honoring client-advertised `roots`. The vault is single-rooted; we ignore
  `roots` and document the behaviour.
- Binary files larger than 1 MiB. Hosts use `vault_read_binary` for those.
- Per-file enumeration via the `ResourceTemplate.list` callback. The static
  index covers discovery; we pass `list: undefined` to the template.
- Folding resources into `ModuleRegistry`. Possible later cleanup if/when
  prompts arrive — out of scope here.

### Known limitation

A file at vault root literally named `index` (no extension) would map to
`obsidian://vault/index` and be shadowed by the static index URI. Such
files are unusual in Obsidian (notes carry the `.md` extension) and would
not collide. If a user does have a no-extension `index` file at the vault
root, it remains reachable via the tool surface (`vault_read`) but not via
the resource template. Documented; not addressed in v1.

## Design decisions

| Decision            | Choice                                                                                                         | Rationale                                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URI scheme          | `obsidian://vault/{+path}`                                                                                     | Unambiguous vault scope; avoids confusing hosts that might try to resolve `file://` against the real filesystem. The `+` operator (RFC 6570 reserved expansion, supported by the MCP SDK's `UriTemplate`) preserves slashes in the captured variable. |
| Subscriptions in v1 | No                                                                                                             | Smaller, reviewable PR. Browse + read delivers the headline benefit. Live-tailing waits for a follow-up.                                                                                                                                              |
| Binary handling     | Text + blob, capped at 1 MiB                                                                                   | Vaults contain attachments; refusing them creates a confusing gap. The 1 MiB cap matches `vault_read_binary` so behaviour is consistent across surfaces.                                                                                              |
| Static index        | Yes, at `obsidian://vault/index`                                                                               | Single predictable URI returning a JSON tree, instead of a `resources/list` stream. Easier to consume and avoids the "list returns 50 000 entries" failure mode on large vaults.                                                                      |
| Index shape         | Flat `{ files: [{uri, name, mimeType, size}], folders: string[], truncated: boolean }`, capped at 25 000 chars | Same flat shape as `vault_list_recursive`; resource entries are self-sufficient (URI + mime ready to use). Truncation is a JSON flag, not a footer string.                                                                                            |
| `roots`             | Ignored                                                                                                        | Vault is single-rooted. Intersection checks would be brittle (path normalisation differs across platforms) and add no safety.                                                                                                                         |
| Settings toggle     | Single global `resourcesEnabled`, default `true`                                                               | Resources are one coherent feature. Per-resource toggles would be premature.                                                                                                                                                                          |
| Mime detection      | Hard-coded extension table in `resources.ts`                                                                   | ~20 entries cover Obsidian-relevant types; cheaper and more reviewable than a dependency.                                                                                                                                                             |
| File location       | `src/server/resources.ts`                                                                                      | Resources are a different MCP primitive than tools. Side-by-side at the server layer; doesn't bloat `mcp-server.ts`.                                                                                                                                  |

## Architecture

A new file `src/server/resources.ts` exports
`registerResources(server, adapter, logger)`, called from `createMcpServer`
after `registerTools` when the settings flag is on. Self-contained: it owns
the URI parser, mime table, index handler, and template handler. No changes
to `ModuleRegistry`.

```
createMcpServer(registry, settings, logger)
  ├── registerTools(server, registry, logger)        // existing
  └── if (settings.resourcesEnabled)
        registerResources(server, adapter, logger)   // new
```

`McpServer` is constructed with `capabilities.resources: {}` only when
`settings.resourcesEnabled === true`. When false, the capability is omitted
and `registerResources` is not called — the host sees a tools-only server,
identical to today.

Two registrations performed inside `registerResources`:

1. **Static index** —
   ```ts
   server.registerResource(
     'vault-index',
     'obsidian://vault/index',
     { name: 'Vault index', mimeType: 'application/json',
       description: '...' },
     indexHandler,
   );
   ```

2. **File template** —
   ```ts
   server.registerResource(
     'vault-file',
     new ResourceTemplate('obsidian://vault/{+path}', { list: undefined }),
     { name: 'Vault file', description: '...' },
     fileHandler,
   );
   ```

`list: undefined` is required by the SDK contract; we deliberately opt out
of per-file enumeration in favour of the static index.

## Components

`src/server/resources.ts` exposes `registerResources(...)` and contains five
internal pieces:

### 1. `MIME_TABLE` and `getMimeType(path: string): string`

Const map keyed by lowercase extension (with the dot). Coverage:

- Text: `.md → text/markdown`, `.txt → text/plain`, `.json → application/json`,
  `.csv → text/csv`, `.yml/.yaml → application/yaml`, `.html/.htm → text/html`,
  `.css → text/css`, `.js/.mjs → text/javascript`, `.ts → text/x-typescript`,
  `.svg → image/svg+xml` (text-serialisable XML; treated as text below).
- Binary images: `.png`, `.jpg/.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico`.
- Binary audio/video: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, `.mp4`, `.webm`, `.mov`.
- Binary documents: `.pdf`, `.zip`, `.epub`.
- Fallback: `application/octet-stream`.

`getMimeType` lowercases the extension and looks it up; returns the fallback
for unknown extensions or files without an extension.

### 2. `isTextMime(mime: string): boolean`

Returns `true` for `text/*` and exactly `application/json`. (We treat
`image/svg+xml` as text-readable: SVG is XML, hosts can render it as text or
binary; we serialise it as text to keep file size of the wire format down.
This is the only `image/*` text-classified entry, and the rule is "starts
with `text/` OR equals `application/json` OR equals `image/svg+xml`".)

### 3. `parseVaultUri(uri: URL, variables: Variables): string`

For the file template. Reads `variables.path`, validates the scheme is
`obsidian:` and host is `vault` (defence in depth — the SDK should already
have matched), calls `validateVaultPath` against `adapter.getVaultPath()`,
returns the validated relative path. Throws `PathTraversalError` on bad
input.

The path arrives already URL-decoded by the SDK's `UriTemplate` (RFC 6570
reserved expansion preserves reserved characters but the SDK still
percent-decodes the captured variable). `validateVaultPath` handles the
encoded-traversal check on the raw decoded string and rejects `\0`,
backslashes, `%2e`/`%2f`/`%5c`, and post-normalisation traversal.

### 4. `indexHandler(uri, extra): Promise<ReadResourceResult>`

Calls `adapter.listRecursive(VAULT_ROOT)` where `VAULT_ROOT` is the same
root-path convention `vault_list_recursive` uses today (`src/tools/vault/handlers.ts`
— follow whatever that handler passes; do not invent a new convention).
For each file: build
`{ uri: 'obsidian://vault/' + encodeURI(path), name: basename(path),
mimeType: getMimeType(path), size: stat(path).size ?? 0 }`. For folders:
the recursive folder list as bare strings.

Build the JSON shape `{ files, folders, truncated: false }`,
`JSON.stringify` it, and if the serialised string exceeds 25 000 chars,
drop entries from the **tail** of `files` until it fits, then re-serialise
with `truncated: true`. Folder list is preserved (it's small and structurally
useful even when files are truncated).

Returns `{ contents: [{ uri: 'obsidian://vault/index', mimeType:
'application/json', text: <serialised JSON> }] }`.

URI encoding: paths in entries use `encodeURI` (not `encodeURIComponent`)
so slashes survive — the matching `parseVaultUri` decodes them back.

### 5. `fileHandler(uri, variables, extra): Promise<ReadResourceResult>`

Steps:

1. `path = parseVaultUri(uri, variables)` — throws `PathTraversalError` on
   bad input.
2. `mime = getMimeType(path)`.
3. If `isTextMime(mime)`:
   - `text = await adapter.readFile(path)`.
   - Return `{ contents: [{ uri: uri.toString(), mimeType: mime, text }] }`.
4. Else (binary):
   - `stat = await adapter.stat(path)`. If `stat === null`, throw
     `NotFoundError` (matches the existing tool behaviour).
   - If `stat.size > 1 MiB` (1 048 576 bytes), throw
     `BinaryTooLargeError` (new typed error, see below).
   - `data = await adapter.readBinary(path)`.
   - `blob = Buffer.from(data).toString('base64')`.
   - Return `{ contents: [{ uri: uri.toString(), mimeType: mime, blob }] }`.

We do **not** add a `handleResourceError` wrapper. Thrown errors propagate
to the SDK, which maps them into the standard `resources/read` error
envelope using `error.message`.

### `BinaryTooLargeError` (new)

`src/tools/shared/errors.ts` already houses `NotFoundError`,
`PermissionError`, `FolderNotFoundError`, etc. Today, the 1 MiB cap in
`vault_read_binary` is implemented inline as a string `errorResult`. To
share the cap between tools and resources, this design adds:

```ts
export class BinaryTooLargeError extends Error {
  constructor(public readonly sizeBytes: number, public readonly limitBytes: number) {
    super(
      `Binary file too large (${sizeBytes} bytes, limit ${limitBytes}). ` +
      `Fetch the file out-of-band or use a chunked read when available.`,
    );
    this.name = 'BinaryTooLargeError';
  }
}
```

`vault_read_binary` is updated to throw this and let `handleToolError` render
it; `resources.ts` throws the same type. Behaviour for tool callers is
unchanged (same message text).

## Data flow

### `resources/read` for `obsidian://vault/notes/foo.md`

```
SDK matches template → variables.path = "notes/foo.md"
  → fileHandler(uri, variables, extra)
     → parseVaultUri → validateVaultPath("notes/foo.md", vaultPath)
        → returns "notes/foo.md"
     → getMimeType("notes/foo.md") → "text/markdown"
     → isTextMime → true → adapter.readFile("notes/foo.md")
     → return { contents: [{ uri, mimeType: "text/markdown", text }] }
```

### `resources/read` for `obsidian://vault/attachments/img.png`

```
SDK matches template → variables.path = "attachments/img.png"
  → fileHandler(uri, variables, extra)
     → parseVaultUri → "attachments/img.png"
     → getMimeType → "image/png"
     → isTextMime → false
     → adapter.stat → { size: 12345 }; under 1 MiB
     → adapter.readBinary → ArrayBuffer
     → base64 encode
     → return { contents: [{ uri, mimeType: "image/png", blob }] }
```

### `resources/read` for `obsidian://vault/index`

```
SDK matches static URI → indexHandler(uri, extra)
  → adapter.listRecursive("/")
  → for each file: { uri, name, mimeType, size }
  → JSON.stringify; if > 25 000 chars, drop tail of files, set truncated: true
  → return { contents: [{ uri, mimeType: "application/json", text }] }
```

### Bad URI (traversal)

```
fileHandler("obsidian://vault/../etc/passwd")
  → parseVaultUri → validateVaultPath throws PathTraversalError
  → SDK maps thrown error to resources/read error response
```

## Settings

### Schema change

`McpPluginSettings` gains:

```ts
/** When true, the server exposes vault files as MCP resources in addition to tools. */
resourcesEnabled: boolean;
```

`DEFAULT_SETTINGS.resourcesEnabled = true`.

### Migration

`src/settings/migrations.ts` adds a v10 → v11 step:

- Bump `schemaVersion` from 10 to 11.
- Set `resourcesEnabled: true` if the field is missing (existing installs
  opt in by default).

### UI

`src/settings/server-section.ts` gains one toggle:

- Label: "Expose vault files as MCP resources" (en string;
  translatable).
- Description: "When on, hosts can browse and read vault files via the
  MCP resources surface in addition to the tools. Restart the server
  to apply changes."
- Bound to `settings.resourcesEnabled` with `saveSettings` on change,
  same pattern as other server-section toggles.

A server restart is required for the change to take effect — same as other
server-affecting settings today; no special handling beyond the existing
"restart the server" hint.

## Testing

New file: `tests/server/resources.test.ts`. Tests use mock `ObsidianAdapter`
instances built with the project's existing patterns (see
`tests/__mocks__/obsidian.ts` and tool tests).

### URI parsing & path-guard reuse

- Plain path → returns the validated relative path.
- URL-encoded spaces (`My%20Notes/foo.md`) → decoded, validates.
- Unicode path (`Notizen/Übersicht.md`) → handled.
- Traversal (`../etc/passwd`) → `PathTraversalError`.
- Encoded traversal (`..%2F..`) → rejected.
- Wrong scheme (`file:///foo.md`) → rejected.
- Wrong host (`obsidian://other/foo.md`) → rejected.
- Empty path → rejected.

### Mime-type selection

- `.md → text/markdown`, text.
- `.txt → text/plain`, text.
- `.json → application/json`, text.
- `.png → image/png`, binary.
- `.pdf → application/pdf`, binary.
- `.svg → image/svg+xml`, text.
- Unknown extension → `application/octet-stream`, binary.

### File handler — text

- Reads `notes/foo.md` → one `TextResourceContents`, `text/markdown`,
  UTF-8 content.
- File not found → propagates `NotFoundError`.

### File handler — binary

- Reads `attachments/img.png` (1 KB) → one `BlobResourceContents`, base64
  of raw bytes, `image/png`.
- File at exactly 1 MiB → served.
- File over 1 MiB → `BinaryTooLargeError`.
- `adapter.stat === null` → `NotFoundError`.

### Index handler

- Small vault (3 files, 1 folder) → JSON with `files`, `folders`,
  `truncated: false`. Each `uri` is `obsidian://vault/<encoded path>`.
- Large vault serialising past 25 000 chars → entries dropped from tail,
  `truncated: true`.
- Empty vault → `{ files: [], folders: [], truncated: false }`.
- Round-trip: feeding each `entry.uri` back into `parseVaultUri` yields the
  original path.

### Settings-toggle gating

- `createMcpServer` with `resourcesEnabled: false` → server capabilities
  exclude `resources`; no resource registrations performed.
- `resourcesEnabled: true` → both `vault-index` and `vault-file` registered.

### Settings migration

- v10 settings (no `resourcesEnabled`) → migrated to v11,
  `resourcesEnabled: true`.
- v11 settings with explicit `false` → preserved.

### `BinaryTooLargeError` — tool path unchanged

- Existing `vault_read_binary` test for over-cap files still passes; the
  rendered error message string is identical to today.

### Integration smoke test

One test in `tests/server/mcp-server.test.ts` (or co-located): an
end-to-end `resources/read` round-trip via the in-memory MCP transport,
confirming SDK wiring actually surfaces both the index and a file by URI.

## Documentation

CLAUDE.md rule 5 requires the user manual to stay in sync with user-facing
surface changes.

- `docs/help/en.md` — add a "Resources" section under the MCP surface
  description, covering:
  - The `obsidian://vault/index` URI and what it returns.
  - The `obsidian://vault/{path}` URI template.
  - The 1 MiB binary cap.
  - The `resourcesEnabled` settings toggle.
  - Brief: most users won't see this directly; their host UI does.
- Sibling locale files — same section translated where translations exist.
- `docs/tools.generated.md` — **no change.** Resources don't live in the
  tool registry, so the generator output is unaffected. Verify by running
  `npm run docs:tools` and confirming a clean diff.

## Files added / modified

### Added

- `src/server/resources.ts`
- `tests/server/resources.test.ts`

### Modified

- `src/server/mcp-server.ts` — declare `resources: {}` capability when
  `settings.resourcesEnabled === true`; call `registerResources(...)` after
  `registerTools(...)`. `createMcpServer` signature gains the adapter and
  settings (or just the boolean flag) — see implementation plan for the
  exact shape.
- `src/main.ts` — pass adapter and resources flag into `createMcpServer`.
- `src/types.ts` — add `resourcesEnabled: boolean` to `McpPluginSettings`;
  add it to `DEFAULT_SETTINGS` as `true`.
- `src/settings/migrations.ts` — v10 → v11 step.
- `src/settings/server-section.ts` — one new toggle.
- `src/lang/en.ts` (and other locale files where translations exist) —
  strings for the new toggle and any user-facing copy.
- `src/tools/shared/errors.ts` — add `BinaryTooLargeError`.
- `src/tools/vault/handlers.ts` — `readBinary` throws
  `BinaryTooLargeError` instead of returning a string `errorResult`.
- `docs/help/en.md` (and locale siblings) — Resources section.

## Verification

- `npm run lint`, `npm run typecheck`, `npm test` all green.
- `npm run docs:tools` produces no diff.
- Manual smoke test: start server, run `initialize` followed by
  `resources/read` for `obsidian://vault/index` and a known file URI;
  confirm both return the expected shape and that `resourcesEnabled: false`
  causes the capability to disappear.
