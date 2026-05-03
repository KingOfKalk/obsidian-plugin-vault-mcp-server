import { describe, it, expect } from 'vitest';
import { extractPlaceholders } from '../../src/server/prompts';

describe('extractPlaceholders', () => {
  it('returns [] for an empty body', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });

  it('returns [] when no placeholders are present', () => {
    expect(extractPlaceholders('# Hello world\n\nNo placeholders here.')).toEqual([]);
  });

  it('extracts a single placeholder', () => {
    expect(extractPlaceholders('# {{name}}')).toEqual(['name']);
  });

  it('dedupes repeated placeholders, preserving first-seen order', () => {
    expect(extractPlaceholders('{{a}}{{a}}{{b}}{{a}}')).toEqual(['a', 'b']);
  });

  it('preserves first-seen order across distinct placeholders', () => {
    expect(extractPlaceholders('{{b}} then {{a}} then {{c}}')).toEqual(['b', 'a', 'c']);
  });

  it('strips the built-ins date, time, title that template_expand auto-resolves', () => {
    expect(extractPlaceholders('{{date}} {{title}} {{author}} {{time}}')).toEqual(['author']);
  });

  it('does not match placeholders with whitespace inside the braces', () => {
    expect(extractPlaceholders('{{ name }}')).toEqual([]);
  });

  it('does not match unbalanced or empty braces', () => {
    expect(extractPlaceholders('{{name')).toEqual([]);
    expect(extractPlaceholders('{{}}')).toEqual([]);
    expect(extractPlaceholders('{name}')).toEqual([]);
  });

  it('matches identifier-style names (letters, digits, underscore; must start with letter or underscore)', () => {
    expect(extractPlaceholders('{{a1}} {{_b}} {{c_d}}')).toEqual(['a1', '_b', 'c_d']);
    // leading digit is invalid
    expect(extractPlaceholders('{{1foo}}')).toEqual([]);
  });
});
