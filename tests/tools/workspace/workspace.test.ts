import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';
import { createWorkspaceModule } from '../../../src/tools/workspace/index';

function getText(r: CallToolResult): string {
  return r.content[0].type === 'text' ? r.content[0].text : '';
}

describe('workspace module', () => {
  let adapter: MockObsidianAdapter;

  beforeEach(() => {
    adapter = new MockObsidianAdapter();
  });

  it('should register 5 tools', () => {
    const module = createWorkspaceModule(adapter);
    expect(module.tools()).toHaveLength(5);
  });

  it('should open a file and list leaves (json)', async () => {
    adapter.addFile('test.md', 'content');
    const module = createWorkspaceModule(adapter);
    const openTool = module.tools().find((t) => t.name === 'workspace_open_file')!;
    await openTool.handler({ path: 'test.md' });
    const listTool = module.tools().find((t) => t.name === 'workspace_list_leaves')!;
    const result = await listTool.handler({ response_format: 'json' });
    const data = JSON.parse(getText(result)) as { leaves: Array<{ path: string }> };
    expect(data.leaves).toHaveLength(1);
    expect(data.leaves[0].path).toBe('test.md');
  });

  it('should get active leaf info (json)', async () => {
    adapter.addFile('test.md', 'content');
    adapter.addOpenLeaf('test.md', 'leaf-1');
    adapter.setActiveLeafId('leaf-1');
    const module = createWorkspaceModule(adapter);
    const tool = module.tools().find((t) => t.name === 'workspace_get_active_leaf')!;
    const result = await tool.handler({ response_format: 'json' });
    const data = JSON.parse(getText(result)) as Record<string, unknown>;
    expect(data.id).toBe('leaf-1');
  });

  it('should get workspace layout', async () => {
    const module = createWorkspaceModule(adapter);
    const tool = module.tools().find((t) => t.name === 'workspace_get_layout')!;
    const result = await tool.handler({});
    expect(result.isError).toBeUndefined();
  });

  describe('workspace_open_file path guard', () => {
    it('rejects path traversal attempts', async () => {
      const module = createWorkspaceModule(adapter);
      const tool = module.tools().find((t) => t.name === 'workspace_open_file')!;
      const result = await tool.handler({ path: '../../etc/passwd' });
      expect(result.isError).toBe(true);
    });

    it('rejects empty path', async () => {
      const module = createWorkspaceModule(adapter);
      const tool = module.tools().find((t) => t.name === 'workspace_open_file')!;
      const result = await tool.handler({ path: '' });
      expect(result.isError).toBe(true);
    });

    it('rejects backslash separators', async () => {
      const module = createWorkspaceModule(adapter);
      const tool = module.tools().find((t) => t.name === 'workspace_open_file')!;
      const result = await tool.handler({ path: 'a\\b.md' });
      expect(result.isError).toBe(true);
    });
  });
});

/**
 * Batch C of #248: every workspace read tool that emits `structuredContent`
 * must declare an `outputSchema`, and that schema must accurately describe
 * the payload the handler produces.
 *
 * Two of the three tools — `workspace_get_active_leaf` and
 * `workspace_get_layout` — return Obsidian-internal shapes whose set of
 * fields is not under our control. Their schemas declare the documented
 * fields the adapter actually returns; tests use `.passthrough()` so future
 * Obsidian versions can add fields without churning this suite.
 */
describe('workspace read tools — outputSchema declarations', () => {
  function getStructured(
    tool: { outputSchema?: z.ZodRawShape | z.ZodTypeAny },
    { passthrough = false } = {},
  ): z.ZodObject<z.ZodRawShape> {
    if (!tool.outputSchema) {
      throw new Error('expected outputSchema to be declared');
    }
    if (tool.outputSchema instanceof z.ZodType) {
      throw new Error('expected outputSchema to be a raw shape, not a full Zod schema');
    }
    const obj = z.object(tool.outputSchema);
    return passthrough ? obj.passthrough() : obj.strict();
  }

  it('workspace_get_active_leaf declares outputSchema (passthrough) and parses against handler output', async () => {
    // Obsidian's leaf state may carry additional fields beyond { id, type, filePath } in
    // future versions; .passthrough() absorbs those without test churn.
    const adapter = new MockObsidianAdapter();
    adapter.addFile('test.md', 'content');
    adapter.addOpenLeaf('test.md', 'leaf-1');
    adapter.setActiveLeafId('leaf-1');
    const tool = createWorkspaceModule(adapter).tools().find((t) => t.name === 'workspace_get_active_leaf')!;
    const schema = getStructured(tool, { passthrough: true });

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.id).toBe('leaf-1');
    expect(parsed.type).toBe('markdown');
    expect(parsed.filePath).toBe('test.md');
  });

  it('workspace_list_leaves declares outputSchema (strict) and parses against handler output', async () => {
    const adapter = new MockObsidianAdapter();
    adapter.addFile('a.md', 'A');
    adapter.addOpenLeaf('a.md', 'leaf-A');
    const tool = createWorkspaceModule(adapter).tools().find((t) => t.name === 'workspace_list_leaves')!;
    const schema = getStructured(tool);

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(parsed.leaves).toEqual([{ leafId: 'leaf-A', path: 'a.md' }]);
  });

  it('workspace_get_layout declares outputSchema (passthrough) and parses against handler output', async () => {
    // Obsidian's layout descriptor (returned by app.workspace.getLayout()) is
    // an opaque nested tree whose internal shape is not stable across versions.
    // The schema is `{}` so .passthrough() accepts any object.
    const adapter = new MockObsidianAdapter();
    const tool = createWorkspaceModule(adapter).tools().find((t) => t.name === 'workspace_get_layout')!;
    const schema = getStructured(tool, { passthrough: true });

    const result = await tool.handler({ response_format: 'json' });
    const parsed = schema.parse(result.structuredContent);
    expect(typeof parsed).toBe('object');
  });
});
