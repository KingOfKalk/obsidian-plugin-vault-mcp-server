import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { randomBytes } from 'crypto';
import type McpPlugin from './main';
import type { ModuleRegistration } from './registry/types';
import { t, type TranslationKey } from './lang/helpers';
import { clearLogFile, getLogFilePath } from './utils/log-file';
import { DebugInfoModal } from './ui/debug-info-modal';
import {
  CustomTlsError,
  loadAndValidateCustomTls,
} from './server/custom-tls';
import { pickFile } from './utils/file-picker';

export class McpSettingsTab extends PluginSettingTab {
  plugin: McpPlugin;

  constructor(app: App, plugin: McpPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderServerStatus(containerEl);
    this.renderServerSettings(containerEl);
    this.renderMcpConfig(containerEl);
    this.renderModuleToggles(containerEl);
    this.renderDiagnostics(containerEl);
  }

  private scheme(): 'http' | 'https' {
    return this.plugin.settings.httpsEnabled ? 'https' : 'http';
  }

  private renderServerStatus(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: t('heading_server_status') });

    const isRunning = this.plugin.httpServer?.isRunning ?? false;
    const port = this.plugin.settings.port;
    const clients = this.plugin.httpServer?.connectedClients ?? 0;

    const address = this.plugin.settings.serverAddress;
    const url = `${this.scheme()}://${address}:${String(port)}`;
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
            void this.plugin.restartServer().then(() => {
              this.display();
            });
          }),
      );
    }

    setting.addToggle((toggle) =>
      toggle
        .setValue(isRunning)
        .setTooltip(isRunning ? t('tooltip_stop_server') : t('tooltip_start_server'))
        .onChange((value) => {
          const action = value
            ? this.plugin.startServer()
            : this.plugin.stopServer();
          void action.then(() => {
            this.display();
          });
        }),
    );
  }

  private renderServerSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: t('heading_server_settings') });

    const addressSetting = new Setting(containerEl)
      .setName(t('setting_server_address_name'))
      .setDesc(t('setting_server_address_desc'));
    const addressError = createValidationError(addressSetting);
    addressSetting.addText((text) =>
      text
        .setPlaceholder('127.0.0.1')
        .setValue(this.plugin.settings.serverAddress)
        .onChange(async (value) => {
          if (isValidIPv4(value)) {
            addressError.clear();
            this.plugin.settings.serverAddress = value;
            await this.plugin.saveSettings();
          } else {
            addressError.show(t('error_invalid_ipv4'));
          }
        }),
    );

    if (this.plugin.settings.serverAddress !== '127.0.0.1') {
      addressSetting.descEl.createEl('br');
      addressSetting.descEl.createEl('strong', {
        text: t('warning_non_localhost'),
      });
    }

    const portSetting = new Setting(containerEl)
      .setName(t('setting_port_name'))
      .setDesc(t('setting_port_desc'));
    const portError = createValidationError(portSetting);
    portSetting.addText((text) =>
      text
        .setPlaceholder('28741')
        .setValue(String(this.plugin.settings.port))
        .onChange(async (value) => {
          const port = parseInt(value, 10);
          if (/^\d+$/.test(value) && !isNaN(port) && port > 0 && port < 65536) {
            portError.clear();
            this.plugin.settings.port = port;
            await this.plugin.saveSettings();
          } else {
            portError.show(t('error_invalid_port'));
          }
        }),
    );

    const serverUrl = `${this.scheme()}://${this.plugin.settings.serverAddress}:${String(this.plugin.settings.port)}/mcp`;
    new Setting(containerEl)
      .setName(t('setting_server_url_name'))
      .setDesc(serverUrl)
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip(t('tooltip_copy_server_url'))
          .onClick(() => {
            void navigator.clipboard.writeText(serverUrl).then(() => {
              new Notice(t('notice_server_url_copied'));
            });
          }),
      );

    new Setting(containerEl)
      .setName(t('setting_auth_enabled_name'))
      .setDesc(t('setting_auth_enabled_desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.authEnabled)
          .onChange(async (value) => {
            this.plugin.settings.authEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.authEnabled) {
      new Setting(containerEl)
        .setName(t('setting_access_key_name'))
        .setDesc(t('setting_access_key_desc'))
        .addText((text) =>
          text
            .setPlaceholder(t('placeholder_access_key'))
            .setValue(this.plugin.settings.accessKey)
            .onChange(async (value) => {
              this.plugin.settings.accessKey = value;
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((btn) =>
          btn
            .setIcon('copy')
            .setTooltip(t('tooltip_copy_access_key'))
            .onClick(() => {
              void navigator.clipboard
                .writeText(this.plugin.settings.accessKey)
                .then(() => {
                  new Notice(t('notice_access_key_copied'));
                });
            }),
        )
        .addExtraButton((btn) =>
          btn
            .setIcon('refresh-cw')
            .setTooltip(t('tooltip_generate'))
            .onClick(() => {
              this.plugin.settings.accessKey = generateAccessKey();
              void this.plugin.saveSettings().then(() => {
                this.display();
              });
            }),
        );
    }

    new Setting(containerEl)
      .setName(t('setting_https_name'))
      .setDesc(t('setting_https_desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.httpsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.httpsEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.httpsEnabled) {
      if (!this.plugin.settings.useCustomTls) {
        const hasCert = this.plugin.settings.tlsCertificate !== null;
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
                void this.plugin.regenerateTlsCertificate().then(() => {
                  new Notice(t('notice_tls_regenerated'));
                  this.display();
                });
              }),
          );
      }

      new Setting(containerEl)
        .setName(t('setting_custom_tls_toggle_name'))
        .setDesc(t('setting_custom_tls_toggle_desc'))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.useCustomTls)
            .onChange(async (value) => {
              this.plugin.settings.useCustomTls = value;
              await this.plugin.saveSettings();
              this.display();
            }),
        );

      if (this.plugin.settings.useCustomTls) {
        this.renderCustomTlsGroup(containerEl);
      }
    }

    new Setting(containerEl)
      .setName(t('setting_autostart_name'))
      .setDesc(t('setting_autostart_desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoStart)
          .onChange(async (value) => {
            this.plugin.settings.autoStart = value;
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderCustomTlsGroup(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: t('heading_custom_tls_group') });

    const certSetting = new Setting(containerEl)
      .setName(t('setting_custom_tls_cert_name'))
      .setDesc(
        t('setting_custom_tls_cert_desc', {
          path:
            this.plugin.settings.customTlsCertPath ?? t('label_no_file_selected'),
        }),
      );
    const certError = createValidationError(certSetting);
    certSetting.addButton((btn) =>
      btn.setButtonText(t('button_browse')).onClick(() => {
        void this.pickCustomTlsPath('cert');
      }),
    );

    const keySetting = new Setting(containerEl)
      .setName(t('setting_custom_tls_key_name'))
      .setDesc(
        t('setting_custom_tls_key_desc', {
          path:
            this.plugin.settings.customTlsKeyPath ?? t('label_no_file_selected'),
        }),
      );
    const keyError = createValidationError(keySetting);
    keySetting.addButton((btn) =>
      btn.setButtonText(t('button_browse')).onClick(() => {
        void this.pickCustomTlsPath('key');
      }),
    );

    const { customTlsCertPath, customTlsKeyPath } = this.plugin.settings;
    if (customTlsCertPath && customTlsKeyPath) {
      void loadAndValidateCustomTls(customTlsCertPath, customTlsKeyPath).then(
        () => {
          certError.clear();
          keyError.clear();
        },
        (err: unknown) => {
          this.showCustomTlsError(err, certError, keyError);
        },
      );
    }
  }

  private async pickCustomTlsPath(kind: 'cert' | 'key'): Promise<void> {
    const title =
      kind === 'cert' ? t('dialog_title_pick_cert') : t('dialog_title_pick_key');
    const filters =
      kind === 'cert'
        ? [
            { name: 'PEM certificate', extensions: ['pem', 'crt', 'cer'] },
            { name: 'All files', extensions: ['*'] },
          ]
        : [
            { name: 'PEM private key', extensions: ['pem', 'key'] },
            { name: 'All files', extensions: ['*'] },
          ];
    const chosen = await pickFile({ title, filters });
    if (!chosen) return;

    if (kind === 'cert') {
      this.plugin.settings.customTlsCertPath = chosen;
    } else {
      this.plugin.settings.customTlsKeyPath = chosen;
    }
    await this.plugin.saveSettings();
    this.display();
  }

  private showCustomTlsError(
    err: unknown,
    certError: ValidationErrorController,
    keyError: ValidationErrorController,
  ): void {
    if (!(err instanceof CustomTlsError)) {
      certError.show(err instanceof Error ? err.message : String(err));
      keyError.clear();
      return;
    }
    const key: TranslationKey = `error_custom_tls_${err.code}`;
    const message = t(key);
    switch (err.code) {
      case 'cert_not_readable':
      case 'invalid_cert':
      case 'cert_expired':
        certError.show(message);
        keyError.clear();
        return;
      case 'key_not_readable':
      case 'invalid_key':
        keyError.show(message);
        certError.clear();
        return;
      case 'key_cert_mismatch':
        certError.show(message);
        keyError.show(message);
        return;
    }
  }

  private renderMcpConfig(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: t('heading_mcp_client_config') });

    new Setting(containerEl)
      .setName(t('setting_client_config_name'))
      .setDesc(t('setting_client_config_desc'))
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip(t('tooltip_copy_config'))
          .onClick(() => {
            void navigator.clipboard
              .writeText(this.buildMcpConfigJson())
              .then(() => {
                new Notice(t('notice_config_copied'));
              });
          }),
      );
  }

  private buildMcpConfigJson(): string {
    const address = this.plugin.settings.serverAddress;
    const port = this.plugin.settings.port;
    const accessKey = this.plugin.settings.accessKey;
    const authEnabled = this.plugin.settings.authEnabled;
    const url = `${this.scheme()}://${address}:${String(port)}/mcp`;

    const config: Record<string, unknown> = { url };

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

  private renderDiagnostics(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: t('heading_diagnostics') });

    new Setting(containerEl)
      .setName(t('setting_debug_name'))
      .setDesc(t('setting_debug_desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            this.plugin.logger.updateOptions({ debugMode: value });
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t('setting_log_file_name'))
      .setDesc(getLogFilePath(this.plugin));

    new Setting(containerEl)
      .setName(t('setting_copy_debug_info_name'))
      .setDesc(t('setting_copy_debug_info_desc'))
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip(t('tooltip_copy_debug_info'))
          .onClick(() => {
            new DebugInfoModal(this.plugin.app, this.plugin).open();
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
            void clearLogFile(this.plugin).then(() => {
              new Notice(t('notice_log_cleared'));
            });
          }),
      );
  }

  private renderModuleToggles(containerEl: HTMLElement): void {
    const modules = this.plugin.registry.getModules();
    const coreModules = modules.filter((r) => !r.module.metadata.group);
    const extrasModules = modules.filter(
      (r) => r.module.metadata.group === 'extras',
    );

    containerEl.createEl('h2', { text: t('heading_feature_modules') });

    if (modules.length === 0) {
      containerEl.createEl('p', {
        text: t('message_no_modules'),
        cls: 'setting-item-description',
      });
    }

    for (const registration of coreModules) {
      this.renderModuleRow(containerEl, registration);
    }

    if (extrasModules.length > 0) {
      containerEl.createEl('h2', { text: t('heading_extras') });
      for (const registration of extrasModules) {
        this.renderExtrasToolRows(containerEl, registration);
      }
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText(t('button_refresh_modules')).onClick(() => {
        this.plugin.refreshModules();
        this.display();
      }),
    );
  }

  private renderExtrasToolRows(
    containerEl: HTMLElement,
    registration: ModuleRegistration,
  ): void {
    const moduleId = registration.module.metadata.id;
    const tools = registration.module.tools();

    for (const tool of tools) {
      new Setting(containerEl)
        .setName(tool.name)
        .setDesc(tool.description)
        .addToggle((toggle) =>
          toggle
            .setValue(registration.toolStates[tool.name] ?? false)
            .onChange(async (value) => {
              this.plugin.registry.setToolEnabled(moduleId, tool.name, value);
              this.plugin.settings.moduleStates = this.plugin.registry.getState();
              await this.plugin.saveSettings();
            }),
        );
    }
  }

  private renderModuleRow(
    containerEl: HTMLElement,
    registration: ModuleRegistration,
  ): void {
    const { metadata } = registration.module;

    const card = containerEl.createDiv({ cls: 'mcp-module-card' });

    new Setting(card)
      .setName(metadata.name)
      .setDesc(metadata.description)
      .setClass('mcp-module-card-header')
      .addToggle((toggle) =>
        toggle.setValue(registration.enabled).onChange(async (value) => {
          if (value) {
            this.plugin.registry.enableModule(metadata.id);
          } else {
            this.plugin.registry.disableModule(metadata.id);
          }
          this.plugin.settings.moduleStates = this.plugin.registry.getState();
          await this.plugin.saveSettings();
        }),
      );
  }
}

