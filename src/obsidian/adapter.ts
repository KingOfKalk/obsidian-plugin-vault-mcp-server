/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion */
import { App, Notice, TFile, TFolder, TAbstractFile, Vault } from 'obsidian';
import { FolderNotFoundError } from '../tools/shared/errors';

export interface FileStat {
  size: number;
  ctime: number;
  mtime: number;
}

export interface ListResult {
  files: string[];
  folders: string[];
}

export interface ObsidianAdapter {
  // File operations
  readFile(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  createFile(path: string, content: string): Promise<void>;
  modifyFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  copyFile(sourcePath: string, destPath: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;

  // Folder operations
  createFolder(path: string): Promise<void>;
  deleteFolder(path: string, recursive: boolean): Promise<void>;

  // Query operations
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | null>;
  list(path: string): ListResult;
  listRecursive(path: string): ListResult;

  // Vault info
  getVaultPath(): string;

  // Metadata operations
  getFileContent(path: string): Promise<string>;
  getFrontmatter(path: string): Record<string, unknown> | null;
  getTags(path: string): string[];
  getAllTags(): Record<string, string[]>;
  getHeadings(path: string): Array<{ heading: string; level: number }>;
  getLinks(path: string): Array<{ link: string; displayText?: string }>;
  getEmbeds(path: string): Array<{ link: string; displayText?: string }>;
  getBacklinks(path: string): string[];
  getResolvedLinks(): Record<string, Record<string, number>>;
  getUnresolvedLinks(): Record<string, Record<string, number>>;
  getAllFiles(): string[];

  // Editor operations
  getActiveFileContent(): string | null;
  getActiveFilePath(): string | null;
  getActiveLineCount(): number | null;
  insertTextAt(line: number, ch: number, text: string): boolean;
  replaceRange(fromLine: number, fromCh: number, toLine: number, toCh: number, text: string): boolean;
  deleteRange(fromLine: number, fromCh: number, toLine: number, toCh: number): boolean;
  getCursorPosition(): { line: number; ch: number } | null;
  setCursorPosition(line: number, ch: number): boolean;
  getSelection(): { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string } | null;
  setSelection(fromLine: number, fromCh: number, toLine: number, toCh: number): boolean;

  // Workspace operations
  getActiveLeafInfo(): Record<string, unknown> | null;
  openFile(path: string, mode?: string): Promise<void>;
  getOpenFiles(): Array<{ path: string; leafId: string }>;
  setActiveLeaf(leafId: string): boolean;
  getWorkspaceLayout(): Record<string, unknown>;

  // UI operations
  showNotice(message: string, duration?: number): void;

  // Plugin operations
  getInstalledPlugins(): Array<{ id: string; name: string; enabled: boolean }>;
  isPluginEnabled(pluginId: string): boolean;
  executeCommand(commandId: string): boolean;
  /**
   * Return a thin, read-only wrapper over the Dataview plugin API so we
   * can run DQL queries (`queryMarkdown`) without leaking
   * `app.plugins.plugins.dataview` to the rest of the codebase.
   * Returns `null` if Dataview is not installed/enabled or the API is
   * not exposed at all (e.g. the plugin is mid-load).
   */
  getDataviewApi(): DataviewApi | null;
  /**
   * Read the Obsidian core "Daily notes" plugin's settings (`format`,
   * `folder`, `template`). Returns `null` when the plugin is disabled, not
   * present, or has no `instance.options` available. Missing individual
   * fields are normalized to Obsidian's documented defaults so callers
   * never have to handle `undefined`.
   */
  getDailyNotesSettings(): DailyNotesSettings | null;
}

/**
 * Minimal, read-only slice of Dataview's runtime API. Intentionally
 * narrowed to just `queryMarkdown(query)` — the only surface we expose
 * via `plugin_dataview_query`. Dataview's actual API has many more
 * methods; we deliberately ignore them so we don't accidentally surface
 * write-capable or JS-evaluating entry points.
 */
export interface DataviewApi {
  queryMarkdown(query: string): Promise<DataviewQueryResult>;
}

export type DataviewQueryResult =
  | { successful: true; value: string }
  | { successful: false; error: string };

/**
 * Subset of the Obsidian core "Daily notes" plugin's settings that
 * `vault_daily_note` consumes. Returned by
 * `ObsidianAdapter.getDailyNotesSettings()` already normalized — empty or
 * missing fields are replaced with Obsidian's documented defaults
 * (`'YYYY-MM-DD'`, `''`, `''`) by the real adapter.
 */
export interface DailyNotesSettings {
  format: string;
  folder: string;
  template: string;
}

export class RealObsidianAdapter implements ObsidianAdapter {
  constructor(private app: App) {}

  async readFile(path: string): Promise<string> {
    const file = this.getFile(path);
    return this.app.vault.read(file);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.getFile(path);
    return this.app.vault.readBinary(file);
  }

  async createFile(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  async modifyFile(path: string, content: string): Promise<void> {
    const file = this.getFile(path);
    await this.app.vault.modify(file, content);
  }

  async deleteFile(path: string): Promise<void> {
    const file = this.getFile(path);
    await this.app.vault.delete(file);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const file = this.getAbstractFile(oldPath);
    await this.app.vault.rename(file, newPath);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    const file = this.getFile(sourcePath);
    await this.app.vault.copy(file, destPath);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data);
    } else {
      await this.app.vault.createBinary(path, data);
    }
  }

  async createFolder(path: string): Promise<void> {
    await this.app.vault.createFolder(path);
  }

  async deleteFolder(path: string, recursive: boolean): Promise<void> {
    const folder = this.getFolder(path);
    if (!recursive && folder.children.length > 0) {
      throw new Error(`Folder "${path}" is not empty. Use recursive=true to delete.`);
    }
    await this.app.vault.delete(folder, true);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.app.vault.getAbstractFileByPath(path) !== null);
  }

