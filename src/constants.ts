/**
 * Maximum characters a single tool response should emit before we truncate
 * and inform the caller. Picked to leave plenty of headroom in a model's
 * context window while still letting common reads/searches fit unchanged.
 */
export const CHARACTER_LIMIT = 25_000;

/**
 * Maximum bytes a binary vault read will return in a single call. Larger
 * files are refused with a clear error so callers know to fetch the file
 * out-of-band (or chunk once chunked reads land).
 */
export const BINARY_BYTE_LIMIT = 1_048_576; // 1 MiB

/** Public GitHub repository of the plugin. */
export const REPOSITORY_URL =
  'https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server';

/** GitHub "new issue" page, derived from {@link REPOSITORY_URL}. */
export const NEW_ISSUE_URL = `${REPOSITORY_URL}/issues/new`;

/**
 * The one URL path that serves MCP, as shown in the settings tab, the
 * client config snippet, the README and the user manual. The query string
 * is ignored. Every other path, `/` and `/mcp/` included, answers 404.
 */
export const MCP_ENDPOINT_PATH = '/mcp';
