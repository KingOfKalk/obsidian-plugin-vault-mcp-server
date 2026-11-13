import { Notice, Plugin, setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, McpPluginSettings, TlsCertificateData } from './types';
import { createLogger, Logger } from './utils/logger';
import { ModuleRegistry } from './registry/module-registry';
import { startAvailabilityPolling } from './registry/availability';
import { createMcpServer } from './server/mcp-server';
import { HttpMcpServer } from './server/http-server';
import { generateSelfSignedCert } from './server/tls';
import { insecureBindRefusal, type InsecureBindRefusal } from './server/bind-guard';
import { CustomTlsError, loadAndValidateCustomTls } from './server/custom-tls';
import { RealObsidianAdapter, ObsidianAdapter } from './obsidian/adapter';
import { discoverModules } from './tools';
import { registerVaultBasePath } from './tools/shared/errors';
import { McpSettingsTab, generateAccessKey, migrateSettings } from './settings';
import { t, type TranslationKey } from './lang/helpers';
import { createLogFileSink } from './utils/log-file';
import { reportError } from './utils/report-error';
import { copyWithNotice } from './utils/clipboard';
import { DebugInfoModal } from './ui/debug-info-modal';

const ICON_MCP = 'plug';
const ICON_MCP_RUNNING = 'plug-zap';

/** Notice shown when `startServer` refuses to bind without authentication. */
const INSECURE_REFUSAL_NOTICES: Record<InsecureBindRefusal, TranslationKey> = {
  insecure_mode_not_accepted: 'notice_insecure_mode_refused',
  insecure_non_loopback: 'notice_insecure_non_loopback_refused',
};

/** Start / stop / restart commands: id, name key, error scope, action. */
const SERVER_COMMANDS: ReadonlyArray<{
  id: string;
  name: TranslationKey;
  scope: string;
  run: (plugin: McpPlugin) => Promise<void>;
}> = [
  { id: 'start-server', name: 'command_start_server', scope: 'start server', run: (p) => p.startServer() },
  { id: 'stop-server', name: 'command_stop_server', scope: 'stop server', run: (p) => p.stopServer() },
  { id: 'restart-server', name: 'command_restart_server', scope: 'restart server', run: (p) => p.restartServer() },
];

export default class McpPlugin extends Plugin {
  settings: McpPluginSettings = DEFAULT_SETTINGS;
  logger!: Logger;
  registry!: ModuleRegistry;
  adapter!: ObsidianAdapter;
  httpServer: HttpMcpServer | null = null;
  lastStartError: { port: number; message: string } | null = null;
  private statusBarItem: HTMLElement | null = null;
  private ribbonIconEl: HTMLElement | null = null;
  private stopAvailabilityPolling: (() => void) | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.ensureAccessKey();
    await this.maybeShowInsecureModeWarning();

    this.logger = createLogger('mcp-plugin', {
      debugMode: this.settings.debugMode,
      accessKey: this.settings.accessKey,
      sink: createLogFileSink(this),
    });

    this.adapter = new RealObsidianAdapter(this.app);
    // Keep the vault's absolute location out of error messages (#405).
    registerVaultBasePath(this.adapter.getVaultPath());
    this.registry = new ModuleRegistry(this.logger);

    this.registerDiscoveredModules();

    // Plugin tools follow their plugin (#469): Obsidian has no public event
    // for a community plugin being enabled or disabled, so poll. Dataview
    // may load after this plugin; the check once the layout is ready and
    // the one at every session start cover that without waiting a poll.
    this.stopAvailabilityPolling = startAvailabilityPolling(this.registry);
    this.app.workspace.onLayoutReady(() => {
      this.registry.refreshAvailability();
    });

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
    for (const command of SERVER_COMMANDS) {
      this.addCommand({
        id: command.id,
        name: t(command.name),
        callback: () => {
          command.run(this).catch(reportError(command.scope, this.logger));
        },
      });
    }