  async stat(path: string): Promise<FileStat | null> {
    const stat = await this.app.vault.adapter.stat(path);
    if (!stat) return null;
    return {
      size: stat.size,
      ctime: stat.ctime,
      mtime: stat.mtime,
    };
  }

  list(path: string): ListResult {
    const folder = this.getFolder(path);
    const files: string[] = [];
    const folders: string[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile) {
        files.push(child.path);
      } else if (child instanceof TFolder) {
        folders.push(child.path);
      }
    }
    return { files, folders };
  }

  listRecursive(path: string): ListResult {
    const folder = this.getFolder(path);
    const files: string[] = [];
    const folders: string[] = [];
    Vault.recurseChildren(folder, (child: TAbstractFile) => {
      if (child instanceof TFile) {
        files.push(child.path);
      } else if (child instanceof TFolder && child.path !== folder.path) {
        folders.push(child.path);
      }
    });
    return { files, folders };
  }

  getVaultPath(): string {
    return (this.app.vault.adapter as { basePath?: string }).basePath ?? '';
  }

  async getFileContent(path: string): Promise<string> {
    return this.readFile(path);
  }

  getFrontmatter(path: string): Record<string, unknown> | null {
    const file = this.getFile(path);
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache?.frontmatter as Record<string, unknown>) ?? null;
  }

  getTags(path: string): string[] {
    const file = this.getFile(path);
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.tags) return [];
    return cache.tags.map((t: { tag: string }) => t.tag);
  }

  getAllTags(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const tags = this.getTags(file.path);
      for (const tag of tags) {
        if (!result[tag]) result[tag] = [];
        result[tag].push(file.path);
      }
    }
    return result;
  }

  getHeadings(path: string): Array<{ heading: string; level: number }> {
    const file = this.getFile(path);
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.headings) return [];
    return cache.headings.map((h: { heading: string; level: number }) => ({
      heading: h.heading,
      level: h.level,
    }));
  }

  getLinks(path: string): Array<{ link: string; displayText?: string }> {
    const file = this.getFile(path);
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.links) return [];
    return cache.links.map((l: { link: string; displayText?: string }) => ({
      link: l.link,
      displayText: l.displayText,
    }));
  }

  getEmbeds(path: string): Array<{ link: string; displayText?: string }> {
    const file = this.getFile(path);
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.embeds) return [];
    return cache.embeds.map((e: { link: string; displayText?: string }) => ({
      link: e.link,
      displayText: e.displayText,
    }));
  }

  getBacklinks(path: string): string[] {
    const resolved = this.getResolvedLinks();
    const backlinks: string[] = [];
    for (const [sourcePath, links] of Object.entries(resolved)) {
      if (path in links) {
        backlinks.push(sourcePath);
      }
    }
    return backlinks;
  }

  getResolvedLinks(): Record<string, Record<string, number>> {
    return this.app.metadataCache.resolvedLinks;
  }

  getUnresolvedLinks(): Record<string, Record<string, number>> {
    return this.app.metadataCache.unresolvedLinks;
  }

  getAllFiles(): string[] {
    return (this.app.vault.getMarkdownFiles()).map((f) => f.path);
  }

  getActiveFileContent(): string | null {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return null;
    return editor.getValue();
  }

  getActiveFilePath(): string | null {
    const file = this.app.workspace.getActiveFile();
    return file?.path ?? null;
  }

  getActiveLineCount(): number | null {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return null;
    return editor.lineCount();
  }

  insertTextAt(line: number, ch: number, text: string): boolean {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return false;
    editor.replaceRange(text, { line, ch });
    return true;
  }

  replaceRange(fromLine: number, fromCh: number, toLine: number, toCh: number, text: string): boolean {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return false;
    editor.replaceRange(text, { line: fromLine, ch: fromCh }, { line: toLine, ch: toCh });
    return true;
  }

  deleteRange(fromLine: number, fromCh: number, toLine: number, toCh: number): boolean {
    return this.replaceRange(fromLine, fromCh, toLine, toCh, '');
  }

  getCursorPosition(): { line: number; ch: number } | null {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return null;
    const cursor = editor.getCursor();
    return { line: cursor.line, ch: cursor.ch };
  }

  setCursorPosition(line: number, ch: number): boolean {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return false;
    editor.setCursor({ line, ch });
    return true;
  }

  getSelection(): { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string } | null {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return null;
    const selection = editor.getSelection();
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    return {
      from: { line: from.line, ch: from.ch },
      to: { line: to.line, ch: to.ch },
      text: selection,
    };
  }

  setSelection(fromLine: number, fromCh: number, toLine: number, toCh: number): boolean {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) return false;
    editor.setSelection({ line: fromLine, ch: fromCh }, { line: toLine, ch: toCh });
    return true;
  }

  getActiveLeafInfo(): Record<string, unknown> | null {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return null;
    const leafAny = leaf as any;
    return {
      id: leafAny.id ?? 'unknown',
      type: leaf.view?.getViewType?.() ?? 'unknown',
      filePath: (leaf.view as any)?.file?.path ?? null,
    };
  }

  async openFile(path: string, _mode?: string): Promise<void> {
    const file = this.getFile(path);
    await this.app.workspace.openLinkText(file.path, '', false);
  }

  getOpenFiles(): Array<{ path: string; leafId: string }> {
    const result: Array<{ path: string; leafId: string }> = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      const leafAny = leaf as any;
      const file = leafAny.view?.file as TFile | undefined;
      if (file) {
        result.push({ path: file.path, leafId: leafAny.id ?? 'unknown' });
      }
    });
    return result;
  }

  setActiveLeaf(leafId: string): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const leafAny = leaf as any;
      if (leafAny.id === leafId) {
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
        found = true;
      }
    });
    return found;
  }

  getWorkspaceLayout(): Record<string, unknown> {
    return this.app.workspace.getLayout() as Record<string, unknown>;
  }

  showNotice(message: string, duration?: number): void {
    new Notice(message, duration);
  }

  getInstalledPlugins(): Array<{ id: string; name: string; enabled: boolean }> {
    const appAny = this.app as any;
    const plugins = appAny.plugins;
    const result: Array<{ id: string; name: string; enabled: boolean }> = [];
    if (plugins?.manifests) {
      for (const [id, manifest] of Object.entries(plugins.manifests as Record<string, { name: string }>)) {
        result.push({
          id,
          name: manifest.name,
          enabled: !!(plugins.enabledPlugins as Set<string>)?.has(id),
        });
      }
    }
    return result;
  }

  isPluginEnabled(pluginId: string): boolean {
    const appAny = this.app as any;
    return !!(appAny.plugins?.enabledPlugins as Set<string>)?.has(pluginId);
  }

  executeCommand(commandId: string): boolean {
    const appAny = this.app as any;
    return !!appAny.commands?.executeCommandById(commandId);
  }

  getDataviewApi(): DataviewApi | null {
    const appAny = this.app as any;
    const plugin = appAny.plugins?.plugins?.dataview;
    const api = plugin?.api;
    if (!api || typeof api.queryMarkdown !== 'function') {
      return null;
    }
    return {
      queryMarkdown: async (query: string): Promise<DataviewQueryResult> => {
        // Dataview's queryMarkdown returns a Result<string, string>-style
        // object with { successful, value | error }. Pass it through.
        const out = await api.queryMarkdown(query);
        if (out?.successful === true) {
          return { successful: true, value: String(out.value ?? '') };
        }
        return {
          successful: false,
          error: String(out?.error ?? 'Dataview query failed'),
        };
      },
    };
  }

  getDailyNotesSettings(): DailyNotesSettings | null {
    const appAny = this.app as any;
    const plugin = appAny.internalPlugins?.plugins?.['daily-notes'];
    if (!plugin || plugin.enabled !== true) return null;
    const options = plugin.instance?.options;
    if (!options || typeof options !== 'object') return null;
    return {
      format: typeof options.format === 'string' && options.format.length > 0
        ? options.format
        : 'YYYY-MM-DD',
      folder: typeof options.folder === 'string' ? options.folder : '',
      template: typeof options.template === 'string' ? options.template : '',
    };
  }

  private getFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }
    return file;
  }

  private getFolder(path: string): TFolder {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) {
      throw new FolderNotFoundError(path);
    }
    return folder;
  }

  private getAbstractFile(path: string): TAbstractFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      throw new Error(`Path not found: ${path}`);
    }
    return file;
  }
}
