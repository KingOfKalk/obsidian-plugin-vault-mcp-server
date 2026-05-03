import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { describeTool } from '../../../src/tools/shared/describe';
import { paginationFields } from '../../../src/tools/shared/pagination';
import { responseFormatField } from '../../../src/tools/shared/response';

describe('describeTool', () => {
  it('renders summary, args, returns, examples, and errors when no schema is supplied', () => {
    const out = describeTool({
      summary: 'Do a thing.',
      args: ['x (string): An x.'],
      returns: 'Plain text "ok".',
      examples: ['Use when: testing.'],
      errors: ['"boom" on failure.'],
    });
    expect(out).toContain('Do a thing.');
    expect(out).toContain('Args:');
    expect(out).toContain('  - x (string): An x.');
    expect(out).toContain('Returns:');
    expect(out).toContain('  Plain text "ok".');
    expect(out).toContain('Examples:');
    expect(out).toContain('  - Use when: testing.');
    expect(out).toContain('Errors:');
    expect(out).toContain('  - "boom" on failure.');
  });

  it('does not inject anything when schema does not spread shared fields', () => {
    const schema = { foo: z.string() };
    const out = describeTool({ summary: 'Plain.', args: ['foo (string): Just foo.'] }, schema);
    expect(out).not.toContain('limit (integer');
    expect(out).not.toContain('offset (integer');
    expect(out).not.toContain('response_format (enum');
  });

  it('injects limit and offset rows when schema spreads paginationFields', () => {
    const schema = { ...paginationFields };
    const out = describeTool({ summary: 'Paginated.' }, schema);
    expect(out).toContain('limit (integer, optional): Maximum items to return (1..100, default 20).');
    expect(out).toContain('offset (integer, optional): Number of items to skip before returning results (default 0).');
    expect(out).not.toContain('response_format (enum');
  });

  it('appends a default Returns line for paginated tools when caller did not supply one', () => {
    const schema = { ...paginationFields };
    const out = describeTool({ summary: 'Paginated.' }, schema);
    expect(out).toContain('Returns:');
    expect(out).toContain('{ items, total, count, offset, has_more, next_offset }');
  });

  it('does not override caller-supplied returns for paginated tools', () => {
    const schema = { ...paginationFields };
    const out = describeTool(
      { summary: 'Paginated.', returns: 'JSON: bespoke shape.' },
      schema,
    );
    expect(out).toContain('  JSON: bespoke shape.');
    // Default suffix should not appear when caller supplied returns.
    expect(out).not.toContain('{ items, total, count, offset, has_more, next_offset }');
  });

  it('injects only response_format when schema spreads responseFormatField only', () => {
    const schema = { ...responseFormatField };
    const out = describeTool({ summary: 'Read-only.' }, schema);
    expect(out).toContain('response_format (enum, optional): "markdown" (default) or "json".');
    expect(out).not.toContain('limit (integer');
    expect(out).not.toContain('offset (integer');
  });

  it('injects all three rows when schema spreads both pagination and responseFormat', () => {
    const schema = { ...paginationFields, ...responseFormatField };
    const out = describeTool({ summary: 'Paginated + format.' }, schema);
    expect(out).toContain('limit (integer, optional)');
    expect(out).toContain('offset (integer, optional)');
    expect(out).toContain('response_format (enum, optional)');
  });

  it('places injected rows AFTER caller-supplied args', () => {
    const schema = { query: z.string(), ...paginationFields, ...responseFormatField };
    const out = describeTool(
      { summary: 'Search.', args: ['query (string): Substring.'] },
      schema,
    );
    const queryIdx = out.indexOf('query (string): Substring.');
    const limitIdx = out.indexOf('limit (integer');
    const offsetIdx = out.indexOf('offset (integer');
    const responseFormatIdx = out.indexOf('response_format (enum');
    expect(queryIdx).toBeGreaterThanOrEqual(0);
    expect(limitIdx).toBeGreaterThan(queryIdx);
    expect(offsetIdx).toBeGreaterThan(limitIdx);
    expect(responseFormatIdx).toBeGreaterThan(offsetIdx);
  });

  it('does not inject when only one of paginationFields keys is present (no false positive)', () => {
    // Same Zod fragment shape, but cloned references — should NOT be detected.
    const schema = {
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    };
    const out = describeTool({ summary: 'Custom.' }, schema);
    expect(out).not.toContain('limit (integer, optional)');
    expect(out).not.toContain('offset (integer, optional)');
  });

  it('renders a See also section when seeAlso entries are supplied', () => {
    const out = describeTool({
      summary: 'Read a thing.',
      seeAlso: [
        'other_tool — when you want the other variant.',
      ],
    });
    expect(out).toContain('See also:');
    expect(out).toContain('  - other_tool — when you want the other variant.');
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
