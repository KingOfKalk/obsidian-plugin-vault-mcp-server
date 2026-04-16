import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { randomBytes } from 'crypto';
import type McpPlugin from './main';

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

  private renderServerStatus(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Server Status' });

    const isRunning = this.plugin.httpServer?.isRunning ?? false;
    const port = this.plugin.settings.port;
    const clients = this.plugin.httpServer?.connectedClients ?? 0;

    const address = this.plugin.settings.serverAddress;
    const statusText = isRunning
      ? `Running on http://${address}:${String(port)} (${String(clients)} connection${clients !== 1 ? 's' : ''})`
      : 'Stopped';

    new Setting(containerEl)
      .setName('Status')
      .setDesc(statusText)
      .addButton((btn) => {
        btn.setButtonText('Start').onClick(() => {
          void this.plugin.startServer().then(() => {
            this.display();
          });
        });
        btn.buttonEl.disabled = isRunning;
      })
      .addButton((btn) => {
        btn.setButtonText('Stop').onClick(() => {
          void this.plugin.stopServer().then(() => {
            this.display();
          });
        });
        btn.buttonEl.disabled = !isRunning;
      })
      .addButton((btn) => {
        btn.setButtonText('Restart').onClick(() => {
          void this.plugin.restartServer().then(() => {
            this.display();
          });
        });
        btn.buttonEl.disabled = !isRunning;
      });
  }

  private renderServerSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Server Settings' });

    const addressSetting = new Setting(containerEl)
      .setName('Server Address')
      .setDesc('IP address the server binds to (default: 127.0.0.1). Requires restart.')
      .addText((text) =>
        text
          .setPlaceholder('127.0.0.1')
          .setValue(this.plugin.settings.serverAddress)
          .onChange(async (value) => {
            if (isValidIPv4(value)) {
              this.plugin.settings.serverAddress = value;
              await this.plugin.saveSettings();
            }
          }),
      );

    if (this.plugin.settings.serverAddress !== '127.0.0.1') {
      addressSetting.descEl.createEl('br');
      addressSetting.descEl.createEl('strong', {
        text: 'Warning: Non-localhost address exposes the server to the network. Ensure an access key is set.',
      });
    }

    new Setting(containerEl)
      .setName('Port')
      .setDesc('HTTP port for the MCP server (default: 28741)')
      .addText((text) =>
        text
          .setPlaceholder('28741')
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc(`http://${this.plugin.settings.serverAddress}:${String(this.plugin.settings.port)}/mcp`)
      .addExtraButton((btn) =>
        btn
          .setIcon('copy')
          .setTooltip('Copy server URL')
          .onClick(() => {
            const url = `http://${this.plugin.settings.serverAddress}:${String(this.plugin.settings.port)}/mcp`;
            void navigator.clipboard.writeText(url).then(() => {
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
      .addButton((btn) =>
        btn.setButtonText('Generate').onClick(async () => {
          this.plugin.settings.accessKey = generateAccessKey();
          await this.plugin.saveSettings();
          this.display();
        }),
      );

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

    const desc = containerEl.createEl('p', {
      text: 'Add this to the mcpServers section of your MCP client configuration.',
      cls: 'setting-item-description',
    });
    desc.style.marginBottom = '8px';

    const config = this.buildMcpConfigJson();

    const wrapper = containerEl.createDiv({ cls: 'mcp-config-preview' });

    const textarea = wrapper.createEl('textarea', {
      cls: 'mcp-config-textarea',
    });
    textarea.value = config;
    textarea.rows = config.split('\n').length + 1;
    textarea.spellcheck = false;

    const actions = wrapper.createDiv({ cls: 'mcp-config-actions' });

    const copyBtn = actions.createEl('button', {
      text: 'Copy',
      cls: 'mcp-config-btn',
    });
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(textarea.value).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('mcp-config-btn--copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('mcp-config-btn--copied');
        }, 2000);
      });
    });

    const regenBtn = actions.createEl('button', {
      text: 'Regenerate',
      cls: 'mcp-config-btn',
    });
    regenBtn.addEventListener('click', () => {
      const newConfig = this.buildMcpConfigJson();
      textarea.value = newConfig;
      textarea.rows = newConfig.split('\n').length + 1;
    });
  }

  private buildMcpConfigJson(): string {
    const address = this.plugin.settings.serverAddress;
    const port = this.plugin.settings.port;
    const accessKey = this.plugin.settings.accessKey;
    const url = `http://${address}:${String(port)}/mcp`;

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

    containerEl.createEl('h2', { text: 'Feature Modules' });

    if (modules.length === 0) {
      containerEl.createEl('p', {
        text: 'No modules registered. Click "Refresh Modules" to re-run discovery.',
        cls: 'setting-item-description',
      });
    }

    for (const registration of modules) {
      const { metadata } = registration.module;

      const setting = new Setting(containerEl)
        .setName(metadata.name)
        .setDesc(metadata.description)
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

      if (metadata.supportsReadOnly) {
        setting.addToggle((toggle) =>
          toggle
            .setValue(registration.readOnly)
            .setTooltip('Read-only mode')
            .onChange(async (value) => {
              this.plugin.registry.setReadOnly(metadata.id, value);
              this.plugin.settings.moduleStates = this.plugin.registry.getState();
              await this.plugin.saveSettings();
            }),
        );
      }
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText('Refresh Modules').onClick(() => {
        this.plugin.refreshModules();
        this.display();
      }),
    );
  }
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

  return data;
}
