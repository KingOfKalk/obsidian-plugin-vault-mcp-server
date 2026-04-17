import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { randomBytes } from 'crypto';
import type McpPlugin from './main';
import type { ModuleRegistration } from './registry/types';

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
  }

  private scheme(): 'http' | 'https' {
    return this.plugin.settings.httpsEnabled ? 'https' : 'http';
  }

  private renderServerStatus(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Server Status' });

    const isRunning = this.plugin.httpServer?.isRunning ?? false;
    const port = this.plugin.settings.port;
    const clients = this.plugin.httpServer?.connectedClients ?? 0;

    const address = this.plugin.settings.serverAddress;
    const statusText = isRunning
      ? `Running on ${this.scheme()}://${address}:${String(port)} (${String(clients)} connection${clients !== 1 ? 's' : ''})`
      : 'Stopped';

    const setting = new Setting(containerEl)
      .setName('Status')
      .setDesc(statusText)
      .addToggle((toggle) =>
        toggle
          .setValue(isRunning)
          .setTooltip(isRunning ? 'Stop MCP server' : 'Start MCP server')
          .onChange((value) => {
            const action = value
              ? this.plugin.startServer()
              : this.plugin.stopServer();
            void action.then(() => {
              this.display();
            });
          }),
      );

    if (isRunning) {
      setting.addExtraButton((btn) =>
        btn
          .setIcon('refresh-cw')
          .setTooltip('Restart server')
          .onClick(() => {
            void this.plugin.restartServer().then(() => {
              this.display();
            });
          }),
      );
    }
  }

  private renderServerSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Server Settings' });

    const addressSetting = new Setting(containerEl)
      .setName('Server Address')
      .setDesc('IP address the server binds to (default: 127.0.0.1). Requires restart.');
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
            addressError.show('Invalid IPv4 address. Expected format: 127.0.0.1');
          }
        }),
    );

    if (this.plugin.settings.serverAddress !== '127.0.0.1') {
      addressSetting.descEl.createEl('br');
      addressSetting.descEl.createEl('strong', {
        text: 'Warning: Non-localhost address exposes the server to the network. Ensure an access key is set.',
      });
    }

    const portSetting = new Setting(containerEl)
      .setName('Port')
      .setDesc('HTTP port for the MCP server (default: 28741)');
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
            portError.show('Invalid port. Enter a whole number between 1 and 65535.');
          }
        }),
    );

    const serverUrl = `${this.scheme()}://${this.plugin.settings.serverAddress}:${String(this.plugin.settings.port)}/mcp`;
    new Setting(containerEl)
      .setName('Server URL')
      .setDesc(serverUrl)
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip('Copy server URL')
          .onClick(() => {
            void navigator.clipboard.writeText(serverUrl).then(() => {
              new Notice('MCP server URL copied to clipboard');
            });
          }),
      );

    new Setting(containerEl)
      .setName('Access Key')
      .setDesc('Bearer token for authenticating MCP clients')
      .addText((text) =>
        text
          .setPlaceholder('Enter access key')
          .setValue(this.plugin.settings.accessKey)
          .onChange(async (value) => {
            this.plugin.settings.accessKey = value;
            await this.plugin.saveSettings();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip('Copy access key')
          .onClick(() => {
            void navigator.clipboard
              .writeText(this.plugin.settings.accessKey)
              .then(() => {
                new Notice('Access key copied to clipboard');
              });
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon('refresh-cw')
          .setTooltip('Generate')
          .onClick(() => {
            this.plugin.settings.accessKey = generateAccessKey();
            void this.plugin.saveSettings().then(() => {
              this.display();
            });
          }),
      );

    new Setting(containerEl)
      .setName('HTTPS')
      .setDesc(
        'Serve MCP over HTTPS with a locally generated self-signed certificate. Clients must trust the certificate (or disable certificate verification). Requires restart.',
      )
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
      const hasCert = this.plugin.settings.tlsCertificate !== null;
      new Setting(containerEl)
        .setName('TLS Certificate')
        .setDesc(
          hasCert
            ? 'A self-signed certificate is cached. Regenerate to replace it (e.g. after changing the server address).'
            : 'No certificate cached yet — one will be generated on the next server start.',
        )
        .addExtraButton((btn) =>
          btn
            .setIcon('refresh-cw')
            .setTooltip('Regenerate certificate')
            .onClick(() => {
              void this.plugin.regenerateTlsCertificate().then(() => {
                new Notice('TLS certificate regenerated. Restart the server to apply.');
                this.display();
              });
            }),
        );
    }

    new Setting(containerEl)
      .setName('Auto-start on launch')
      .setDesc('Start MCP server automatically when Obsidian launches')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoStart)
          .onChange(async (value) => {
            this.plugin.settings.autoStart = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Debug Mode')
      .setDesc('Enable verbose logging of MCP requests and responses')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            this.plugin.logger.updateOptions({ debugMode: value });
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderMcpConfig(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'MCP Client Configuration' });

    new Setting(containerEl)
      .setName('Client configuration')
      .setDesc(
        'Copy the JSON snippet for your MCP client and paste it into the mcpServers section of its config (Claude Desktop, Claude Code, …).',
      )
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip('Copy configuration')
          .onClick(() => {
            void navigator.clipboard
              .writeText(this.buildMcpConfigJson())
              .then(() => {
                new Notice('MCP client configuration copied to clipboard');
              });
          }),
      );
  }

  private buildMcpConfigJson(): string {
    const address = this.plugin.settings.serverAddress;
    const port = this.plugin.settings.port;
    const accessKey = this.plugin.settings.accessKey;
    const url = `${this.scheme()}://${address}:${String(port)}/mcp`;

    const config: Record<string, unknown> = { url };

    if (accessKey) {
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

  private renderModuleToggles(containerEl: HTMLElement): void {
    const modules = this.plugin.registry.getModules();
    const coreModules = modules.filter((r) => !r.module.metadata.group);
    const extrasModules = modules.filter(
      (r) => r.module.metadata.group === 'extras',
    );

    containerEl.createEl('h2', { text: 'Feature Modules' });

    if (modules.length === 0) {
      containerEl.createEl('p', {
        text: 'No modules registered. Click "Refresh Modules" to re-run discovery.',
        cls: 'setting-item-description',
      });
    }

    for (const registration of coreModules) {
      this.renderModuleRow(containerEl, registration);
    }

    if (extrasModules.length > 0) {
      containerEl.createEl('h2', { text: 'Extras' });
      for (const registration of extrasModules) {
        this.renderExtrasToolRows(containerEl, registration);
      }
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText('Refresh Modules').onClick(() => {
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

  return data;
}
