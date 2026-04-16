import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, McpPluginSettings } from './types';
import { createLogger, Logger } from './utils/logger';
import { ModuleRegistry } from './registry/module-registry';
import { createMcpServer } from './server/mcp-server';
import { HttpMcpServer } from './server/http-server';

export default class McpPlugin extends Plugin {
  settings: McpPluginSettings = DEFAULT_SETTINGS;
  logger!: Logger;
  registry!: ModuleRegistry;
  httpServer: HttpMcpServer | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.logger = createLogger('mcp-plugin', {
      debugMode: this.settings.debugMode,
      accessKey: this.settings.accessKey,
    });

    this.registry = new ModuleRegistry(this.logger);

    // Apply saved module states
    this.registry.applyState(this.settings.moduleStates);

    // Start server if access key is configured
    if (this.settings.accessKey) {
      await this.startServer();
    } else {
      this.logger.info('MCP server not started: no access key configured');
    }
  }

  onunload(): void {
    void this.stopServer();
  }

  async startServer(): Promise<void> {
    try {
      const mcpServer = createMcpServer(this.registry, this.logger);
      this.httpServer = new HttpMcpServer(mcpServer, this.logger, {
        port: this.settings.port,
        accessKey: this.settings.accessKey,
      });
      await this.httpServer.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start MCP server: ${message}`);
    }
  }

  async stopServer(): Promise<void> {
    if (this.httpServer) {
      await this.httpServer.stop();
      this.httpServer = null;
    }
  }

  async restartServer(): Promise<void> {
    await this.stopServer();
    await this.startServer();
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<McpPluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
