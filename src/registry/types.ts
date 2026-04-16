import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, z.ZodType>;
  handler: (params: Record<string, unknown>) => Promise<CallToolResult>;
  isReadOnly: boolean;
}

export type ModuleGroup = 'extras';

export interface ModuleMetadata {
  id: string;
  name: string;
  description: string;
  supportsReadOnly: boolean;
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
  readOnly: boolean;
}
