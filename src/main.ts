import { Notice, Plugin, setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, McpPluginSettings, TlsCertificateData } from './types';
import { createLogger, Logger } from './utils/logger';
import { ModuleRegistry } from './registry/module-registry';
import { createMcpServer } from './server/mcp-server';
import { HttpMcpServer } from './server/http-server';
import { generateSelfSignedCert } from './server/tls';
import { CustomTlsError, loadAndValidateCustomTls } from './server/custom-tls';
import { RealObsidianAdapter, ObsidianAdapter } from './obsidian/adapter';
import { discoverModules } from './tools';
import { McpSettingsTab, migrateSettings } from './settings';
import { t } from './lang/helpers';
import { createLogFileSink } from './utils/log-file';
import { reportError } from './utils/report-error';
import { DebugInfoModal } from './ui/debug-info-modal';

const ICON_MCP = 'plug';
const ICON_MCP_RUNNING = 'plug-zap';

export default class McpPlugin extends Plugin {
  settings: McpPluginSettings = DEFAULT_SETTINGS;
  logger!: Logger;
  registry!: ModuleRegistry;
  adapter!: ObsidianAdapter;
  httpServer: HttpMcpServer | null = null;
  lastStartError: { port: number; message: string } | null = null;
  private statusBarItem: HTMLElement | null = null;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.logger = createLogger('mcp-plugin', {
      debugMode: this.settings.debugMode,
      accessKey: this.settings.accessKey,
      sink: createLogFileSink(this),
    });

    this.adapter = new RealObsidianAdapter(this.app);
    this.registry = new ModuleRegistry(this.logger);

    this.registerDiscoveredModules();

    // Add settings tab
    this.addSettingTab(new McpSettingsTab(this.app, this));

    // Add ribbon icon
    this.ribbonIconEl = this.addRibbonIcon(
      ICON_MCP,
      t('ribbon_mcp_server'),
      () => {
        if (this.httpServer?.isRunning) {
          this.stopServer().catch(reportError('stop server', this.logger));
        } else {
          this.startServer().catch(reportError('start server', this.logger));
        }
      },
    );

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();

    // Register commands
    this.addCommand({
      id: 'start-server',
      name: t('command_start_server'),
      callback: () => {
        this.startServer().catch(reportError('start server', this.logger));
      },
    });

    this.addCommand({
      id: 'stop-server',
      name: t('command_stop_server'),
      callback: () => {
        this.stopServer().catch(reportError('stop server', this.logger));
      },
    });

    this.addCommand({
      id: 'restart-server',
      name: t('command_restart_server'),
      callback: () => {
        this.restartServer().catch(reportError('restart server', this.logger));
      },
    });

    this.addCommand({
      id: 'copy-access-key',
      name: t('command_copy_access_key'),
      callback: () => {
        navigator.clipboard
          .writeText(this.settings.accessKey)
          .then(() => {
            new Notice(t('notice_access_key_copied'));
          })
          .catch(reportError('copy access key', this.logger));
      },
    });

    this.addCommand({
      id: 'copy-debug-info',
      name: t('command_copy_debug_info'),
      callback: () => {
        new DebugInfoModal(this.app, this).open();
      },
    });

