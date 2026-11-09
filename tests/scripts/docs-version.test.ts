/**
 * Release PRs only bump the version in manifest.json, package.json and
 * CHANGELOG.md. The generated tool docs must not change with it, or
 * `docs:check` fails on every release PR (#402). This file mocks
 * manifest.json with a different version and checks that the rendered docs
 * still match the committed ones byte for byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

const FAKE_VERSION = '98.76.54-release-test';

vi.mock('../../manifest.json', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, version: FAKE_VERSION } };
});

// One in-memory MCP server per tool, under coverage instrumentation (#399).
const EXAMPLES_TIMEOUT_MS = 30_000;

describe('generated docs are independent of the manifest version', () => {
  it(
    'render identically to the committed docs when manifest.json has another version',
    async () => {
      const { SERVER_INSTRUCTIONS } = await import('../../src/server/mcp-server');
      // The mock reaches src/: production code reports the fake version.
      expect(SERVER_INSTRUCTIONS.split('\n')[0]).toBe(`vault-mcp-server v${FAKE_VERSION}`);

      const { collectToolRows, renderIndexPage, renderModulePage } = await import(
        '../../scripts/list-tools'
      );
      const { collectToolExamples } = await import('../../scripts/tool-examples');
      const rows = collectToolRows(await collectToolExamples());
      const docsDir = join(__dirname, '..', '..', 'docs');

      const index = renderIndexPage(rows);
      expect(index).not.toContain(FAKE_VERSION);
      expect(index).toBe(readFileSync(join(docsDir, 'tools.generated.md'), 'utf8'));
      for (const row of rows) {
        const page = renderModulePage(row);
        expect(page, row.moduleId).not.toContain(FAKE_VERSION);
        expect(page, row.moduleId).toBe(
          readFileSync(join(docsDir, 'tools', `${row.moduleId}.generated.md`), 'utf8'),
        );
      }
    },
    EXAMPLES_TIMEOUT_MS,
  );
});
