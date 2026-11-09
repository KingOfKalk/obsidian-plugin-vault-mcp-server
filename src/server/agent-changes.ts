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
    version: '3.3.0',
    notes: [
      '`vault_delete` and `vault_delete_folder` follow the user\'s "Deleted files" setting (system trash, `.trash` folder, or permanent) instead of always deleting for good.',
      '`vault_rename`, `vault_move` and `vault_rename_folder` update links to the moved file when the user enabled "Automatically update internal links".',
      '`vault_create`, `vault_copy`, `vault_move`, `vault_write_binary` and `template_create_from` create missing parent folders instead of failing.',
      'Error messages no longer contain absolute filesystem paths; vault paths are vault-relative, other paths read `<path>`.',
      '`search_by_frontmatter`: a list property matches when any element equals `value`.',
      '`vault_daily_note` takes `create` (default true). With `create: false` a missing note is not created and the result is `{ path, created: false, exists: false }` without `content`. Every result now carries `exists`. The default may change to false in the next major release.',
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
      'Parameter `response_format` is now `responseFormat`. `response_format` is still accepted as a deprecated alias until the next major release.',
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
