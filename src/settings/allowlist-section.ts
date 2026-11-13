import { Setting } from 'obsidian';
import type McpPlugin from '../main';
import { t } from '../lang/helpers';
import { reportError } from '../utils/report-error';

/**
 * "Command allowlist" section — a textarea where users list Obsidian
 * command ids (one per line) that `plugin_execute_command` is permitted to
 * run. Empty means disabled (the tool is not listed).
 */
export function renderAllowlistSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
): void {
  new Setting(containerEl).setName(t('heading_command_allowlist')).setHeading();

  containerEl.createEl('p', {
    cls: 'setting-item-description',
    text: t('message_command_allowlist'),
  });

  const textarea = containerEl.createEl('textarea', {
    cls: 'vault-mcp-execute-command-allowlist',
    attr: { rows: '6', placeholder: 'app:reload\neditor:save-file' },
  });
  textarea.value = plugin.settings.executeCommandAllowlist.join('\n');
  textarea.addEventListener('change', () => {
    const next = textarea.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    plugin.settings.executeCommandAllowlist = next;
    // Lists or hides plugin_execute_command in open sessions (#469).
    plugin.registry.refreshAvailability();
    plugin
      .saveSettings()
      .catch(reportError('save allowlist', plugin.logger));
  });
}
