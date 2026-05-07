import { describe, it, expect } from 'vitest';
import { renderTypeCell } from '../../../scripts/render-tools/schema-to-table';

describe('renderTypeCell', () => {
  it('renders a plain string', () => {
    expect(renderTypeCell({ type: 'string' })).toBe('string');
  });

  it('renders a bounded string', () => {
    expect(
      renderTypeCell({ type: 'string', minLength: 1, maxLength: 4096 }),
    ).toBe('string (1–4096)');
  });

  it('renders a min-only string', () => {
    expect(renderTypeCell({ type: 'string', minLength: 1 })).toBe('string (≥1)');
  });

  it('renders a max-only string', () => {
    expect(renderTypeCell({ type: 'string', maxLength: 100 })).toBe('string (≤100)');
  });

  it('renders a plain number', () => {
    expect(renderTypeCell({ type: 'number' })).toBe('number');
  });

  it('renders a bounded number (treats integer like number)', () => {
    expect(
      renderTypeCell({ type: 'integer', minimum: 0, maximum: 100 }),
    ).toBe('number (0–100)');
  });

  it('renders boolean', () => {
    expect(renderTypeCell({ type: 'boolean' })).toBe('boolean');
  });

  it('renders an enum with pipe escaping', () => {
    expect(renderTypeCell({ enum: ['text', 'json'] })).toBe(
      'enum: `text` \\| `json`',
    );
  });

  it('renders a literal const', () => {
    expect(renderTypeCell({ const: 'frontmatter', type: 'string' })).toBe(
      'literal: `frontmatter`',
    );
  });

  it('renders an array of primitives', () => {
    expect(
      renderTypeCell({ type: 'array', items: { type: 'string' } }),
    ).toBe('string[]');
  });

  it('renders an array of objects', () => {
    expect(
      renderTypeCell({ type: 'array', items: { type: 'object' } }),
    ).toBe('object[]');
  });

  it('renders a plain object', () => {
    expect(renderTypeCell({ type: 'object' })).toBe('object');
  });

  it('falls back to unknown for anything else', () => {
    expect(renderTypeCell({})).toBe('unknown');
    expect(renderTypeCell({ type: 'something-weird' })).toBe('unknown');
  });
});
