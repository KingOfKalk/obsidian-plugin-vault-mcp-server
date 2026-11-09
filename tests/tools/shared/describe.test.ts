import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { describeTool } from '../../../src/tools/shared/describe';
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
