import { ObsidianAdapter } from '../obsidian/adapter';
import { ToolModule } from '../registry/types';
import { createEditorModule } from './editor';
import { createExtrasModule } from './extras';
import { createPluginInteropModule } from './plugin-interop';
import { createSearchModule } from './search';
import { createTemplatesModule } from './templates';
import { createUiModule } from './ui';
import { createVaultModule } from './vault';
import { createWorkspaceModule } from './workspace';

/**
 * Options passed through to every module factory. Modules ignore fields
 * they don't care about; only plugin-interop currently reads
 * `getExecuteCommandAllowlist`.
 */
export interface ModuleOptions {
  getExecuteCommandAllowlist?: () => string[];
}

export type ModuleFactory = (
  adapter: ObsidianAdapter,
  options?: ModuleOptions,
) => ToolModule;

export const MODULE_FACTORIES: ModuleFactory[] = [
  createVaultModule,
  createEditorModule,
  createSearchModule,
  createWorkspaceModule,
  createUiModule,
  createTemplatesModule,
  createPluginInteropModule,
  createExtrasModule,
];

export function discoverModules(
  adapter: ObsidianAdapter,
  options: ModuleOptions = {},
): ToolModule[] {
  return MODULE_FACTORIES.map((factory) => factory(adapter, options));
}