    // Start server only when explicitly opted in. If auth is enabled, require
    // a configured access key — otherwise every request would be rejected.
    const canAutoStart =
      this.settings.autoStart &&
      (!this.settings.authEnabled || this.settings.accessKey.length > 0);
    if (canAutoStart) {
      await this.startServer();
    } else {
      if (!this.settings.autoStart) {
        this.logger.info('MCP server not started: auto-start is disabled');
      } else {
        this.logger.info(
          'MCP server not started: Bearer auth is on but no access key is configured',
        );
      }
      this.updateStatusDisplay();
    }
  }

  onunload(): void {
    this.stopServer().catch(reportError('stop server', this.logger));
  }

  async startServer(): Promise<void> {
    const attemptedPort = this.settings.port;
    let tls: TlsCertificateData | undefined;
    if (this.settings.httpsEnabled) {
      try {
        tls = await this.resolveTls();
      } catch (error) {
        const message = this.formatTlsError(error);
        this.logger.error(`Failed to start MCP server: ${message}`);
        new Notice(t('notice_custom_tls_server_refused', { message }));
        return;
      }
    }

    const server = new HttpMcpServer(
      () => createMcpServer(this.registry, this.logger),
      this.logger,
      {
        host: this.settings.serverAddress,
        port: attemptedPort,
        authEnabled: this.settings.authEnabled,
        accessKey: this.settings.accessKey,
        tls,
      },
    );

    try {
      await server.start();
      this.httpServer = server;
      this.lastStartError = null;
      this.updateStatusDisplay();
      new Notice(t('notice_server_started', { port: attemptedPort }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start MCP server: ${message}`);
      this.lastStartError = { port: attemptedPort, message };
      this.updateStatusDisplay();
      new Notice(t('notice_server_start_failed', { message }));
    }
  }

  async regenerateTlsCertificate(): Promise<void> {
    this.settings.tlsCertificate = null;
    await this.saveSettings();
    await this.ensureTlsCertificate();
  }

  private async resolveTls(): Promise<TlsCertificateData> {
    if (this.settings.useCustomTls) {
      const { customTlsCertPath, customTlsKeyPath } = this.settings;
      if (!customTlsCertPath || !customTlsKeyPath) {
        throw new CustomTlsError(
          !customTlsCertPath ? 'cert_not_readable' : 'key_not_readable',
        );
      }
      return loadAndValidateCustomTls(customTlsCertPath, customTlsKeyPath);
    }
    return this.ensureTlsCertificate();
  }

  private formatTlsError(error: unknown): string {
    if (error instanceof CustomTlsError) {
      switch (error.code) {
        case 'cert_not_readable':
          return t('error_custom_tls_cert_not_readable');
        case 'key_not_readable':
          return t('error_custom_tls_key_not_readable');
        case 'invalid_cert':
          return t('error_custom_tls_invalid_cert');
        case 'invalid_key':
          return t('error_custom_tls_invalid_key');
        case 'key_cert_mismatch':
          return t('error_custom_tls_key_cert_mismatch');
        case 'cert_expired':
          return t('error_custom_tls_cert_expired');
      }
    }
    return error instanceof Error ? error.message : String(error);
  }

  private async ensureTlsCertificate(): Promise<TlsCertificateData> {
    if (this.settings.tlsCertificate) {
      return this.settings.tlsCertificate;
    }
    this.logger.info('Generating self-signed TLS certificate');
    const cert = await generateSelfSignedCert({
      hosts: [this.settings.serverAddress],
    });
    this.settings.tlsCertificate = cert;
    await this.saveSettings();
    return cert;
  }

  async stopServer(): Promise<void> {
    if (this.httpServer) {
      await this.httpServer.stop();
      this.httpServer = null;
      this.lastStartError = null;
      this.updateStatusDisplay();
    }
  }

  async restartServer(): Promise<void> {
    await this.stopServer();
    await this.startServer();
  }

  refreshModules(): void {
    this.registry.clear();
    this.registerDiscoveredModules();
  }

  private registerDiscoveredModules(): void {
    const modules = discoverModules(this.adapter, {
      getExecuteCommandAllowlist: () => this.settings.executeCommandAllowlist,
    });
    for (const module of modules) {
      this.registry.registerModule(module);
    }
    this.registry.applyState(this.settings.moduleStates);
  }

  private updateStatusDisplay(): void {
    const isRunning = this.httpServer?.isRunning ?? false;
    const failure = !isRunning ? this.lastStartError : null;

    // Update status bar: three states — running, stopped, or failed-to-start.
    if (this.statusBarItem) {
      this.statusBarItem.empty();
      this.statusBarItem.title = '';
      this.statusBarItem.ariaLabel = '';
      if (isRunning) {
        this.statusBarItem.setText(`MCP :${String(this.settings.port)}`);
      } else if (failure) {
        this.statusBarItem.createEl('span', {
          cls: 'mcp-statusbar-error',
          text: `MCP :${String(failure.port)}`,
        });
        const tooltip = t('status_bar_port_in_use', { port: failure.port });
        this.statusBarItem.title = tooltip;
        this.statusBarItem.ariaLabel = tooltip;
      }
    }

    // Update ribbon icon glyph + aria label
    if (this.ribbonIconEl) {
      setIcon(this.ribbonIconEl, isRunning ? ICON_MCP_RUNNING : ICON_MCP);
      this.ribbonIconEl.ariaLabel = isRunning
        ? t('ribbon_tooltip_running', { port: this.settings.port })
        : t('ribbon_tooltip_stopped');
    }
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    const migrated = raw ? migrateSettings(raw) : {};
    this.settings = { ...DEFAULT_SETTINGS, ...migrated };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
