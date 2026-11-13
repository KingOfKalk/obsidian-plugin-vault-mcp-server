export interface FilePickerOptions {
  title: string;
  filters: { name: string; extensions: string[] }[];
}

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronDialog {
  showOpenDialog(opts: {
    title: string;
    properties: string[];
    filters: { name: string; extensions: string[] }[];
  }): Promise<OpenDialogResult>;
}

interface ElectronModule {
  remote?: { dialog?: ElectronDialog };
  dialog?: ElectronDialog;
}

type RequireFn = (module: string) => unknown;

function resolveDialog(): ElectronDialog | null {
  // Obsidian's desktop window has Node's `require` (#557: `window`, not
  // `globalThis`). There is no window in the unit tests.
  if (typeof window === 'undefined') return null;
  const req = (window as Window & { require?: RequireFn }).require;
  if (typeof req !== 'function') return null;

  const fromElectron = tryRequire<ElectronModule>(req, 'electron');
  const viaRemote = fromElectron?.remote?.dialog;
  if (viaRemote) return viaRemote;

  const fromRemote = tryRequire<ElectronModule>(req, '@electron/remote');
  if (fromRemote?.dialog) return fromRemote.dialog;

  return null;
}

function tryRequire<T>(req: RequireFn, moduleName: string): T | null {
  try {
    return req(moduleName) as T;
  } catch {
    return null;
  }
}

/**
 * Thin wrapper over Electron's native open-file dialog.
 * Returns the absolute path the user picked, or `null` if the dialog was
 * cancelled or Electron's dialog API is unavailable (e.g. in unit tests).
 */
export async function pickFile(
  options: FilePickerOptions,
): Promise<string | null> {
  const dialog = resolveDialog();
  if (!dialog) return null;

  const result = await dialog.showOpenDialog({
    title: options.title,
    properties: ['openFile'],
    filters: options.filters,
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}