    this.addCommand({
      id: 'copy-access-key',
      name: t('command_copy_access_key'),
      callback: () => {
        copyWithNotice(
          this.settings.accessKey,
          t('notice_access_key_copied'),
          'copy access key',
          this.logger,
        );
      },
    });

    this.addCommand({
      id: 'copy-debug-info',
      name: t('command_copy_debug_info'),
      callback: () => {
        new DebugInfoModal(this.app, this).open();
      },
    });

    // Start server only when explicitly opted in. Gate on the same
    // conditions startServer() itself checks so we never auto-start
    // into a configuration the bind path will refuse anyway.
    const canAutoStart =
      this.settings.autoStart &&
      this.canBindServer();
    if (canAutoStart) {
      await this.startServer();
    } else {
      if (!this.settings.autoStart) {
        this.logger.info('MCP server not started: auto-start is disabled');
      } else if (this.settings.authEnabled && this.settings.accessKey.length === 0) {
        this.logger.info(
          'MCP server not started: Bearer auth is on but no access key is configured',
        );
      } else if (!this.settings.authEnabled && !this.settings.iAcceptInsecureMode) {
        this.logger.info(
          'MCP server not started: auth is disabled and iAcceptInsecureMode is not set',
        );
      } else if (!this.settings.authEnabled) {
        this.logger.info(
          'MCP server not started: auth is disabled and the server address is not 127.0.0.1',
        );
      }
      this.updateStatusDisplay();
    }
  }

  /**
   * On first load with the new secure-by-default posture, generate a
   * fresh access key if auth is enabled but the key is empty.
   * Persist immediately so the user sees the value in settings without
   * having to click Generate.
   */
  private async ensureAccessKey(): Promise<void> {
    if (this.settings.authEnabled && this.settings.accessKey.length === 0) {
      this.settings.accessKey = generateAccessKey();
      await this.saveSettings();
    }
  }

  /**
   * Show a one-time notice when the v9 → v10 migration grandfathered
   * the user into insecure mode. Tracked via `seenInsecureWarning` so
   * the notice fires exactly once.
   */
  private async maybeShowInsecureModeWarning(): Promise<void> {
    if (
      !this.settings.authEnabled &&
      this.settings.iAcceptInsecureMode &&
      !this.settings.seenInsecureWarning
    ) {
      new Notice(
        t('notice_grandfather_warning'),
        15000,
      );
      this.settings.seenInsecureWarning = true;
      await this.saveSettings();
    }
  }

  /**
   * Predicate for the auto-start path. Returns false if auth is on but no
   * key is set yet, or if `startServer` would refuse to bind without auth
   * (insecure mode not accepted, or an address other than 127.0.0.1).
   */
  private canBindServer(): boolean {
    if (this.settings.authEnabled) {
      return this.settings.accessKey.length > 0;
    }
    return insecureBindRefusal(this.settings) === null;
  }

  onunload(): void {
    this.stopAvailabilityPolling?.();
    this.stopAvailabilityPolling = null;
    this.stopServer().catch(reportError('stop server', this.logger));
  }

  async startServer(): Promise<void> {
    const refusal = insecureBindRefusal(this.settings);
    if (refusal) {
      const message = t(INSECURE_REFUSAL_NOTICES[refusal]);
      this.logger.error(`Failed to start MCP server: ${message}`);
      new Notice(message, 12000);
      return;
    }
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
      () => createMcpServer(this.registry, this.adapter, this.settings, this.logger),
      this.logger,
      {
        host: this.settings.serverAddress,
        port: attemptedPort,
        authEnabled: this.settings.authEnabled,
        accessKey: this.settings.accessKey,
        tls,
        originHost: {
          allowedOrigins: this.settings.allowedOrigins,
          allowedHosts: this.settings.allowedHosts,
          allowNullOrigin: this.settings.allowNullOrigin,
          requireOrigin: this.settings.requireOrigin,
        },
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
      return t(`error_custom_tls_${error.code}`);
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
    this.registry.setReadAndEditOnly(this.settings.readAndEditOnly);
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
