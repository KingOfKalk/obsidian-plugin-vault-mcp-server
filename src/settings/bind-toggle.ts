import type { Setting } from 'obsidian';
import type McpPlugin from '../main';
import type { McpPluginSettings } from '../types';

type BooleanSettingKey = {
  [K in keyof McpPluginSettings]: McpPluginSettings[K] extends boolean ? K : never;
}[keyof McpPluginSettings];

interface BindToggleOptions {
  /** Runs after the new value is set, before it is saved. */
  onChange?: (value: boolean) => void;
  /** Re-render the tab once the value is saved. */
  refresh?: () => void;
}

/**
 * Add a toggle to `setting` that shows `plugin.settings[key]` and saves
 * every change to it.
 */
export function bindToggle(
  setting: Setting,
  plugin: McpPlugin,
  key: BooleanSettingKey,
  options: BindToggleOptions = {},
): Setting {
  return setting.addToggle((toggle) =>
    toggle.setValue(plugin.settings[key]).onChange(async (value) => {
      plugin.settings[key] = value;
      options.onChange?.(value);
      await plugin.saveSettings();
      options.refresh?.();
    }),
  );
}
