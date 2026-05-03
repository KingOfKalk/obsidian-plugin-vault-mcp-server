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
