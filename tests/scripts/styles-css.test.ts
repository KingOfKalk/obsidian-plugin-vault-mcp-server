/**
 * The plugin's tracked `styles.css` is what Obsidian loads and what releases
 * ship. A CI step once overwrote it with a placeholder before packaging, so
 * releases carried a 30-byte file (#553). These checks keep the file real and
 * keep the workflows from overwriting it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('styles.css', () => {
  it('holds the classes the settings UI and status bar use', () => {
    const css = read('styles.css');
    for (const cls of ['mcp-module-card', 'mcp-settings-error', 'mcp-statusbar-error']) {
      expect(css).toContain(`.${cls}`);
    }
  });

  it.each(['.github/workflows/ci.yml', '.github/workflows/release.yml'])(
    '%s does not overwrite it',
    (workflow) => {
      const yaml = read(workflow);
      expect(yaml).not.toMatch(/>>?\s*styles\.css/);
      expect(yaml).not.toMatch(/styles\.css placeholder/);
      expect(yaml).toContain('test -s styles.css');
    },
  );
});
