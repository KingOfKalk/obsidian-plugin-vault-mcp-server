import { Notice, Setting } from 'obsidian';
import type McpPlugin from '../main';
import { t } from '../lang/helpers';
import { reportError } from '../utils/report-error';
import { renderTlsSection } from './tls-section';

/**
 * HTTPS block of Server Settings — rendered only when `httpsEnabled` is
 * true. Shows either the "regenerate self-signed cert" row (default) or
 * the custom-TLS subsection, and a toggle between the two modes.
 */
export function renderHttpsSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  refresh: () => void,
): void {
  if (!plugin.settings.useCustomTls) {
    const hasCert = plugin.settings.tlsCertificate !== null;
    new Setting(containerEl)
      .setName(t('setting_tls_cert_name'))
      .setDesc(
        hasCert
          ? t('setting_tls_cert_desc_present')
          : t('setting_tls_cert_desc_absent'),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon('refresh-cw')
          .setTooltip(t('tooltip_regenerate_cert'))
          .onClick(() => {
            plugin
              .regenerateTlsCertificate()
              .then(() => {
                new Notice(t('notice_tls_regenerated'));
                refresh();
              })
              .catch(
                reportError('regenerate TLS certificate', plugin.logger),
              );
          }),
      );
  }

  new Setting(containerEl)
    .setName(t('setting_custom_tls_toggle_name'))
    .setDesc(t('setting_custom_tls_toggle_desc'))
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.useCustomTls)
        .onChange(async (value) => {
          plugin.settings.useCustomTls = value;
          await plugin.saveSettings();
          refresh();
        }),
    );

  if (plugin.settings.useCustomTls) {
    renderTlsSection(containerEl, plugin, refresh);
  }
}