interface ValidationErrorController {
  show: (message: string) => void;
  clear: () => void;
}

function createValidationError(setting: Setting): ValidationErrorController {
  let errorEl: HTMLElement | null = null;
  return {
    show: (message: string): void => {
      if (errorEl) {
        errorEl.textContent = message;
        return;
      }
      errorEl = setting.descEl.createEl('div', {
        cls: 'mcp-settings-error',
        text: message,
      });
    },
    clear: (): void => {
      if (errorEl) {
        errorEl.remove();
        errorEl = null;
      }
    },
  };
}

export function generateAccessKey(): string {
  return randomBytes(32).toString('hex');
}

export function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return /^\d{1,3}$/.test(part) && num >= 0 && num <= 255;
  });
}

export function migrateSettings(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const version = (data.schemaVersion as number) ?? 0;

  if (version < 1) {
    data.schemaVersion = 1;
    // V0 -> V1: ensure all required fields exist
    if (!data.port) data.port = 28741;
    if (!data.accessKey) data.accessKey = '';
    if (data.httpsEnabled === undefined) data.httpsEnabled = false;
    if (data.debugMode === undefined) data.debugMode = false;
    if (!data.moduleStates) data.moduleStates = {};
  }

  if ((data.schemaVersion as number) < 2) {
    data.schemaVersion = 2;
    // V1 -> V2: add serverAddress
    if (!data.serverAddress) data.serverAddress = '127.0.0.1';
  }

  if ((data.schemaVersion as number) < 3) {
    data.schemaVersion = 3;
    // V2 -> V3: add autoStart, default off for existing installs (explicit opt-in)
    if (data.autoStart === undefined) data.autoStart = false;
  }

  if ((data.schemaVersion as number) < 4) {
    data.schemaVersion = 4;
    // V3 -> V4:
    //   - drop per-module readOnly flag; keep only `enabled`
    //   - extras moves from module-level enable to per-tool enable. Preserve
    //     behavior: if the extras module was previously enabled, enable its
    //     known tools; otherwise leave them off.
    const moduleStates = (data.moduleStates ?? {}) as Record<
      string,
      { enabled?: boolean; readOnly?: boolean; toolStates?: Record<string, boolean> }
    >;
    for (const id of Object.keys(moduleStates)) {
      const entry = moduleStates[id];
      if (entry && typeof entry === 'object') {
        delete entry.readOnly;
      }
    }
    const extras = moduleStates.extras;
    if (extras && extras.toolStates === undefined) {
      extras.toolStates = extras.enabled ? { get_date: true } : {};
    }
    data.moduleStates = moduleStates;
  }

  if ((data.schemaVersion as number) < 5) {
    data.schemaVersion = 5;
    // V4 -> V5: introduce cached self-signed TLS certificate.
    if (data.tlsCertificate === undefined) data.tlsCertificate = null;
  }

  if ((data.schemaVersion as number) < 6) {
    data.schemaVersion = 6;
    // V5 -> V6: introduce optional Bearer authentication. Default to off so
    // existing installs match new-install behaviour; users who want auth can
    // toggle it back on in Server Settings.
    if (data.authEnabled === undefined) data.authEnabled = false;
  }

  if ((data.schemaVersion as number) < 7) {
    data.schemaVersion = 7;
    // V6 -> V7: bring-your-own SSL certificate. Default to off so existing
    // installs keep their cached self-signed cert; `tlsCertificate` is
    // preserved so toggling the feature back off restores prior behaviour.
    if (data.useCustomTls === undefined) data.useCustomTls = false;
    if (data.customTlsCertPath === undefined) data.customTlsCertPath = null;
    if (data.customTlsKeyPath === undefined) data.customTlsKeyPath = null;
  }

  return data;
}
