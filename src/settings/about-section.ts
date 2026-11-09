import { Setting, apiVersion } from 'obsidian';
import type McpPlugin from '../main';
import { t } from '../lang/helpers';
import { NEW_ISSUE_URL, REPOSITORY_URL } from '../constants';

/**
 * Body template for a new GitHub issue. Kept in English on purpose: the
 * issue tracker is English-only, whatever language the UI runs in.
 */
export function buildIssueBody(
  pluginVersion: string,
  obsidianVersion: string | undefined,
): string {
  const obsidian = obsidianVersion ? obsidianVersion : 'unknown';
  return [
    '## Environment',
    '',
    `- Plugin version: ${pluginVersion}`,
    `- Obsidian version: ${obsidian}`,
    '',
    '## What happened',
    '',
    '<!-- Describe the problem and how to reproduce it. -->',
    '',
    '## Debug info',
    '',
    '<!-- Paste the output of "Copy debug info" (plugin settings → Diagnostics) here. -->',
    '',
  ].join('\n');
}

/** "New issue" URL with the {@link buildIssueBody} template URL-encoded. */
export function buildNewIssueUrl(
  pluginVersion: string,
  obsidianVersion: string | undefined,
): string {
  const body = encodeURIComponent(buildIssueBody(pluginVersion, obsidianVersion));
  return `${NEW_ISSUE_URL}?body=${body}`;
}

function appendExternalLink(el: HTMLElement, text: string, href: string): void {
  el.createEl('a', {
    text,
    attr: { href, target: '_blank', rel: 'noopener noreferrer' },
  });
}

/**
 * "About" section — rendered last. Shows the installed plugin version,
 * a link to the repository and a link that opens a prefilled new issue.
 */
export function renderAboutSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
): void {
  const pluginVersion = plugin.manifest.version;

  containerEl.createEl('h2', { text: t('heading_about') });

  new Setting(containerEl)
    .setName(t('setting_about_version_name'))
    .setDesc(pluginVersion);

  const repository = new Setting(containerEl).setName(
    t('setting_about_repository_name'),
  );
  appendExternalLink(repository.descEl, REPOSITORY_URL, REPOSITORY_URL);

  const report = new Setting(containerEl).setName(
    t('setting_about_report_issue_name'),
  );
  report.descEl.createDiv({ text: t('setting_about_report_issue_desc') });
  appendExternalLink(
    report.descEl,
    t('link_report_issue'),
    buildNewIssueUrl(pluginVersion, apiVersion),
  );
}
