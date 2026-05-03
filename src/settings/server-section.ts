import { Notice, Setting } from 'obsidian';
import type McpPlugin from '../main';
import { t } from '../lang/helpers';
import { reportError } from '../utils/report-error';
import {
  createValidationError,
  generateAccessKey,
  isValidIPv4,
} from './validation';
import { renderHttpsSection } from './https-section';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOOPBACK_ORIGIN_PREFIXES = [
  'http://127.0.0.1',
  'http://localhost',
  'https://127.0.0.1',
  'https://localhost',
  'http://[::1]',
  'https://[::1]',
];

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function hasNonLoopbackHost(hosts: string[]): boolean {
  return hosts.some((h) => !LOOPBACK_HOSTS.has(h.toLowerCase()));
}

function hasNonLoopbackOrigin(origins: string[]): boolean {
  return origins.some((o) => {
    const lower = o.toLowerCase();
    return !LOOPBACK_ORIGIN_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(prefix + ':'));
  });
}

function scheme(plugin: McpPlugin): 'http' | 'https' {
  return plugin.settings.httpsEnabled ? 'https' : 'http';
}

/**
 * "Server Status" section — running/stopped indicator with toggle and
 * restart button. Clicking the toggle drives the plugin's start/stop
 * lifecycle and re-renders the whole tab on completion.
 */
export function renderServerStatusSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  refresh: () => void,
): void {
  containerEl.createEl('h2', { text: t('heading_server_status') });

  const isRunning = plugin.httpServer?.isRunning ?? false;
  const port = plugin.settings.port;
  const clients = plugin.httpServer?.connectedClients ?? 0;

  const address = plugin.settings.serverAddress;
  const url = `${scheme(plugin)}://${address}:${String(port)}`;
  const statusText = isRunning
    ? clients === 1
      ? t('status_running_one', { url })
      : t('status_running_many', { url, count: clients })
    : t('status_stopped');

  const setting = new Setting(containerEl)
    .setName(t('setting_status_name'))
    .setDesc(statusText);

  if (isRunning) {
    setting.addExtraButton((btn) =>
      btn
        .setIcon('refresh-cw')
        .setTooltip(t('tooltip_restart_server'))
        .onClick(() => {
          plugin
            .restartServer()
            .then(() => {
              refresh();
            })
            .catch(reportError('restart server', plugin.logger));
        }),
    );
  }

  setting.addToggle((toggle) =>
    toggle
      .setValue(isRunning)
      .setTooltip(isRunning ? t('tooltip_stop_server') : t('tooltip_start_server'))
      .onChange((value) => {
        const action = value ? plugin.startServer() : plugin.stopServer();
        action
          .then(() => {
            refresh();
          })
          .catch(
            reportError(
              value ? 'start server' : 'stop server',
              plugin.logger,
            ),
          );
      }),
  );
}

/**
 * "Server Settings" section — bind address, port, access key, HTTPS,
 * autostart. Delegates the custom-TLS subsection to `renderTlsSection`
 * when HTTPS is on and the user opted into bring-your-own certificates.
 */
