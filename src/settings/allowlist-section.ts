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
    text: 'The plugin_execute_command tool runs only the Obsidian commands listed here (one id per line). While the list is empty, MCP clients do not see the tool at all.',
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
