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
