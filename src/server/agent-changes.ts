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
    version: '5.2.0',
    notes: [
      'New user setting "Read and edit only" (off by default). While on, `vault_delete`, `vault_delete_folder`, `vault_update` and `vault_write_binary` are not listed, and a call fails with "Tool <name> disabled" (or "not found"). It switches live with `notifications/tools/list_changed`. Edit in place instead (`vault_replace`, `vault_insert`, `vault_append`, `vault_set_frontmatter`); if the user wants a file deleted or replaced, ask them to do it or to switch the setting off.',
      '`template_expand` and `template_create_from`: `{{date:FORMAT}}` and `{{time:FORMAT}}` use `variables.date` when it is a `YYYY-MM-DD` date and `variables.time` when it is a 24-hour `HH:mm` or `HH:mm:ss` time (was always now), so `{{date:dddd}}` matches `{{date}}`. Other values are ignored and the current date or time is used. A variable named like the whole placeholder (e.g. `"date:dddd"`) still wins.',
      '`vault_daily_note` without `create: true` on a missing note: the text says the note is not at `path` (from the Daily notes settings) and may exist elsewhere; check with `search_by_name` (e.g. the date) before `create: true`. It no longer says "Call again with create=true".',
      '`heading` in `vault_read` and `vault_insert` also matches Obsidian\'s `#heading` link form when no heading has the exact text: punctuation and link brackets count as spaces, case is ignored, and a leading `#` is allowed. So `"2026-11-10 - Call"` (from `[[Note#2026-11-10 - Call]]`) finds `### [[2026-11-10]] - Call`. Several such matches are an error, as with duplicate headings.',
      '`vault_insert` takes `replacePlaceholder` (default `false`): when the section\'s only non-blank line (subsections included) is an empty list item (`-`, `*`, `+`, `1.`, `1)`, `- [ ]`), the text replaces that line instead of following it, whatever `position` is; the result then adds `replacedPlaceholder: true`. Otherwise nothing changes. Use it to fill a template section that holds only `-`.',
    ],
  },
  {
    version: '5.1.0',
    notes: [
      '`vault_get_aspect` with `aspect: "outgoing_links"` or `"embeds"`: each entry adds `path`, the vault path Obsidian resolves the link to from this note (pass it to `vault_read`; `null` when unresolved or inside the config folder), and `subpath`, the `#Heading` or `#^block` part when present. `link` is unchanged.',
      'Template placeholders `{{date:FORMAT}}` and `{{time:FORMAT}}` are expanded with a moment.js format (e.g. `{{date:dddd}}`), like Obsidian, in `template_expand`, `template_create_from` and `vault_daily_note`; an empty format gives `YYYY-MM-DD` / `HH:mm`. A variable named like the whole placeholder (e.g. `"date:dddd"`) still overrides it. In `vault_daily_note` they use the note\'s date, and `{{time}}` is the current time (was `00:00` for another day).',
      '`vault_daily_note` adds the `modified` header line (ISO-8601, as in `vault_read`) when the note exists or was just created; pass it as `expectedMtime` to the next write.',
      'Every paged tool has the same page size: `limit` defaults to 50 (max 100) in `search_fulltext`, `search_tags`, `search_by_tag`, `search_by_frontmatter`, `search_resolved_links`, `search_unresolved_links`, `vault_list`, `vault_list_recursive` and `vault_get_aspect` backlinks. Before, it was 20 for `search_by_tag`, `search_by_frontmatter`, `search_fulltext` and `vault_list_recursive`, and 100 for `vault_list` and `search_tags`. Their descriptions state the rule in a `Paging:` line; while `hasMore` is true, call again with `offset` = `nextOffset`.',
      '`search_by_frontmatter` items are `{ path, value }` objects, no longer path strings; `value` is the note\'s value of `key` as parsed from YAML (string, number, boolean, null, list or object). A value over 1000 characters is cut to its first 1000 (of its JSON for a list or object) and the item adds `valueTruncated: true`. New `match: "exact" | "prefix"` (default `exact`): with `prefix`, a string, number or boolean (or any list element) matches when its text starts with `value`, case-sensitive, e.g. `value: "2025-07"` for July 2025 dates.',
      '`search_unresolved_links` adds `groupBy: "source" | "target"` (default `source`, unchanged). With `target` it returns `targets`, one item per missing link target `{ target, count, sourceCount, sources }`, sorted by `count` desc then `target`, paged with `limit`/`offset`; `sources` lists at most 10 linking notes (sorted), `sourceCount` all of them. `path` still narrows to one source note.',
      'New tool `search_by_name`: find files of any type by name or path. `query` is a case-insensitive substring of the path, or a glob with `*`/`?` (without `/` matched against the file name, e.g. "*Atlas*.md"; with `/` against the whole path, e.g. "notes/**/*.pdf"). Optional `folder` limits the search; results are sorted by path and paged with `limit`/`offset` like `search_by_tag`. The server instructions point to it instead of `vault_list_recursive` for finding a note by name.',
      '`search_fulltext` takes an optional `folder` (only notes in that folder and its subfolders; same rules as in `search_by_name`) and `lastMatches: true`, which returns the last `maxMatchesPerFile` matches of each file instead of the first (e.g. the newest rows of a log), still in line order.',
    ],
  },
  {
    version: '5.0.0',
    notes: [
      'Breaking: document tools return plain text. `vault_read`, `vault_daily_note`, `editor_get_content`, `template_expand` and `plugin_dataview_query` return one text block: `key: value` header lines (e.g. `path`, `modified`, `totalLength`, `offset`, `hasMore`, `nextOffset`), a blank line, then the raw text, not JSON-escaped. They have no `structuredContent` or `outputSchema` any more; read `modified` and `nextOffset` from the header.',
      'Breaking: every other tool returns `structuredContent`, and its text is the same data as compact JSON. Write tools no longer return a sentence such as "Created file: a.md", and list and search tools no longer return Markdown lists.',
      'Breaking: `responseFormat` is removed from every tool; sending it fails with "Unknown parameter: responseFormat".',
      'Breaking: `vault_read_binary` returns an `image` block for images, an `audio` block for audio and an embedded `resource` (base64 `blob`, `obsidian://vault/` URI) for other files, after a short text header (`path`, `mimeType`, `sizeBytes`). The base64 is no longer sent as text or `structuredContent`.',
      '`search_fulltext` items add `lines` (1-based line numbers of `matches`); a match no longer ends with "\\r" in a CRLF note. `vault_daily_note` returns at most 24000 characters of a note; continue with `vault_read`.',
      'Breaking: `search_by_tag` matches tags case-insensitively and includes nested tags, like Obsidian\'s tag search: "project" finds `#project`, `#Project` and `#project/alpha` (not `#projects`). Results are sorted by path.',
      'Breaking: `search_tags` merges tags that differ only in case into one entry, keyed by the most common spelling; their counts are combined. Nested tags keep their own entries.',
      'Breaking: template placeholders: `{{title}}` is the new file\'s name without `.md` in `template_create_from` (was "Untitled"); `template_expand` leaves `{{title}}` as written unless `variables.title` is given. `{{date}}` is the local date (`YYYY-MM-DD`, was UTC) and `{{time}}` the local time (`HH:mm`, was locale-dependent), the same as in `vault_daily_note`.',
      'Breaking: `template_list` lists the folder set in Obsidian\'s core Templates plugin (`templates` if none is set), including subfolders, and adds `folder` to its result. Before, it listed only the files directly in `templates`.',
      '`vault_daily_note` with `create: true` adds a `warning` header line when the template set in the Daily notes plugin does not exist; the note is still created empty. A template set without `.md` is found.',
      'Breaking: the `editor_*`, `workspace_*` and `ui_*` tools are off by default in new installs; existing installs keep their module switches. If they are missing, ask the user to switch on the module in the plugin settings, or use the `vault_*` tools on the file instead.',
      'Breaking: `search_tags` returns counts, not files: `tags` maps each tag to `{ files, occurrences }` (number of files using it, total uses); the file lists and `counts` are gone. Tags are sorted by name and paged with `limit` (default 100) / `offset`, with `total`, `count`, `offset`, `hasMore` and `nextOffset`. Use `search_by_tag` for the files of a tag.',
      'Breaking: `plugin_dataview_describe_js_query` and `plugin_templater_describe_template` are removed; they only returned their input. DataviewJS and Templater are still never executed; read a template with `vault_read`.',
      'Breaking: `vault_get_aspect` with `aspect: "block_references"` returns `blockRefs` entries as `{ id, text }`; `line` is renamed to `text` (the text of the line, not a line number).',
      'Breaking: `vault_rename_folder` is removed. Use `vault_move` (same `path` and `newPath`) or `vault_rename` (`newName`) on the folder; the result, link report, `warning` and errors are the same.',
      'Breaking: `plugin_dataview_query` is listed only while the Dataview plugin is enabled, and `plugin_execute_command` only while the user\'s command allowlist has an entry. Both come and go during a session with `notifications/tools/list_changed`; a call while unlisted fails with "Tool <name> disabled" or "Tool <name> not found".',
    ],
  },
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
