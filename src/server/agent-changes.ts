/**
 * Agent-relevant changes per plugin version, returned by the `server_info`
 * tool (#402). Hand-maintained and newest first.
 *
 * Only list what changes how an agent calls the tools or reads their
 * results: new or removed tools, renamed parameters or output fields,
 * changed defaults or validation. This is not the CHANGELOG — leave out
 * fixes, docs, CI and dependency bumps.
 *
 * `version` is the release that shipped the change. A change that is not
 * released yet goes under the version release-please will cut next (a
 * `feat:` bumps the minor version).
 */
export interface AgentChangeEntry {
  version: string;
  notes: string[];
}

export const AGENT_CHANGES: readonly AgentChangeEntry[] = [
  {
    version: '4.1.0',
    notes: [
      '`search_resolved_links` and `search_unresolved_links` are paged: `limit` (default 50, max 100) and `offset` over source notes, with `total`, `count`, `offset`, `hasMore` and `nextOffset`; `path` returns one note\'s links. `search_unresolved_links` leaves out notes without broken links. Before, both returned the whole vault.',
      '`vault_get_aspect` with `aspect: "backlinks"` is paged: `limit` (default 50) and `offset` over the linking files, with `total`, `hasMore` and `nextOffset`; `includeContext` applies to the page.',
      '`vault_list` takes `limit` (default 100) and `offset` (folders first, then files) and adds `total`, `count`, `offset`, `hasMore` and `nextOffset`. `vault_list_recursive` pages `folders` with the same offset as the files and adds `folderTotal`; keep calling while `hasMore` is true.',
      '`editor_get_content` returns windows of up to `length` characters (default 24000) from `offset`, like `vault_read`, with `totalLength`, `offset`, `hasMore` and `nextOffset`.',
      'Results never exceed 25000 characters: a page holds fewer items than `limit` instead of cut text, so continue at `nextOffset` (also `search_fulltext`, whose JSON text used to be cut). `plugin_dataview_query` returns the first whole lines and `truncated: true`; `workspace_get_layout` shortens its longest lists and sets `truncated: true`. Any other text over the limit ends with "[TRUNCATED: Response exceeded 25000 characters. …]".',
      'Paths inside the vault\'s config folder (usually `.obsidian`, any case) are rejected by every tool, prompt and resource, also as the destination of rename, move or copy, with "Path is inside the Obsidian config folder (.obsidian); it cannot be read or written". `vault_list`, `vault_list_recursive` and the `obsidian://vault/index` resource leave the folder out.',
      '`obsidian://vault/{+path}` resources work on Obsidian 1.5.3 (they failed with "Unexpected host") and percent-decode the path, so the URIs from `obsidian://vault/index` read files with spaces or non-ASCII names; query and fragment are ignored.',
      '`workspace_open_file` applies `mode` ("source" = Source mode, "live" = Live Preview, "preview" = Reading view); it used to be ignored. The file opens in the active leaf (a new tab if that leaf is pinned); a missing file fails with "File not found".',
      '`vault_append` starts the appended text on a new line: if the file is not empty, does not end with a line break and `content` does not start with one, one line break (the file\'s LF or CRLF) is added first. Its result adds `modified`.',
      '`vault_create`, `vault_update`, `vault_write_binary` and `template_create_from` results add `modified` (ISO-8601), usable as the next `expectedMtime`.',
      '`vault_read` with `responseFormat: "json"`: the JSON text is always valid and complete; a window can be shorter than `length` so it fits, so continue at `nextOffset`. `content` is the last field.',
      '`vault_get_aspect` with `aspect: "backlinks"` fails with "File not found" for a missing path instead of returning no backlinks.',
      '`vault_rename` and `vault_move` on a folder count links to the files inside it in `linksUpdated` / `updatedFiles` and set `warning` like `vault_rename_folder`; the confirmation text says "folder".',
      '`vault_set_frontmatter` is annotated destructive (`destructiveHint: true`).',
      'The server instructions leave out hints about tools that are switched off.',
      'The tool list can change during a session: when the user switches a module or tool on or off, `tools/list` follows right away and the server sends `notifications/tools/list_changed`. Calls to a tool that was switched off fail with "Tool <name> disabled"; re-read `tools/list` after the notification.',
      'Tool descriptions corrected (behaviour unchanged): an editor range ends before (toLine, toCh), so a range within one line has toLine = fromLine; `vault_list` returns full vault-relative paths; `search_fulltext` searches Markdown note text only (not file names); `plugin_execute_command` runs only ids on the user\'s allowlist; rename/move/copy/folder tools document their real errors ("Path not found", "Destination already exists"); `vault_rename` `newName` needs the extension.',
      'Smaller schemas in `tools/list` (validation unchanged): no `$schema`, no ±2^53-1 integer bounds, no `propertyNames: {type: "string"}`, no `annotations.title` (use the tool\'s `title`); output schemas leave out descriptions and `additionalProperties: false`.',
      'Shorter tool and parameter descriptions (behaviour unchanged): the full path rule and the "No active editor" error are stated once in the server instructions, and parameter texts no longer repeat ranges and defaults the schema states.',
      'The `fix-broken-links` prompt edits links with `vault_replace` instead of `vault_read` + `vault_update`, and creates stubs at a file path with `.md`.',
      '`server_info` returns the changes of the 3 most recent versions plus `olderVersionsOmitted`; pass `allChanges: true` for every version.',
      '`search_fulltext` markdown text shows the matching lines under each file as "<line>: <text>" (1-based, cut at 200 characters) and how many were left out; JSON and `structuredContent` are unchanged.',
      '`search_by_tag` / `search_by_frontmatter` headers pluralise "file" and echo the tag or value verbatim ("4 files tagged #project", not "4 file tagged #projects").',
      'Error texts: a missing path whose `.md` twin exists adds "Did you mean <path>.md?" ("File not found" / "Path not found"); renaming, moving or copying onto a taken path fails with "Destination already exists: <path>. Choose another path or delete it first; nothing was changed." instead of "Destination file already exists!" / "EEXIST"; "No active editor" names `workspace_open_file` and the `vault_*` tools; invalid base64 with whitespace says so (often a trailing newline).',
      '`plugin_list`, `plugin_check`, `plugin_dataview_query` and the two describe tools are annotated `openWorldHint: false`.',
    ],
  },
  {
    version: '4.0.1',
    notes: [
      '`search_by_tag` and `search_tags` include tags from the frontmatter (`tags` / `tag`, as a list or a comma/space separated string), not only inline `#tags`. `counts` counts frontmatter and inline occurrences; each file is still listed once per tag.',
      '`vault_rename`, `vault_move` and `vault_rename_folder` no longer wait for Obsidian\'s "Update links" prompt when "Automatically update internal links" is off or unreadable (`autoUpdateLinks` false or null): the call returns right away, links are not updated, and the result carries `linksUpdated: 0` and the `warning` as before. Previously the call hung until someone answered the prompt.',
    ],
  },
  {
    version: '4.0.0',
    notes: [
      'Breaking: `vault_daily_note` no longer creates the note by default (`create` now defaults to false). Without `create: true` a missing note is not created and the result is `{ path, created: false, exists: false }` without `content`. Pass `create: true` to create a missing note from the template as before.',
      'Breaking: the deprecated parameter alias `response_format` is removed. Use `responseFormat`; `response_format` now fails with "Unknown parameter: response_format" like any other unknown parameter.',
    ],
  },
  {
    version: '3.5.0',
    notes: [
      'New tool `vault_insert`: insert `text` at the `start` or `end` (default) of the section under `heading` ("Log", or "## Log" to pin the level) without rewriting the file. Takes optional `expectedMtime`; returns `{ path, heading, position, line, modified }`. A missing or ambiguous heading fails with the available headings or the matches and their line numbers; nothing is written.',
      '`vault_read` takes optional `heading`: returns only that section (heading line up to the next heading of the same or a higher level), paged with `offset`/`length` within the section; the result adds `heading` and `line`.',
      '`vault_replace` takes `edits: [{ oldString, newString, replaceAll? }]` as an alternative to `oldString`/`newString` (exactly one form per call). All edits are matched against the file before the call, must not overlap, and are written together or not at all; an error names the failing edit as `edits[i]` with its match count. The multi-edit result is `{ path, replacements, edits: [{ index, replacements }], modified }`; the single-edit result is unchanged.',
      '`vault_set_frontmatter` takes optional `expectedMtime` (same semantics as the other write tools) and its result adds `modified`.',
      '`vault_rename`, `vault_move` and `vault_rename_folder` results add `linksUpdated`, `updatedFiles`, `autoUpdateLinks` (the "Automatically update internal links" setting, or null if unreadable) and, when other files link to the moved item but were not updated, `warning`.',
      '`vault_delete` and `vault_delete_folder` results add `trashedTo`: `"system"`, `"vault"` (the `.trash` folder), `"permanent"` or `"unknown"`.',
      '`template_create_from` takes optional `frontmatter` (object of keys to set on the new note, `.md` only); the result then includes the note\'s whole `frontmatter`.',
      '`search_tags` lists each file once per tag and adds `counts` (total occurrences per tag). `search_by_tag` lists each file once.',
      '`plugin_dataview_query`: list values in TABLE cells are plain text (`a, b`) instead of HTML `<ul><li>` markup.',
      'The MCP handshake `serverInfo.name` is now `vault-mcp-server` (was `obsidian-mcp-server`), matching the instructions and `server_info`.',
    ],
  },
  {
    version: '3.3.0',
    notes: [
      '`vault_delete` and `vault_delete_folder` follow the user\'s "Deleted files" setting (system trash, `.trash` folder, or permanent) instead of always deleting for good.',
      '`vault_rename`, `vault_move` and `vault_rename_folder` update links to the moved file when the user enabled "Automatically update internal links".',
      '`vault_create`, `vault_copy`, `vault_move`, `vault_write_binary` and `template_create_from` create missing parent folders instead of failing.',
      'Error messages no longer contain absolute filesystem paths; vault paths are vault-relative, other paths read `<path>`.',
      '`search_by_frontmatter`: a list property matches when any element equals `value`.',
      'New tool `vault_replace`: replace an exact passage in a file (`oldString` must match once unless `replaceAll`); returns `replacements` and the new `modified`.',
      '`vault_update`, `vault_append`, `vault_replace` and `vault_write_binary` take optional `expectedMtime`; if the file changed since, nothing is written and the error reports the current mtime.',
      '`vault_read` structured output now includes `modified` (ISO-8601) to pass back as `expectedMtime`.',
      'New tool `vault_set_frontmatter`: set (`set`) and delete (`remove`) frontmatter keys of a Markdown note via Obsidian, without rewriting the file. Returns `{ path, frontmatter }`.',
      '`vault_daily_note` takes `create` (default true). With `create: false` a missing note is not created and the result is `{ path, created: false, exists: false }` without `content`. Every result now carries `exists`. The default changed to false in 4.0.0.',
      '`vault_get_aspect` with `aspect: "backlinks"` takes `includeContext` (default false). When true the result adds `backlinkContext`: per linking file, the 1-based `line` and `text` of each line that links to the note.',
    ],
  },
  {
    version: '3.2.0',
    notes: [
      'New tool `server_info`: plugin version, enabled modules and this change list. The server instructions now start with the version.',
    ],
  },
  {
    version: '3.1.4',
    notes: [
      'All tool parameters and output fields are camelCase.',
      'Parameter `response_format` is now `responseFormat`. `response_format` was accepted as a deprecated alias until 4.0.0.',
      'Output fields renamed: `has_more` → `hasMore`, `next_offset` → `nextOffset`, `total_length` → `totalLength`, `size_bytes` → `sizeBytes`.',
    ],
  },
  {
    version: '3.1.3',
    notes: [
      'Unknown arguments are rejected with an error that names them and lists the valid parameters.',
      '`vault_read` pages large files with `offset`/`length` (characters).',
      '`vault_list` and `vault_list_recursive` accept "", "/" and "." as the vault root.',
      '`search_fulltext` takes `maxMatchesPerFile` (default 5, max 100) and reports a per-file `matchCount`.',
      '`search_by_frontmatter`: `value` is optional; without it every file that has the key matches.',
      'Write tools return a small `structuredContent` next to their text confirmation.',
    ],
  },
];
