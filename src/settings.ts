/**
 * Public facade for the settings module. The actual implementation lives
 * under `src/settings/` (migrations, per-section renderers, the composer
 * tab, and shared validation helpers). Everything here is re-exported so
 * existing import paths (`import { McpSettingsTab, migrateSettings } from
 * './settings'`) keep working unchanged.
 */
export { McpSettingsTab } from './settings/tab';
export { migrateSettings } from './settings/migrations';
export {
  generateAccessKey,
  isValidIPv4,
  createValidationError,
  type ValidationErrorController,
} from './settings/validation';
