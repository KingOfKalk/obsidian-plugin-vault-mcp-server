import { App, PluginSettingTab } from 'obsidian';
import type McpPlugin from '../main';
import { renderServerStatusSection, renderServerSettingsSection } from './server-section';
import { renderMcpConfigSection } from './mcp-config-section';
import { renderModulesSection } from './modules-section';
import { renderAllowlistSection } from './allowlist-section';
import { renderDiagnosticsSection } from './diagnostics-section';

/**
 * Obsidian MCP settings tab — thin composer. Each section lives in its
 * own file under `src/settings/`; this class stitches them together and
 * forwards `refresh = () => this.display()` for sections that need to
 * re-render the whole tab after a toggle.
 */
export class McpSettingsTab extends PluginSettingTab {
  plugin: McpPlugin;

  constructor(app: App, plugin: McpPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const refresh = (): void => {
      this.display();
    };

    renderServerStatusSection(containerEl, this.plugin, refresh);
    renderServerSettingsSection(containerEl, this.plugin, refresh);
    renderMcpConfigSection(containerEl, this.plugin);
    renderModulesSection(containerEl, this.plugin, refresh);
    renderAllowlistSection(containerEl, this.plugin);
    renderDiagnosticsSection(containerEl, this.plugin);
  }
}
