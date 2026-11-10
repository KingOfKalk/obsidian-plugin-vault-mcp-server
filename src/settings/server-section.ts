import { Setting } from 'obsidian';
import type McpPlugin from '../main';
import { t, type TranslationKey } from '../lang/helpers';
import { reportError } from '../utils/report-error';
import { copyWithNotice } from '../utils/clipboard';
import {
  createValidationError,
  generateAccessKey,
  isValidIPv4,
} from './validation';
import { renderHttpsSection } from './https-section';
import { serverOrigin, serverUrl } from './display-host';
import { DEFAULT_ALLOWED_HOSTS, DEFAULT_ALLOWED_ORIGINS } from '../types';
import { bindToggle } from './bind-toggle';

// The default (loopback) allowlists plus IPv6 loopback.
const LOOPBACK_HOSTS = new Set([...DEFAULT_ALLOWED_HOSTS, '::1', '[::1]']);
const LOOPBACK_ORIGIN_PREFIXES = [...DEFAULT_ALLOWED_ORIGINS, 'http://[::1]', 'https://[::1]'];

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
  const clients = plugin.httpServer?.connectedClients ?? 0;

  const url = serverOrigin(plugin.settings);
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

  const url = serverUrl(plugin.settings);
  new Setting(containerEl)
    .setName(t('setting_server_url_name'))
    .setDesc(url)
    .addExtraButton((btn) =>
      btn
        .setIcon('copy')
        .setTooltip(t('tooltip_copy_server_url'))
        .onClick(() => {
          copyWithNotice(
            url,
            t('notice_server_url_copied'),
            'copy server URL',
            plugin.logger,
          );
        }),
    );

  bindToggle(
    new Setting(containerEl)
      .setName(t('setting_auth_enabled_name'))
      .setDesc(t('setting_auth_enabled_desc')),
    plugin,
    'authEnabled',
    {
      // Turning auth on clears the explicit insecure-mode flag so the
      // user has to opt into it again if they later turn auth back off.
      onChange: (value) => {
        if (value && plugin.settings.iAcceptInsecureMode) {
          plugin.settings.iAcceptInsecureMode = false;
        }
      },
      refresh,
    },
  );

  if (!plugin.settings.authEnabled) {
    bindToggle(
      new Setting(containerEl)
        .setName(t('setting_insecure_mode_name'))
        .setDesc(t('setting_insecure_mode_desc')),
      plugin,
      'iAcceptInsecureMode',
      { refresh },
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
            copyWithNotice(
              plugin.settings.accessKey,
              t('notice_access_key_copied'),
              'copy access key',
              plugin.logger,
            );
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

  bindToggle(
    new Setting(containerEl)
      .setName(t('setting_https_name'))
      .setDesc(t('setting_https_desc')),
    plugin,
    'httpsEnabled',
    { refresh },
  );

  if (plugin.settings.httpsEnabled) {
    renderHttpsSection(containerEl, plugin, refresh);
  }

  bindToggle(
    new Setting(containerEl)
      .setName(t('setting_autostart_name'))
      .setDesc(t('setting_autostart_desc')),
    plugin,
    'autoStart',
  );

  bindToggle(
    new Setting(containerEl)
      .setName(t('setting_resources_enabled_name'))
      .setDesc(t('setting_resources_enabled_desc')),
    plugin,
    'resourcesEnabled',
  );

  bindToggle(
    new Setting(containerEl)
      .setName(t('setting_prompts_enabled_name'))
      .setDesc(t('setting_prompts_enabled_desc')),
    plugin,
    'promptsEnabled',
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

  renderAllowlist(containerEl, plugin, {
    key: 'allowedOrigins',
    name: 'setting_allowed_origins_name',
    desc: 'setting_allowed_origins_desc',
    warning: 'warning_non_loopback_origin',
    cls: 'mcp-allowed-origins',
    rows: '4',
    placeholder: 'http://127.0.0.1\nhttp://localhost',
    isWide: hasNonLoopbackOrigin,
  });

  renderAllowlist(containerEl, plugin, {
    key: 'allowedHosts',
    name: 'setting_allowed_hosts_name',
    desc: 'setting_allowed_hosts_desc',
    warning: 'warning_non_loopback_host',
    cls: 'mcp-allowed-hosts',
    rows: '3',
    placeholder: '127.0.0.1\nlocalhost',
    isWide: hasNonLoopbackHost,
  });

  bindToggle(
    new Setting(containerEl)
      .setName(t('setting_allow_null_origin_name'))
      .setDesc(t('setting_allow_null_origin_desc')),
    plugin,
    'allowNullOrigin',
  );

  bindToggle(
    new Setting(containerEl)
      .setName(t('setting_require_origin_name'))
      .setDesc(t('setting_require_origin_desc')),
    plugin,
    'requireOrigin',
    { refresh },
  );
}

interface AllowlistOptions {
  key: 'allowedOrigins' | 'allowedHosts';
  name: TranslationKey;
  desc: TranslationKey;
  /** Shown while `isWide` says the list reaches beyond loopback. */
  warning: TranslationKey;
  cls: string;
  rows: string;
  placeholder: string;
  isWide: (entries: string[]) => boolean;
}

/** One-entry-per-line textarea for an Origin or Host allowlist. */
function renderAllowlist(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  options: AllowlistOptions,
): void {
  const setting = new Setting(containerEl)
    .setName(t(options.name))
    .setDesc(t(options.desc));
  const textarea = containerEl.createEl('textarea', {
    cls: options.cls,
    attr: { rows: options.rows, placeholder: options.placeholder },
  });
  textarea.value = plugin.settings[options.key].join('\n');
  const warning = createValidationError(setting);
  if (options.isWide(plugin.settings[options.key])) {
    warning.show(t(options.warning));
  }
  textarea.addEventListener('change', () => {
    const next = parseLines(textarea.value);
    plugin.settings[options.key] = next;
    if (options.isWide(next)) {
      warning.show(t(options.warning));
    } else {
      warning.clear();
    }
    plugin
      .saveSettings()
      .catch(reportError(`save ${options.key}`, plugin.logger));
  });
}
