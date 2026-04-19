import type McpPlugin from '../main';
import { reportError } from '../utils/report-error';

/**
 * "Execute Command Allowlist" section — a textarea where users list
 * Obsidian command ids (one per line) that `plugin_execute_command` is
 * permitted to run. Empty means disabled (the tool refuses every call).
 */
export function renderAllowlistSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
): void {
  containerEl.createEl('h2', { text: 'Execute Command Allowlist' });

  containerEl.createEl('p', {
    cls: 'setting-item-description',
    text: 'The plugin_execute_command tool refuses every call by default. To enable specific Obsidian commands for MCP execution, list their ids here (one per line). Leave empty to keep the tool disabled.',
  });

  const textarea = containerEl.createEl('textarea', {
    cls: 'mcp-execute-command-allowlist',
    attr: { rows: '6', placeholder: 'app:reload\neditor:save-file' },
  });
  textarea.value = plugin.settings.executeCommandAllowlist.join('\n');
  textarea.addEventListener('change', () => {
    const next = textarea.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    plugin.settings.executeCommandAllowlist = next;
    plugin
      .saveSettings()
      .catch(reportError('save allowlist', plugin.logger));
  });
}
