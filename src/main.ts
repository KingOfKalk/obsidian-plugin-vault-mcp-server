import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, McpPluginSettings } from './types';
import { createLogger, Logger } from './utils/logger';
import { ModuleRegistry } from './registry/module-registry';
import { createMcpServer } from './server/mcp-server';
import { HttpMcpServer } from './server/http-server';
import { McpSettingsTab, migrateSettings } from './settings';

const ICON_MCP = 'plug';

export default class McpPlugin extends Plugin {
  settings: McpPluginSettings = DEFAULT_SETTINGS;
  logger!: Logger;
  registry!: ModuleRegistry;
  httpServer: HttpMcpServer | null = null;
  private statusBarItem: { setText: (text: string) => void } | null = null;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.logger = createLogger('mcp-plugin', {
      debugMode: this.settings.debugMode,
      accessKey: this.settings.accessKey,
    });

    this.registry = new ModuleRegistry(this.logger);

    // Apply saved module states
    this.registry.applyState(this.settings.moduleStates);

    // Add settings tab
    this.addSettingTab(new McpSettingsTab(this.app, this));

    // Add ribbon icon
    this.ribbonIconEl = this.addRibbonIcon(
      ICON_MCP,
      'MCP Server',
      () => {
        if (this.httpServer?.isRunning) {
          void this.stopServer();
        } else {
          void this.startServer();
        }
      },
    );

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();

    // Register commands
    this.addCommand({
      id: 'start-server',
      name: 'Start MCP Server',
      callback: () => {
        void this.startServer();
      },
    });

    this.addCommand({
      id: 'stop-server',
      name: 'Stop MCP Server',
      callback: () => {
        void this.stopServer();
      },
    });

    this.addCommand({
      id: 'restart-server',
      name: 'Restart MCP Server',
      callback: () => {
        void this.restartServer();
      },
    });

    this.addCommand({
      id: 'copy-access-key',
      name: 'Copy Access Key',
      callback: () => {
        void navigator.clipboard.writeText(this.settings.accessKey).then(() => {
          new Notice('Access key copied to clipboard');
        });
      },
    });

    // Start server if access key is configured
    if (this.settings.accessKey) {
      await this.startServer();
    } else {
      this.logger.info('MCP server not started: no access key configured');
      this.updateStatusDisplay();
    }
  }

  onunload(): void {
    void this.stopServer();
  }

  async startServer(): Promise<void> {
    try {
      this.httpServer = new HttpMcpServer(
        () => createMcpServer(this.registry, this.logger),
        this.logger,
        {
          host: this.settings.serverAddress,
          port: this.settings.port,
          accessKey: this.settings.accessKey,
        },
      );
      await this.httpServer.start();
      this.updateStatusDisplay();
      new Notice(`MCP server started on port ${String(this.settings.port)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start MCP server: ${message}`);
      new Notice(`Failed to start MCP server: ${message}`);
    }
  }

  async stopServer(): Promise<void> {
    if (this.httpServer) {
      await this.httpServer.stop();
      this.httpServer = null;
      this.updateStatusDisplay();
    }
  }

  async restartServer(): Promise<void> {
    await this.stopServer();
    await this.startServer();
  }

  private updateStatusDisplay(): void {
    const isRunning = this.httpServer?.isRunning ?? false;

    // Update status bar
    if (this.statusBarItem) {
      this.statusBarItem.setText(
        isRunning ? `MCP :${String(this.settings.port)}` : '',
      );
    }

    // Update ribbon icon
    if (this.ribbonIconEl) {
      this.ribbonIconEl.ariaLabel = isRunning
        ? `MCP Server (running on :${String(this.settings.port)})`
        : 'MCP Server (stopped)';
    }
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    const migrated = raw ? migrateSettings(raw) : {};
    this.settings = { ...DEFAULT_SETTINGS, ...migrated } as McpPluginSettings;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
