import { ObsidianAdapter } from '../obsidian/adapter';
import { ToolModule } from '../registry/types';
import { createEditorModule } from './editor';
import { createPluginInteropModule } from './plugin-interop';
import { createSearchModule } from './search';
import { createTemplatesModule } from './templates';
import { createUiModule } from './ui';
import { createVaultModule } from './vault';
import { createWorkspaceModule } from './workspace';

export type ModuleFactory = (adapter: ObsidianAdapter) => ToolModule;

export const MODULE_FACTORIES: ModuleFactory[] = [
  createVaultModule,
  createEditorModule,
  createSearchModule,
  createWorkspaceModule,
  createUiModule,
  createTemplatesModule,
  createPluginInteropModule,
];

export function discoverModules(adapter: ObsidianAdapter): ToolModule[] {
  return MODULE_FACTORIES.map((factory) => factory(adapter));
}