export function renderServerSettingsSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  refresh: () => void,
): void {
  containerEl.createEl('h2', { text: t('heading_server_settings') });

  const addressSetting = new Setting(containerEl)
    .setName(t('setting_server_address_name'))
    .setDesc(t('setting_server_address_desc'));
  const addressError = createValidationError(addressSetting);
  addressSetting.addText((text) =>
    text
      .setPlaceholder('127.0.0.1')
      .setValue(plugin.settings.serverAddress)
      .onChange(async (value) => {
        if (isValidIPv4(value)) {
          addressError.clear();
          plugin.settings.serverAddress = value;
          await plugin.saveSettings();
        } else {
          addressError.show(t('error_invalid_ipv4'));
        }
      }),
  );

  if (plugin.settings.serverAddress !== '127.0.0.1') {
    addressSetting.descEl.createEl('br');
    addressSetting.descEl.createEl('strong', {
      text: t('warning_non_localhost'),
    });
  }

  const portSetting = new Setting(containerEl)
    .setName(t('setting_port_name'))
    .setDesc(t('setting_port_desc'));
  const portError = createValidationError(portSetting);
  const portStartError = createValidationError(portSetting);
  const startFailure = plugin.lastStartError;
  if (startFailure && startFailure.port === plugin.settings.port) {
    portStartError.show(
      t('settings_port_in_use_error', { port: startFailure.port }),
    );
  }
  portSetting.addText((text) =>
    text
      .setPlaceholder('28741')
      .setValue(String(plugin.settings.port))
      .onChange(async (value) => {
        const port = parseInt(value, 10);
        if (/^\d+$/.test(value) && !isNaN(port) && port > 0 && port < 65536) {
          portError.clear();
          portStartError.clear();
          plugin.settings.port = port;
          await plugin.saveSettings();
        } else {
          portError.show(t('error_invalid_port'));
        }
      }),
  );

  const serverUrl = `${scheme(plugin)}://${plugin.settings.serverAddress}:${String(plugin.settings.port)}/mcp`;
  new Setting(containerEl)
    .setName(t('setting_server_url_name'))
    .setDesc(serverUrl)
    .addExtraButton((btn) =>
      btn
        .setIcon('copy')
        .setTooltip(t('tooltip_copy_server_url'))
        .onClick(() => {
          navigator.clipboard
            .writeText(serverUrl)
            .then(() => {
              new Notice(t('notice_server_url_copied'));
            })
            .catch(reportError('copy server URL', plugin.logger));
        }),
    );

  new Setting(containerEl)
    .setName(t('setting_auth_enabled_name'))
    .setDesc(t('setting_auth_enabled_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.authEnabled).onChange(async (value) => {
        plugin.settings.authEnabled = value;
        // Turning auth on clears the explicit insecure-mode flag so the
        // user has to opt into it again if they later turn auth back off.
        if (value && plugin.settings.iAcceptInsecureMode) {
          plugin.settings.iAcceptInsecureMode = false;
        }
        await plugin.saveSettings();
        refresh();
      }),
    );

  if (!plugin.settings.authEnabled) {
    new Setting(containerEl)
      .setName(t('setting_insecure_mode_name'))
      .setDesc(t('setting_insecure_mode_desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.settings.iAcceptInsecureMode)
          .onChange(async (value) => {
            plugin.settings.iAcceptInsecureMode = value;
            await plugin.saveSettings();
            refresh();
          }),
      );
  }

  if (plugin.settings.authEnabled) {
    new Setting(containerEl)
      .setName(t('setting_access_key_name'))
      .setDesc(t('setting_access_key_desc'))
      .addText((text) =>
        text
          .setPlaceholder(t('placeholder_access_key'))
          .setValue(plugin.settings.accessKey)
          .onChange(async (value) => {
            plugin.settings.accessKey = value;
            await plugin.saveSettings();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip(t('tooltip_copy_access_key'))
          .onClick(() => {
            navigator.clipboard
              .writeText(plugin.settings.accessKey)
              .then(() => {
                new Notice(t('notice_access_key_copied'));
              })
              .catch(reportError('copy access key', plugin.logger));
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon('refresh-cw')
          .setTooltip(t('tooltip_generate'))
          .onClick(() => {
            plugin.settings.accessKey = generateAccessKey();
            plugin
              .saveSettings()
              .then(() => {
                refresh();
              })
              .catch(reportError('save settings', plugin.logger));
          }),
      );
  }

  new Setting(containerEl)
    .setName(t('setting_https_name'))
    .setDesc(t('setting_https_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.httpsEnabled).onChange(async (value) => {
        plugin.settings.httpsEnabled = value;
        await plugin.saveSettings();
        refresh();
      }),
    );

  if (plugin.settings.httpsEnabled) {
    renderHttpsSection(containerEl, plugin, refresh);
  }

  new Setting(containerEl)
    .setName(t('setting_autostart_name'))
    .setDesc(t('setting_autostart_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.autoStart).onChange(async (value) => {
        plugin.settings.autoStart = value;
        await plugin.saveSettings();
      }),
    );

  new Setting(containerEl)
    .setName(t('setting_resources_enabled_name'))
    .setDesc(t('setting_resources_enabled_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.resourcesEnabled).onChange(async (value) => {
        plugin.settings.resourcesEnabled = value;
        await plugin.saveSettings();
      }),
    );

  new Setting(containerEl)
    .setName(t('setting_prompts_enabled_name'))
    .setDesc(t('setting_prompts_enabled_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.promptsEnabled).onChange(async (value) => {
        plugin.settings.promptsEnabled = value;
        await plugin.saveSettings();
      }),
    );

  renderDnsRebindSection(containerEl, plugin, refresh);
}

