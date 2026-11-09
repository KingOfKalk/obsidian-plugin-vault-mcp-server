/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion */
import { App, Notice, TFile, TFolder, TAbstractFile, Vault } from 'obsidian';
import { FolderNotFoundError } from '../tools/shared/errors';
import { buildTagIndex, type TagUsage } from './tag-index';

export type { TagUsage } from './tag-index';

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
  /**
   * Atomically read, transform and save a text file (`app.vault.process`).
   * `fn` runs synchronously on the current content; if it throws, nothing
   * is written and the error propagates. Resolves to the new content.
   */
  processFile(path: string, fn: (content: string) => string): Promise<string>;
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
  /**
   * Atomically read, modify and save a note's YAML frontmatter. `fn`
   * receives the parsed frontmatter object (empty when the note has none)
   * and mutates it in place. The real adapter delegates to Obsidian's
   * `fileManager.processFrontMatter()`, which writes the YAML, keeps key
   * order and creates the block if missing.
   */
  processFrontMatter(path: string, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  getTags(path: string): string[];
  /**
   * Vault-wide tag index: for every tag (with leading `#`), the files that
   * use it — each file listed once, in vault order — and `count`, the total
   * number of occurrences across those files (a file using a tag twice
   * counts twice).
   */
  getAllTags(): Record<string, TagUsage>;
  getHeadings(path: string): Array<{ heading: string; level: number }>;
  getLinks(path: string): Array<{ link: string; displayText?: string }>;
  getEmbeds(path: string): Array<{ link: string; displayText?: string }>;
  getBacklinks(path: string): string[];
  /**
   * For every file that links to `path` (same set and order as
   * `getBacklinks`), the 0-based line numbers of the links/embeds in that
   * file that resolve to `path`. A backlink whose links carry no line
   * position (e.g. frontmatter links) gets an empty `lines` array.
   */
  getBacklinkLines(path: string): Array<{ path: string; lines: number[] }>;
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

  // Vault settings
  /**
   * The user's "Files and links → Automatically update internal links"
   * setting (Obsidian config key `alwaysUpdateLinks`). `null` when it
   * cannot be read.
   */
  getAutoUpdateLinks(): boolean | null;
  /**
   * Where `deleteFile` / `deleteFolder` send things, from the user's
   * "Files and links → Deleted files" setting (Obsidian config key
   * `trashOption`): `system` trash, the `vault`'s `.trash` folder, or
   * `permanent`. `unknown` when it cannot be read.
   */
  getTrashDestination(): TrashDestination;
}

/** Where a deleted file or folder went (see `getTrashDestination`). */
export type TrashDestination = 'system' | 'vault' | 'permanent' | 'unknown';

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

