import { describe, it, expect } from 'vitest';
import { collectToolRows, renderMarkdown } from '../../scripts/list-tools';

describe('scripts/list-tools', () => {
  it('collects all registered modules and their tool names', () => {
    const rows = collectToolRows();
    expect(rows.length).toBeGreaterThan(0);
    // Every module must have a non-empty tool list.
    for (const row of rows) {
      expect(row.moduleId).not.toBe('');
      expect(row.moduleName).not.toBe('');
      expect(row.tools.length).toBeGreaterThan(0);
    }
  });

  it('renders a markdown table with the auto-generated banner', () => {
    const rows = collectToolRows();
    const md = renderMarkdown(rows);
    expect(md).toContain('AUTO-GENERATED');
    expect(md).toContain('| Module ID |');
    expect(md).toMatch(/\*\*Total tools:\*\* \d+ across \d+ modules\./);
  });

  it('lists every tool name in the rendered output', () => {
    const rows = collectToolRows();
    const md = renderMarkdown(rows);
    for (const row of rows) {
      for (const tool of row.tools) {
        expect(md).toContain(tool);
      }
    }
  });
});
