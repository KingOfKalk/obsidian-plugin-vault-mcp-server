import { describe, it, expect } from 'vitest';
import { collectToolRows, renderIndexPage, renderModulePage } from '../../scripts/list-tools';

describe('scripts/list-tools', () => {
  it('collects all registered modules with tool docs', () => {
    const rows = collectToolRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.moduleId).not.toBe('');
      expect(row.moduleName).not.toBe('');
      expect(row.tools.length).toBeGreaterThan(0);
      for (const t of row.tools) {
        expect(typeof t.name).toBe('string');
        expect(typeof t.title).toBe('string');
        expect(typeof t.description).toBe('string');
        expect(typeof t.schema).toBe('object');
      }
    }
  });

  it('renderIndexPage carries the auto-generated banner and totals', () => {
    const rows = collectToolRows();
    const md = renderIndexPage(rows);
    expect(md).toContain('AUTO-GENERATED');
    expect(md).toContain('| Module ID |');
    expect(md).toMatch(/\*\*Total tools:\*\* \d+ across \d+ modules\./);
  });

  it('every tool name appears in the index annotation tables', () => {
    const rows = collectToolRows();
    const md = renderIndexPage(rows);
    for (const row of rows) {
      for (const tool of row.tools) {
        expect(md).toContain(`| \`${tool.name}\` | ${tool.title} |`);
      }
    }
  });

  it('every tool name appears in its module page', () => {
    const rows = collectToolRows();
    for (const row of rows) {
      const md = renderModulePage(row);
      for (const tool of row.tools) {
        expect(md).toContain(`### ${tool.name}`);
      }
    }
  });

  it('the vault module page renders the flat vault_get_aspect output with every per-aspect field', () => {
    const rows = collectToolRows();
    const vault = rows.find((r) => r.moduleId === 'vault');
    expect(vault).toBeDefined();
    if (!vault) return;
    const md = renderModulePage(vault);
    const section = md.slice(md.indexOf('### vault_get_aspect'));
    expect(section).toContain('### vault_get_aspect');
    for (const field of ['frontmatter', 'headings', 'links', 'embeds', 'backlinks', 'blockRefs']) {
      expect(section).toContain(`\`${field}\``);
    }
    // No discriminated union any more: SDK v1 cannot handle one (#388).
    expect(section).not.toContain('**When `aspect` is');
  });

  it('the ui module page documents the ui_notice structured output', () => {
    const rows = collectToolRows();
    const ui = rows.find((r) => r.moduleId === 'ui');
    expect(ui).toBeDefined();
    if (!ui) return;
    const md = renderModulePage(ui);
    expect(md).toContain('`shown`');
    expect(md).not.toContain(
      '_No `structuredContent` declared — returns plain text or binary._',
    );
  });
});
