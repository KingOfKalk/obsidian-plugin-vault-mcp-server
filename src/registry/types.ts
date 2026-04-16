import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (params: unknown) => Promise<ToolResult>;
  isReadOnly: boolean;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ModuleMetadata {
  id: string;
  name: string;
  description: string;
  supportsReadOnly: boolean;
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
