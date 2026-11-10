import { describe, it, expect, vi } from 'vitest';
import { Setting, mockElement } from '../__mocks__/obsidian';
import { renderModulesSection } from '../../src/settings/modules-section';
import { ModuleRegistry } from '../../src/registry/module-registry';
import { discoverModules } from '../../src/tools';
import { MockObsidianAdapter } from '../helpers/mock-adapter';
import { DEFAULT_SETTINGS } from '../../src/types';
import { Logger } from '../../src/utils/logger';
import type McpPlugin from '../../src/main';

function render(readAndEditOnly: boolean): {
  plugin: {
    settings: typeof DEFAULT_SETTINGS;
    registry: ModuleRegistry;
    saveSettings: ReturnType<typeof vi.fn>;
  };
  row: Setting;
} {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Setting.instances = [];
  const registry = new ModuleRegistry(new Logger('test', { debugMode: false, accessKey: '' }));
  for (const m of discoverModules(new MockObsidianAdapter())) registry.registerModule(m);
  registry.setReadAndEditOnly(readAndEditOnly);
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, readAndEditOnly },
    registry,
    saveSettings: vi.fn().mockResolvedValue(undefined),
    logger: { error: vi.fn() },
    refreshModules: vi.fn(),
  };
  renderModulesSection(mockElement() as unknown as HTMLElement, plugin as unknown as McpPlugin, () => undefined);
  const row = Setting.instances.find(
    (s) => s.settingName === 'Read and edit only',
  );
  if (!row) throw new Error('no "Read and edit only" row');
  return { plugin, row };
}

describe('renderModulesSection: "Read and edit only" (#517)', () => {
  it('shows the saved value and names the hidden tools', () => {
    const { row } = render(false);
    expect(row.toggles[0]?.value).toBe(false);
    expect(row.settingDesc).toContain('vault_delete');
    expect(row.settingDesc).toContain('vault_update');
    expect(render(true).row.toggles[0]?.value).toBe(true);
  });

  it('switching it on hides the tools live and saves the setting', () => {
    const { plugin, row } = render(false);
    expect(plugin.registry.getActiveTools().map((t) => t.name)).toContain('vault_delete');

    row.toggles[0]?.callback?.(true);

    expect(plugin.settings.readAndEditOnly).toBe(true);
    expect(plugin.registry.isReadAndEditOnly()).toBe(true);
    expect(plugin.registry.getActiveTools().map((t) => t.name)).not.toContain('vault_delete');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

    row.toggles[0]?.callback?.(false);
    expect(plugin.settings.readAndEditOnly).toBe(false);
    expect(plugin.registry.getActiveTools().map((t) => t.name)).toContain('vault_delete');
  });
});
