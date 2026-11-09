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
