import { describe, it, expect } from 'vitest';
import { MockObsidianAdapter } from '../../src/obsidian/mock-adapter';
import { discoverModules } from '../../src/tools';
import type { ToolDefinition } from '../../src/registry/types';

function allTools(): ToolDefinition[] {
  const adapter = new MockObsidianAdapter();
  return discoverModules(adapter).flatMap((m) => m.tools());
}

describe('tool titles', () => {
  it('every tool has a non-empty title (after trim)', () => {
    const missing = allTools()
      .filter((t) => !t.title || t.title.trim().length === 0)
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('every title is at most 40 characters', () => {
    const tooLong = allTools()
      .filter((t) => (t.title ?? '').length > 40)
      .map((t) => `${t.name}: "${t.title ?? ''}" (${String((t.title ?? '').length)} chars)`);
    expect(tooLong).toEqual([]);
  });

  it('titles are unique across the registry', () => {
    const tools = allTools();
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const t of tools) {
      const title = t.title ?? '';
      const prior = seen.get(title);
      if (prior !== undefined) {
        duplicates.push(`${prior} and ${t.name} share title "${title}"`);
      } else {
        seen.set(title, t.name);
      }
    }
    expect(duplicates).toEqual([]);
  });
});

const SIBLING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['editor_get_content', 'vault_read'],
  ['vault_list', 'vault_list_recursive'],
  ['search_resolved_links', 'search_unresolved_links'],
  ['extras_get_date', 'vault_get_metadata'],
  ['editor_insert', 'editor_replace'],
  ['editor_insert', 'editor_delete'],
  ['editor_replace', 'editor_delete'],
  ['search_tags', 'search_by_tag'],
  ['editor_set_cursor', 'editor_set_selection'],
  ['editor_get_active_file', 'workspace_get_active_leaf'],
];

describe('sibling cross-references', () => {
  function descriptionByName(name: string): string {
    const tool = allTools().find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found in registry: ${name}`);
    return tool.description;
  }

  for (const [a, b] of SIBLING_PAIRS) {
    it(`${a} description names ${b}`, () => {
      expect(descriptionByName(a)).toContain(b);
    });
    it(`${b} description names ${a}`, () => {
      expect(descriptionByName(b)).toContain(a);
    });
  }
});
