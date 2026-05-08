import { Notice, Setting } from 'obsidian';
import type McpPlugin from '../main';
import { t } from '../lang/helpers';
import { reportError } from '../utils/report-error';
import { displayHost } from './display-host';

/**
 * "MCP Client Configuration" section — one copy button that puts the
 * client JSON fragment on the clipboard. The fragment is the "obsidian"
 * entry that slots into a client's `mcpServers` map.
 */
export function renderMcpConfigSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
): void {
  containerEl.createEl('h2', { text: t('heading_mcp_client_config') });

  new Setting(containerEl)
    .setName(t('setting_client_config_name'))
    .setDesc(t('setting_client_config_desc'))
    .addExtraButton((btn) =>
      btn
        .setIcon('copy')
        .setTooltip(t('tooltip_copy_config'))
        .onClick(() => {
          navigator.clipboard
            .writeText(buildMcpConfigJson(plugin))
            .then(() => {
              new Notice(t('notice_config_copied'));
            })
            .catch(reportError('copy MCP client config', plugin.logger));
        }),
    );
}

export function buildMcpConfigJson(plugin: McpPlugin): string {
  const address = plugin.settings.serverAddress;
  const port = plugin.settings.port;
  const accessKey = plugin.settings.accessKey;
  const authEnabled = plugin.settings.authEnabled;
  const scheme = plugin.settings.httpsEnabled ? 'https' : 'http';
  const url = `${scheme}://${displayHost(address)}:${String(port)}/mcp`;

  const config: Record<string, unknown> = { type: 'http', url };

  if (authEnabled && accessKey) {
    config.headers = {
      Authorization: `Bearer ${accessKey}`,
    };
  }

  const full = JSON.stringify({ obsidian: config }, null, 2);
  const lines = full.split('\n');
  return lines
    .slice(1, -1)
    .map((line) => line.slice(2))
    .join('\n');
}
