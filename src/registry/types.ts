import { z } from 'zod';
import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export type { ToolAnnotations };

/**
 * Inferred parameter type for a handler whose schema is `Shape`.
 *
 * Uses `z.input` (not `z.output`/`z.infer`) so fields with `.default()` are
 * **optional** in the handler's signature. That matches the ergonomics of
 * direct test calls (where the test author doesn't want to thread every
 * default) and mirrors the shape of the `rawParams` the dispatcher sees
 * before `.parse()` fills in defaults.
 *
 * At runtime the dispatcher always resolves defaults before invoking the
 * handler, so any field with a default is never actually `undefined`. Use
 * `?? <default>` at the call site when you want to read such a field
 * directly — keeps the type honest both pre- and post-parse.
 */
export type InferredParams<Shape extends z.ZodRawShape> = z.input<
  z.ZodObject<Shape>
>;

/**
 * A tool's public contract. Generic over `Shape` so each handler can be
 * typed against its own schema. `tools(): ToolDefinition[]` erases the
 * generic at the module boundary — the dispatcher then treats every
 * `handler` uniformly via the `TypedHandler` alias below.
 */
export interface ToolDefinition<
  Shape extends z.ZodRawShape = z.ZodRawShape,
> {
  name: string;
  /**
   * Human-readable title used by hosts in confirmation / auto-approve UI.
   * Sentence case, no module prefix, ≤40 characters. See spec
   * `docs/superpowers/specs/2026-05-03-tool-titles-and-sibling-cross-refs-design.md`.
   */
  title: string;
  description: string;
  schema: Shape;
  /**
   * Optional Zod raw shape describing the `structuredContent` payload the
   * handler emits. Forwarded to `McpServer.registerTool` so modern clients
   * can validate / introspect the typed output. Tools that don't emit a
   * `structuredContent` slot (e.g. plain-text confirmations or binary
   * payloads) MUST leave this undefined — the MCP SDK requires that any
   * call returning a tool with `outputSchema` declared also carry
   * `structuredContent` matching that schema.
   */
  outputSchema?: z.ZodRawShape;
  handler: TypedHandler<Shape>;
  annotations: ToolAnnotations;
}

export type TypedHandler<Shape extends z.ZodRawShape> = (
  params: InferredParams<Shape>,
) => Promise<CallToolResult>;

/**
 * Define a single tool with full schema-driven type-checking on its handler
 * — `schema` infers `Shape`, then `handler`'s `params` is typed as
 * `z.infer<z.ZodObject<Shape>>`. Returns the erased `ToolDefinition` so
 * modules can collect mixed-shape tools into a single array.
 *
 * Callers that want a handler defined in a separate factory (e.g.
 * `createHandlers()`) can keep the untyped signature and pass the
 * function here — TS still checks the schema and the handler's return
 * type. The generic form below is the preferred one for new code.
 */
export function defineTool<Shape extends z.ZodRawShape>(
  def: ToolDefinition<Shape>,
): ToolDefinition {
  return def as unknown as ToolDefinition;
}

/**
 * Shared annotation presets for tool categories. Pure reads default to
 * `readOnlyHint + idempotentHint` with a closed domain; writes default to
 * `destructiveHint` with a closed domain. Tools that interact with external
 * plugins or arbitrary Obsidian commands opt into `openWorldHint`.
 */
export const annotations = {
  read: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  readExternal: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  additive: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  destructive: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  destructiveIdempotent: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  destructiveExternal: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const satisfies Record<string, ToolAnnotations>;

export type ModuleGroup = 'extras';

export interface ModuleMetadata {
  id: string;
  name: string;
  description: string;
  group?: ModuleGroup;
  defaultEnabled?: boolean;
}

export interface ToolModule {
  metadata: ModuleMetadata;
  tools(): ToolDefinition[];
}

export interface ModuleRegistration {
  module: ToolModule;
  enabled: boolean;
  /** Per-tool enabled state, keyed by tool name. Only used for modules in the 'extras' group. */
  toolStates: Record<string, boolean>;
}
