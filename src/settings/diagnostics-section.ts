import { Notice, Setting } from 'obsidian';
import type McpPlugin from '../main';
import { t } from '../lang/helpers';
import { clearLogFile, getLogFilePath } from '../utils/log-file';
import { DebugInfoModal } from '../ui/debug-info-modal';
import { reportError } from '../utils/report-error';

/**
 * "Diagnostics" section — debug logging toggle, log file path display,
 * "Copy debug info" modal launcher, and "Clear log" action.
 */
export function renderDiagnosticsSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
): void {
  containerEl.createEl('h2', { text: t('heading_diagnostics') });

  new Setting(containerEl)
    .setName(t('setting_debug_name'))
    .setDesc(t('setting_debug_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.debugMode).onChange(async (value) => {
        plugin.settings.debugMode = value;
        plugin.logger.updateOptions({ debugMode: value });
        await plugin.saveSettings();
      }),
    );

  new Setting(containerEl)
    .setName(t('setting_log_file_name'))
    .setDesc(getLogFilePath(plugin));

  new Setting(containerEl)
    .setName(t('setting_copy_debug_info_name'))
    .setDesc(t('setting_copy_debug_info_desc'))
    .addExtraButton((btn) =>
      btn
        .setIcon('copy')
        .setTooltip(t('tooltip_copy_debug_info'))
        .onClick(() => {
          new DebugInfoModal(plugin.app, plugin).open();
        }),
    );

  new Setting(containerEl)
    .setName(t('setting_clear_log_name'))
    .setDesc(t('setting_clear_log_desc'))
    .addExtraButton((btn) =>
      btn
        .setIcon('trash')
        .setTooltip(t('tooltip_clear_log'))
        .onClick(() => {
          clearLogFile(plugin)
            .then(() => {
              new Notice(t('notice_log_cleared'));
            })
            .catch(reportError('clear log file', plugin.logger));
        }),
    );
}
