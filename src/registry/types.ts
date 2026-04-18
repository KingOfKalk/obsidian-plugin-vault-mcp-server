import { z } from 'zod';
import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export type { ToolAnnotations };

export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, z.ZodType>;
  handler: (params: Record<string, unknown>) => Promise<CallToolResult>;
  annotations: ToolAnnotations;
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
