import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { describeTool } from '../../../src/tools/shared/describe';
import { PAGING_RULE } from '../../../src/tools/shared/pagination';
import { discoverModules } from '../../../src/tools';
import { MockObsidianAdapter } from '../../../src/obsidian/mock-adapter';

describe('describeTool', () => {
  it('renders summary, returns, examples, and errors', () => {
    const out = describeTool({
      summary: 'Do a thing.',
      returns: 'Plain text "ok".',
      examples: ['Use when: testing.'],
      errors: ['"boom" on failure.'],
    });
    expect(out).toBe(
      ['Do a thing.', 'Returns: Plain text "ok".', 'Examples:', '- Use when: testing.', 'Errors:', '- "boom" on failure.'].join('\n'),
    );
  });

  it('renders no blank lines and no indentation (#457)', () => {
    const out = describeTool({
      summary: 'Read.',
      returns: 'x',
      examples: ['Use when: a.'],
      seeAlso: ['other_tool — b.'],
      errors: ['"c".'],
    });
    expect(out).not.toContain('\n\n');
    expect(out).not.toMatch(/\n /);
  });

  it('never renders an Args section (parameters are documented in inputSchema, #388)', () => {
    const out = describeTool({ summary: 'Plain.', returns: 'x' });
    expect(out).not.toContain('Args:');
  });

  it('renders only the summary when nothing else is supplied', () => {
    expect(describeTool({ summary: '  Just this.  ' })).toBe('Just this.');
  });

  it('renders a See also section when seeAlso entries are supplied', () => {
    const out = describeTool({
      summary: 'Read a thing.',
      seeAlso: [
        'other_tool — when you want the other variant.',
      ],
    });
    expect(out).toContain('See also:');
    expect(out).toContain('\n- other_tool — when you want the other variant.');
  });

  it('places See also between Examples and Errors', () => {
    const out = describeTool({
      summary: 'Read.',
      examples: ['Use when: testing.'],
      seeAlso: ['other_tool — alternative.'],
      errors: ['"boom" on failure.'],
    });
    const examplesIdx = out.indexOf('Examples:');
    const seeAlsoIdx = out.indexOf('See also:');
    const errorsIdx = out.indexOf('Errors:');
    expect(examplesIdx).toBeGreaterThan(0);
    expect(seeAlsoIdx).toBeGreaterThan(examplesIdx);
    expect(errorsIdx).toBeGreaterThan(seeAlsoIdx);
  });

  it('renders the shared paging rule after Returns (#490)', () => {
    expect(PAGING_RULE).toBe(
      'limit default 50, max 100; next page: offset=nextOffset.',
    );
    expect(describeTool({ summary: 'List.', returns: 'x', paging: 'over files', seeAlso: ['y — z.'] })).toBe(
      ['List.', 'Returns: x', `Paging: over files; ${PAGING_RULE}`, 'See also:', '- y — z.'].join('\n'),
    );
    expect(describeTool({ summary: 'List.', paging: '' })).toBe(`List.\nPaging: ${PAGING_RULE}`);
  });

  it('omits See also when no seeAlso entries are supplied', () => {
    const out = describeTool({ summary: 'Read.' });
    expect(out).not.toContain('See also:');
  });
});

describe('registered tools document every parameter in inputSchema', () => {
  const tools = discoverModules(new MockObsidianAdapter()).flatMap((m) => m.tools());

  it('no tool description carries an Args section', () => {
    for (const tool of tools) {
      expect(tool.description, tool.name).not.toContain('\nArgs:');
    }
  });

  it('every input field has a .describe() text', () => {
    for (const tool of tools) {
      for (const [key, field] of Object.entries(tool.schema)) {
        expect((field as z.ZodType).description, `${tool.name}.${key}`).toBeTruthy();
      }
    }
  });
});

describe('paged tools (#490)', () => {
  const tools = discoverModules(new MockObsidianAdapter()).flatMap((m) => m.tools());
  const paged = tools.filter((t) => 'limit' in t.schema);

  it('finds the paged tools', () => {
    expect(paged.map((t) => t.name).sort()).toEqual([
      'search_by_frontmatter',
      'search_by_name',
      'search_by_tag',
      'search_fulltext',
      'search_resolved_links',
      'search_tags',
      'search_unresolved_links',
      'vault_get_aspect',
      'vault_list',
      'vault_list_recursive',
    ]);
  });

  it('every paged tool defaults to 50 items, max 100, and states the paging rule', () => {
    for (const tool of paged) {
      const limit = (tool.schema as Record<string, z.ZodType>).limit;
      expect(limit.parse(undefined), tool.name).toBe(50);
      expect(limit.safeParse(101).success, tool.name).toBe(false);
      expect(tool.description, tool.name).toContain(PAGING_RULE);
    }
  });

  it('no other tool states the paging rule', () => {
    for (const tool of tools.filter((t) => !('limit' in t.schema))) {
      expect(tool.description, tool.name).not.toContain('Paging:');
    }
  });
});
