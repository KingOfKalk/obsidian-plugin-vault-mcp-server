import { Logger } from '../utils/logger';
import { ModuleRegistration, ToolDefinition, ToolModule } from './types';

export type ModuleStateMap = Record<
  string,
  { enabled: boolean; readOnly: boolean; toolStates?: Record<string, boolean> }
>;

export type RegistryChangeHandler = () => void;

export class ModuleRegistry {
  private modules: Map<string, ModuleRegistration> = new Map();
  private changeHandlers: Set<RegistryChangeHandler> = new Set();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  registerModule(module: ToolModule): void {
    const { id } = module.metadata;
    if (this.modules.has(id)) {
      this.logger.warn(`Module "${id}" is already registered, skipping`);
      return;
    }
    const isExtras = module.metadata.group === 'extras';
    const toolStates: Record<string, boolean> = {};
    if (isExtras) {
      for (const tool of module.tools()) {
        toolStates[tool.name] = false;
      }
    }
    this.modules.set(id, {
      module,
      // Extras modules are always "enabled" at the module level — individual
      // tools are gated by toolStates instead.
      enabled: isExtras ? true : (module.metadata.defaultEnabled ?? true),
      readOnly: false,
      toolStates,
    });
    this.logger.info(`Registered module: ${module.metadata.name}`, { id });
    this.notifyChange();
  }

  unregisterModule(id: string): void {
    if (!this.modules.has(id)) {
      this.logger.warn(`Module "${id}" is not registered, skipping`);
      return;
    }
    this.modules.delete(id);
    this.logger.info(`Unregistered module: ${id}`);
    this.notifyChange();
  }

  enableModule(id: string): void {
    const registration = this.modules.get(id);
    if (!registration) {
      throw new Error(`Module "${id}" is not registered`);
    }
    registration.enabled = true;
    this.logger.info(`Enabled module: ${id}`);
    this.notifyChange();
  }

  disableModule(id: string): void {
    const registration = this.modules.get(id);
    if (!registration) {
      throw new Error(`Module "${id}" is not registered`);
    }
    registration.enabled = false;
    this.logger.info(`Disabled module: ${id}`);
    this.notifyChange();
  }

  setReadOnly(id: string, readOnly: boolean): void {
    const registration = this.modules.get(id);
    if (!registration) {
      throw new Error(`Module "${id}" is not registered`);
    }
    if (!registration.module.metadata.supportsReadOnly) {
      throw new Error(`Module "${id}" does not support read-only mode`);
    }
    registration.readOnly = readOnly;
    this.logger.info(`Set module "${id}" read-only: ${String(readOnly)}`);
    this.notifyChange();
  }

  setToolEnabled(moduleId: string, toolName: string, enabled: boolean): void {
    const registration = this.modules.get(moduleId);
    if (!registration) {
      throw new Error(`Module "${moduleId}" is not registered`);
    }
    if (registration.module.metadata.group !== 'extras') {
      throw new Error(
        `Module "${moduleId}" does not support per-tool enable/disable`,
      );
    }
    const hasTool = registration.module
      .tools()
      .some((t) => t.name === toolName);
    if (!hasTool) {
      throw new Error(
        `Tool "${toolName}" is not defined by module "${moduleId}"`,
      );
    }
    registration.toolStates[toolName] = enabled;
    this.logger.info(
      `Set tool "${moduleId}/${toolName}" enabled: ${String(enabled)}`,
    );
    this.notifyChange();
  }

  isToolEnabled(moduleId: string, toolName: string): boolean {
    const registration = this.modules.get(moduleId);
    if (!registration) return false;
    if (registration.module.metadata.group !== 'extras') {
      return registration.enabled;
    }
    return registration.toolStates[toolName] ?? false;
  }

  getModules(): ModuleRegistration[] {
    return Array.from(this.modules.values());
  }

  getModule(id: string): ModuleRegistration | undefined {
    return this.modules.get(id);
  }

  getActiveTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const registration of this.modules.values()) {
      if (!registration.enabled) continue;
      const isExtras = registration.module.metadata.group === 'extras';
      const moduleTools = registration.module.tools();
      for (const tool of moduleTools) {
        if (registration.readOnly && !tool.isReadOnly) continue;
        if (isExtras && !(registration.toolStates[tool.name] ?? false)) continue;
        tools.push(tool);
      }
    }
    return tools;
  }

  isModuleEnabled(id: string): boolean {
    const registration = this.modules.get(id);
    return registration?.enabled ?? false;
  }

  applyState(state: ModuleStateMap): void {
    for (const [id, moduleState] of Object.entries(state)) {
      const registration = this.modules.get(id);
      if (!registration) continue;
      const isExtras = registration.module.metadata.group === 'extras';
      if (isExtras) {
        // Extras: keep module-level enabled=true; honor per-tool state.
        const toolNames = new Set(
          registration.module.tools().map((t) => t.name),
        );
        const incoming = moduleState.toolStates ?? {};
        for (const name of toolNames) {
          registration.toolStates[name] = incoming[name] ?? false;
        }
      } else {
        registration.enabled = moduleState.enabled;
        if (registration.module.metadata.supportsReadOnly) {
          registration.readOnly = moduleState.readOnly;
        }
      }
    }
    this.notifyChange();
  }

  getState(): ModuleStateMap {
    const state: ModuleStateMap = {};
    for (const [id, registration] of this.modules.entries()) {
      const isExtras = registration.module.metadata.group === 'extras';
      state[id] = {
        enabled: registration.enabled,
        readOnly: registration.readOnly,
        ...(isExtras ? { toolStates: { ...registration.toolStates } } : {}),
      };
    }
    return state;
  }

  onChange(handler: RegistryChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  clear(): void {
    this.modules.clear();
    this.notifyChange();
  }

  private notifyChange(): void {
    for (const handler of this.changeHandlers) {
      handler();
    }
  }
}
