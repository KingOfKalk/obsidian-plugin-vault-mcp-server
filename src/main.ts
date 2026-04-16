import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, McpPluginSettings } from './types';

export default class McpPlugin extends Plugin {
  settings: McpPluginSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
  }

  onunload(): void {
    // Cleanup will be added as features are implemented
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<McpPluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