/**
 * "DNS Rebind Protection" subsection — Origin/Host allowlists plus the
 * two boolean knobs (`allowNullOrigin`, `requireOrigin`). Validation is
 * done in `src/server/origin-host.ts`; this UI just edits the settings.
 */
function renderDnsRebindSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  refresh: () => void,
): void {
  containerEl.createEl('h3', { text: t('heading_dns_rebind') });

  const originsSetting = new Setting(containerEl)
    .setName(t('setting_allowed_origins_name'))
    .setDesc(t('setting_allowed_origins_desc'));
  const originsTextarea = containerEl.createEl('textarea', {
    cls: 'mcp-allowed-origins',
    attr: {
      rows: '4',
      placeholder: 'http://127.0.0.1\nhttp://localhost',
    },
  });
  originsTextarea.value = plugin.settings.allowedOrigins.join('\n');
  const originWarning = createValidationError(originsSetting);
  if (hasNonLoopbackOrigin(plugin.settings.allowedOrigins)) {
    originWarning.show(t('warning_non_loopback_origin'));
  }
  originsTextarea.addEventListener('change', () => {
    const next = parseLines(originsTextarea.value);
    plugin.settings.allowedOrigins = next;
    if (hasNonLoopbackOrigin(next)) {
      originWarning.show(t('warning_non_loopback_origin'));
    } else {
      originWarning.clear();
    }
    plugin
      .saveSettings()
      .catch(reportError('save allowedOrigins', plugin.logger));
  });

  const hostsSetting = new Setting(containerEl)
    .setName(t('setting_allowed_hosts_name'))
    .setDesc(t('setting_allowed_hosts_desc'));
  const hostsTextarea = containerEl.createEl('textarea', {
    cls: 'mcp-allowed-hosts',
    attr: { rows: '3', placeholder: '127.0.0.1\nlocalhost' },
  });
  hostsTextarea.value = plugin.settings.allowedHosts.join('\n');
  const hostWarning = createValidationError(hostsSetting);
  if (hasNonLoopbackHost(plugin.settings.allowedHosts)) {
    hostWarning.show(t('warning_non_loopback_host'));
  }
  hostsTextarea.addEventListener('change', () => {
    const next = parseLines(hostsTextarea.value);
    plugin.settings.allowedHosts = next;
    if (hasNonLoopbackHost(next)) {
      hostWarning.show(t('warning_non_loopback_host'));
    } else {
      hostWarning.clear();
    }
    plugin
      .saveSettings()
      .catch(reportError('save allowedHosts', plugin.logger));
  });

  new Setting(containerEl)
    .setName(t('setting_allow_null_origin_name'))
    .setDesc(t('setting_allow_null_origin_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.allowNullOrigin).onChange(async (value) => {
        plugin.settings.allowNullOrigin = value;
        await plugin.saveSettings();
      }),
    );

  new Setting(containerEl)
    .setName(t('setting_require_origin_name'))
    .setDesc(t('setting_require_origin_desc'))
    .addToggle((toggle) =>
      toggle.setValue(plugin.settings.requireOrigin).onChange(async (value) => {
        plugin.settings.requireOrigin = value;
        await plugin.saveSettings();
        refresh();
      }),
    );
}
