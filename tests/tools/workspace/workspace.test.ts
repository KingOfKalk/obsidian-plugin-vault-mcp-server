import { describe, it, expect, beforeEach } from 'vitest';
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
