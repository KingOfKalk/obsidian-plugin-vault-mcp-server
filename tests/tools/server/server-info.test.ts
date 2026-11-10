import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/server';
import {
  RECENT_CHANGE_VERSIONS,
  createServerModule,
} from '../../../src/tools/server/index';
import type { AgentChangeEntry } from '../../../src/server/agent-changes';
import type { ToolDefinition } from '../../../src/registry/types';

function getText(result: CallToolResult): string {
  return result.content[0].type === 'text' ? result.content[0].text : '';
}

const CHANGES: AgentChangeEntry[] = ['4.0.2', '4.0.1', '4.0.0', '3.5.0', '3.3.0'].map((v) => ({
  version: v,
  notes: [`note ${v}`],
}));

function serverInfo(changes: readonly AgentChangeEntry[] = CHANGES): ToolDefinition {
  return createServerModule({ version: '4.0.2', getEnabledModules: () => ['vault'], changes })
    .tools()
    .find((t) => t.name === 'server_info')!;
}

interface Info {
  changes: AgentChangeEntry[];
  olderVersionsOmitted: number;
}

/** server_info returns the latest versions by default (#463). */
describe('server_info changes', () => {
  it('lists the 3 most recent versions by default', async () => {
    expect(RECENT_CHANGE_VERSIONS).toBe(3);
    const result = await serverInfo().handler({});
    const info = result.structuredContent as Info;
    expect(info.changes.map((c) => c.version)).toEqual(['4.0.2', '4.0.1', '4.0.0']);
    expect(info.olderVersionsOmitted).toBe(2);
    expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
  });

  it('lists every version with allChanges: true', async () => {
    const result = await serverInfo().handler({ allChanges: true });
    const info = result.structuredContent as Info;
    expect(info.changes.map((c) => c.version)).toEqual(CHANGES.map((c) => c.version));
    expect(info.olderVersionsOmitted).toBe(0);
    expect(JSON.parse(getText(result))).toEqual(result.structuredContent);
  });

  it('counts one omitted version', async () => {
    const result = await serverInfo(CHANGES.slice(0, 4)).handler({});
    expect((result.structuredContent as Info).olderVersionsOmitted).toBe(1);
  });

  it('omits nothing when there are few versions', async () => {
    const result = await serverInfo(CHANGES.slice(0, 2)).handler({ allChanges: false });
    const info = result.structuredContent as Info;
    expect(info.changes).toHaveLength(2);
    expect(info.olderVersionsOmitted).toBe(0);
    expect(getText(result)).not.toContain('left out');
  });

  it('accepts allChanges as an optional boolean', () => {
    const schema = z.object(serverInfo().schema).strict();
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ allChanges: true }).success).toBe(true);
    expect(schema.safeParse({ allChanges: 'yes' }).success).toBe(false);
  });

  it('matches its output schema', async () => {
    const tool = serverInfo();
    const result = await tool.handler({});
    const outputSchema = z.object(tool.outputSchema as z.ZodRawShape).strict();
    expect(outputSchema.safeParse(result.structuredContent).success).toBe(true);
  });
});
