/**
 * The generated bulk part of the eval fixture (#466): deterministic, large
 * enough that the paged tools need more than one page, and loaded by the
 * harness on top of the hand-written notes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VAULT_DIR } from '../../evals/harness';
import { loadFixtureVault } from '../../evals/fixture-adapter';
import {
  BULK_SEED,
  STATION_COUNT,
  STAFF_COUNT,
  VISIT_COUNT,
  createRng,
  generateBulkNotes,
} from '../../evals/fixture-generator';
import { CHARACTER_LIMIT } from '../../src/constants';

const digest = (notes: Array<{ path: string; content: string }>): string =>
  createHash('sha256')
    .update(notes.map((n) => `${n.path}\n${n.content}`).join('\0'))
    .digest('hex');

describe('fixture generator', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(digest(generateBulkNotes(BULK_SEED))).toBe(digest(generateBulkNotes(BULK_SEED)));
    expect(digest(generateBulkNotes(BULK_SEED + 1))).not.toBe(digest(generateBulkNotes(BULK_SEED)));
    const a = createRng(1);
    const b = createRng(1);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('generates a few hundred notes with unique paths', () => {
    const notes = generateBulkNotes();
    const paths = notes.map((n) => n.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => p.startsWith('stations/'))).toHaveLength(STATION_COUNT);
    expect(paths.filter((p) => p.startsWith('staff/'))).toHaveLength(STAFF_COUNT);
    expect(paths.filter((p) => p.startsWith('visits/'))).toHaveLength(VISIT_COUNT);
    expect(notes.length).toBeGreaterThan(400);
  });

  it('includes a long note that needs several vault_read pages', () => {
    const ledger = generateBulkNotes().find((n) => n.path === 'reference/Calibration Ledger.md');
    expect(ledger?.content.length ?? 0).toBeGreaterThan(2 * CHARACTER_LIMIT);
  });

  it('loads on top of the hand-written notes with large link maps', () => {
    const adapter = loadFixtureVault(DEFAULT_VAULT_DIR, generateBulkNotes());
    // Hand-written notes are still there and resolve as before.
    expect(adapter.resolveLink('Atlas', 'x.md')).toBe('projects/Atlas.md');
    // Lena Fischer is linked from more visits than one backlinks page (50) holds.
    expect(adapter.getBacklinks('people/Lena Fischer.md').length).toBeGreaterThan(50);
    // Field Protocol is linked from every visit report.
    expect(adapter.getBacklinks('reference/Field Protocol.md').length).toBeGreaterThan(VISIT_COUNT);
    const unresolvedSources = Object.values(adapter.getUnresolvedLinks()).filter(
      (t) => Object.keys(t).length > 0,
    );
    expect(unresolvedSources.length).toBeGreaterThan(50);
  });

  it('refuses a generated note that would replace a fixture file', () => {
    expect(() =>
      loadFixtureVault(DEFAULT_VAULT_DIR, [{ path: 'Home.md', content: '# Other' }]),
    ).toThrow(/collides/);
  });
});