/** Narrow guard for the undeclared `Vault.getConfig(key)`. */
function hasGetConfig(value: unknown): value is { getConfig: (key: string) => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getConfig?: unknown }).getConfig === 'function'
  );
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
    await this.ensureParentFolder(path);
    await this.app.vault.create(path, content);
  }

  async modifyFile(path: string, content: string): Promise<void> {
    const file = this.getFile(path);
    await this.app.vault.modify(file, content);
  }

  async processFile(path: string, fn: (content: string) => string): Promise<string> {
    const file = this.getFile(path);
    return this.app.vault.process(file, fn);
  }

  async deleteFile(path: string): Promise<void> {
    const file = this.getFile(path);
    await this.trash(file);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const file = this.getAbstractFile(oldPath);
    await this.ensureParentFolder(newPath);
    // `fileManager.renameFile` updates links to the moved file according
    // to the user's "Automatically update internal links" setting;
    // `vault.rename` would leave them pointing at the old path (#405).
    await this.app.fileManager.renameFile(file, newPath);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    const file = this.getFile(sourcePath);
    await this.ensureParentFolder(destPath);
    await this.app.vault.copy(file, destPath);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data);
    } else {
      await this.ensureParentFolder(path);
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
    await this.trash(folder);
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

  async processFrontMatter(
    path: string,
    fn: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    const file = this.getFile(path);
    await this.app.fileManager.processFrontMatter(file, fn);
  }

  getTags(path: string): string[] {
    const file = this.getFile(path);
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.tags) return [];
    return cache.tags.map((t: { tag: string }) => t.tag);
  }

  getAllTags(): Record<string, TagUsage> {
    return buildTagIndex(
      this.app.vault.getMarkdownFiles().map((file) => ({
        path: file.path,
        tags: this.getTags(file.path),
      })),
    );
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

  getBacklinkLines(path: string): Array<{ path: string; lines: number[] }> {
    const cacheApi = this.app.metadataCache;
    return this.getBacklinks(path).map((sourcePath) => {
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      const cache = source instanceof TFile ? cacheApi.getFileCache(source) : null;
      const refs: Array<{ link: string; position?: { start: { line: number }; end: { line: number } } }> = [
        ...(cache?.links ?? []),
        ...(cache?.embeds ?? []),
      ];
      const lines = new Set<number>();
      for (const ref of refs) {
        if (!ref.position) continue;
        const linkpath = ref.link.split('#')[0];
        const dest = cacheApi.getFirstLinkpathDest(linkpath, sourcePath);
        if (dest?.path !== path) continue;
        for (let l = ref.position.start.line; l <= ref.position.end.line; l++) {
          lines.add(l);
        }
      }
      return { path: sourcePath, lines: [...lines].sort((a, b) => a - b) };
    });
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
        //
        // `allowHtml: false` (#431): with Dataview's default export
        // settings, list and object values inside TABLE cells are rendered
        // as `<ul><li>…</li></ul>` HTML (ui/export/markdown.ts,
        // rawTableLiteral). Without HTML Dataview renders them as plain
        // text (`a, b`). Dataview merges the partial settings with the
        // user's own (date format, null rendering), so nothing else changes.
        const out = await api.queryMarkdown(query, undefined, { allowHtml: false });
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

  getAutoUpdateLinks(): boolean | null {
    const value = this.readVaultConfig('alwaysUpdateLinks');
    return typeof value === 'boolean' ? value : null;
  }

  getTrashDestination(): TrashDestination {
    // Without fileManager.trashFile (Obsidian < 1.6.6) `trash()` falls
    // back to vault.trash(file, true), i.e. the system trash, whatever
    // the setting says.
    const fileManager = this.app.fileManager as Partial<App['fileManager']> | undefined;
    if (typeof fileManager?.trashFile !== 'function') return 'system';
    switch (this.readVaultConfig('trashOption')) {
      case 'system':
        return 'system';
      case 'local':
        return 'vault';
      case 'none':
        return 'permanent';
      default:
        return 'unknown';
    }
  }

  /**
   * Read a value from the vault config (`.obsidian/app.json`) via
   * `app.vault.getConfig`, which Obsidian has but does not declare in its
   * public typings. Returns `undefined` when the method is missing or
   * throws.
   */
  private readVaultConfig(key: string): unknown {
    const vault: unknown = this.app.vault;
    if (!hasGetConfig(vault)) return undefined;
    try {
      return vault.getConfig(key);
    } catch {
      return undefined;
    }
  }

  /**
   * Remove a file or folder the way the user configured under "Deleted
   * files" (system trash, the vault's .trash folder, or permanently)
   * instead of always deleting for good like `vault.delete` (#405).
   * `fileManager.trashFile` exists since Obsidian 1.6.6; older versions
   * (minAppVersion is 1.5.0) fall back to `vault.trash(file, true)`,
   * which uses the system trash and the .trash folder if that fails.
   */
  private async trash(file: TAbstractFile): Promise<void> {
    const fileManager = this.app.fileManager as Partial<App['fileManager']> | undefined;
    if (typeof fileManager?.trashFile === 'function') {
      await fileManager.trashFile(file);
      return;
    }
    await this.app.vault.trash(file, true);
  }

  /**
   * Create every missing ancestor folder of `path` so writes into a new
   * folder do not fail with a raw ENOENT from the filesystem (#405).
   */
  private async ensureParentFolder(path: string): Promise<void> {
    const parts = path.split('/').filter((p) => p.length > 0);
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) {
        throw new Error(`Cannot create folder "${current}": a file with that name exists`);
      }
      await this.app.vault.createFolder(current);
    }
  }

  private getFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }
    return file;
  }

  private getFolder(path: string): TFolder {
    // `getAbstractFileByPath('')` does not return the root folder, so the
    // vault root ("", "/" or ".") is resolved explicitly (#388).
    if (path === '' || path === '/' || path === '.') {
      return this.app.vault.getRoot();
    }
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
