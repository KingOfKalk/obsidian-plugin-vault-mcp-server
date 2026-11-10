import type { CallToolResult } from '@modelcontextprotocol/server';
import { handleToolError } from './errors';

/** What a handler body may return: a result, sync or async. */
export type HandlerResult = CallToolResult | Promise<CallToolResult>;

/**
 * Where `safeHandler` keeps the error it caught on the result (#540): a
 * non-enumerable symbol, so it is neither serialised nor copied by a
 * spread and never reaches the client.
 */
const CAUGHT_ERROR = Symbol('caughtError');

type WithCaughtError = CallToolResult & { [CAUGHT_ERROR]?: unknown };

/**
 * The error `safeHandler` turned into `result`, or `undefined` when the
 * handler returned `result` itself. Lets the dispatcher log a crash it no
 * longer sees thrown (#540).
 */
export function caughtError(result: CallToolResult): { error: unknown } | undefined {
  return Object.prototype.hasOwnProperty.call(result, CAUGHT_ERROR)
    ? { error: (result as WithCaughtError)[CAUGHT_ERROR] }
    : undefined;
}

/**
 * Wrap a handler body (#532): a sync or async result becomes a promise, and
 * anything it throws becomes `handleToolError`'s `isError` result, so the
 * body needs neither `try`/`catch` nor `Promise.resolve`. The dispatcher
 * catches too; this keeps the shape for callers that call a handler
 * directly (tests, `vault_get_aspect`). The caught error stays on the
 * result for the dispatcher's log (see {@link caughtError}).
 */
export function safeHandler<A extends unknown[]>(
  fn: (...args: A) => HandlerResult,
): (...args: A) => Promise<CallToolResult> {
  return async (...args: A): Promise<CallToolResult> => {
    try {
      return await fn(...args);
    } catch (error) {
      return Object.defineProperty(handleToolError(error), CAUGHT_ERROR, { value: error });
    }
  };
}

type AsyncHandler = (...args: never[]) => Promise<CallToolResult>;

/** `H` with a result that may also be sync. */
type HandlerBody<H> = H extends (...args: infer A) => Promise<CallToolResult>
  ? (...args: A) => HandlerResult
  : never;

/**
 * {@link safeHandler} over every handler of an object. Name the result
 * type (`safeHandlers<VaultHandlers>({...})`) so the bodies' parameters are
 * typed from it.
 */
export function safeHandlers<T extends { [K in keyof T]: AsyncHandler }>(
  bodies: { [K in keyof T]: HandlerBody<T[K]> },
): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, body] of Object.entries<(...args: unknown[]) => HandlerResult>(bodies)) {
    wrapped[name] = safeHandler(body);
  }
  return wrapped as T;
}
