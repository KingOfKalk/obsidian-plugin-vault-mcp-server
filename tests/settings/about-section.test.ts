import { beforeEach, describe, expect, it } from 'vitest';
// Imported from the mock file directly (vitest aliases `obsidian` to the same
// module) so the mock-only helpers and fields typecheck.
import { Setting, apiVersion, mockElement } from '../__mocks__/obsidian';
import type { MockElement } from '../__mocks__/obsidian';
import {
  buildIssueBody,
  buildNewIssueUrl,
  renderAboutSection,
} from '../../src/settings/about-section';
import { NEW_ISSUE_URL, REPOSITORY_URL } from '../../src/constants';
import type McpPlugin from '../../src/main';

const REPO = 'https://github.com/KingOfKalk/obsidian-plugin-vault-mcp-server';

function render(version = '3.3.0'): { container: MockElement; settings: Setting[] } {
  const container = mockElement();
  const plugin = { manifest: { id: 'vault-mcp-server', version } };
  renderAboutSection(
    container as unknown as HTMLElement,
    plugin as unknown as McpPlugin,
  );
  return { container, settings: Setting.instances };
}

function findSetting(settings: Setting[], name: string): Setting {
  const found = settings.find((s) => s.settingName === name);
  if (!found) throw new Error(`setting "${name}" not rendered`);
  return found;
}

function firstLink(setting: Setting): MockElement {
  const link = setting.descEl.children.find((c) => c.tagName === 'a');
  if (!link) throw new Error(`no link in "${setting.settingName}"`);
  return link;
}

describe('repository constants', () => {
  it('points at the GitHub repository', () => {
    expect(REPOSITORY_URL).toBe(REPO);
  });

  it('derives the new-issue URL from the repository URL', () => {
    expect(NEW_ISSUE_URL).toBe(`${REPO}/issues/new`);
  });
});

describe('buildIssueBody', () => {
  it('includes the plugin and Obsidian versions and the debug info prompt', () => {
    const body = buildIssueBody('3.3.0', '1.8.9');
    expect(body).toContain('Plugin version: 3.3.0');
    expect(body).toContain('Obsidian version: 1.8.9');
    expect(body).toContain('Copy debug info');
  });

  it('falls back to "unknown" when the Obsidian version is not available', () => {
    expect(buildIssueBody('3.3.0', undefined)).toContain(
      'Obsidian version: unknown',
    );
    expect(buildIssueBody('3.3.0', '')).toContain('Obsidian version: unknown');
  });
});

describe('buildNewIssueUrl', () => {
  it('opens a new issue with the URL-encoded body', () => {
    const url = buildNewIssueUrl('3.3.0', '1.8.9');
    const prefix = `${REPO}/issues/new?body=`;
    expect(url.startsWith(prefix)).toBe(true);
    const encoded = url.slice(prefix.length);
    expect(encoded).toBe(encodeURIComponent(buildIssueBody('3.3.0', '1.8.9')));
    expect(encoded).toContain('Plugin%20version%3A%203.3.0');
    expect(encoded).not.toMatch(/\s/);
    expect(new URL(url).searchParams.get('body')).toBe(
      buildIssueBody('3.3.0', '1.8.9'),
    );
  });
});

describe('renderAboutSection', () => {
  beforeEach(() => {
    Setting.instances = [];
  });

  it('renders an "About" heading with setHeading', () => {
    const { container, settings } = render();
    expect(settings[0]).toMatchObject({ settingName: 'About', isHeading: true });
    expect(container.children.find((c) => /^h[1-6]$/.test(c.tagName))).toBeUndefined();
  });

  it('shows the installed plugin version from the manifest', () => {
    const { settings } = render('9.8.7');
    expect(findSetting(settings, 'Version').settingDesc).toBe('9.8.7');
  });

  it('links to the repository', () => {
    const { settings } = render();
    const link = firstLink(findSetting(settings, 'Repository'));
    expect(link.attributes.href).toBe(REPO);
    expect(link.textContent).toBe(REPO);
  });

  it('links to a prefilled new issue containing the encoded versions', () => {
    const { settings } = render('9.8.7');
    const link = firstLink(findSetting(settings, 'Report an issue'));
    expect(link.attributes.href).toBe(buildNewIssueUrl('9.8.7', apiVersion));
    expect(link.attributes.href).toContain('Plugin%20version%3A%209.8.7');
    expect(link.attributes.href).toContain(
      `Obsidian%20version%3A%20${apiVersion}`,
    );
  });

  it('opens both links in the external browser', () => {
    const { settings } = render();
    for (const name of ['Repository', 'Report an issue']) {
      const link = firstLink(findSetting(settings, name));
      expect(link.attributes.target).toBe('_blank');
      expect(link.attributes.rel).toBe('noopener noreferrer');
    }
  });
});
