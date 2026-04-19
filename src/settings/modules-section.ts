import { Setting } from 'obsidian';
import type McpPlugin from '../main';
import type { ModuleRegistration } from '../registry/types';
import { t } from '../lang/helpers';
import { reportError } from '../utils/report-error';

/**
 * "Feature Modules" section — a toggle per core module and a per-tool
 * toggle per extras module. The "Refresh" button at the bottom
 * re-discovers modules without restarting Obsidian.
 */
export function renderModulesSection(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  refresh: () => void,
): void {
  const modules = plugin.registry.getModules();
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
    renderModuleRow(containerEl, plugin, registration);
  }

  if (extrasModules.length > 0) {
    containerEl.createEl('h2', { text: t('heading_extras') });
    for (const registration of extrasModules) {
      renderExtrasToolRows(containerEl, plugin, registration);
    }
  }

  new Setting(containerEl).addButton((btn) =>
    btn.setButtonText(t('button_refresh_modules')).onClick(() => {
      plugin.refreshModules();
      refresh();
    }),
  );
}

function renderExtrasToolRows(
  containerEl: HTMLElement,
  plugin: McpPlugin,
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
          .onChange((value) => {
            plugin.registry.setToolEnabled(moduleId, tool.name, value);
            plugin.settings.moduleStates = plugin.registry.getState();
            plugin
              .saveSettings()
              .catch(reportError('save module states', plugin.logger));
          }),
      );
  }
}

function renderModuleRow(
  containerEl: HTMLElement,
  plugin: McpPlugin,
  registration: ModuleRegistration,
): void {
  const { metadata } = registration.module;

  const card = containerEl.createDiv({ cls: 'mcp-module-card' });

  new Setting(card)
    .setName(metadata.name)
    .setDesc(metadata.description)
    .setClass('mcp-module-card-header')
    .addToggle((toggle) =>
      toggle.setValue(registration.enabled).onChange((value) => {
        if (value) {
          plugin.registry.enableModule(metadata.id);
        } else {
          plugin.registry.disableModule(metadata.id);
        }
        plugin.settings.moduleStates = plugin.registry.getState();
        plugin
          .saveSettings()
          .catch(reportError('save module states', plugin.logger));
      }),
    );
}
