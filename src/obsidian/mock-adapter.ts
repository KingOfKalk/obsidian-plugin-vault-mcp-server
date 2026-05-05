import {
  DataviewApi,
  FileStat,
  ListResult,
  ObsidianAdapter,
} from './adapter';
import { FolderNotFoundError } from '../tools/shared/errors';

interface MockFileMetadata {
  frontmatter?: Record<string, unknown>;
  tags?: string[];
  headings?: Array<{ heading: string; level: number }>;
  links?: Array<{ link: string; displayText?: string }>;
  embeds?: Array<{ link: string; displayText?: string }>;
}

interface MockFile {
  content: string;
  binary?: ArrayBuffer;
  stat: FileStat;
  metadata?: MockFileMetadata;
}

/* eslint-disable @typescript-eslint/require-await */
export class MockObsidianAdapter implements ObsidianAdapter {
  private files: Map<string, MockFile> = new Map();
  private folders: Set<string> = new Set(['/']);
  private vaultPath = '/mock-vault';

  async readFile(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file.content;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    if (!file.binary) {
      const encoder = new TextEncoder();
      return encoder.encode(file.content).buffer;
    }
    return file.binary;
  }

  async createFile(path: string, content: string): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.ensureParentFolder(path);
    const now = Date.now();
    this.files.set(path, {
      content,
      stat: { size: content.length, ctime: now, mtime: now },
    });
  }

  async modifyFile(path: string, content: string): Promise<void> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    file.content = content;
    file.stat.mtime = Date.now();
    file.stat.size = content.length;
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    this.files.delete(path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const file = this.files.get(oldPath);
    const isFolder = this.folders.has(oldPath);

    if (!file && !isFolder) {
      throw new Error(`Path not found: ${oldPath}`);
    }

    if (file) {
      this.ensureParentFolder(newPath);
      this.files.set(newPath, { ...file, stat: { ...file.stat, mtime: Date.now() } });
      this.files.delete(oldPath);
    }

    if (isFolder) {
      this.folders.add(newPath);
      this.folders.delete(oldPath);
      // Move all children
      for (const [filePath, fileData] of this.files.entries()) {
        if (filePath.startsWith(oldPath + '/')) {
          const newFilePath = newPath + filePath.slice(oldPath.length);
          this.files.set(newFilePath, fileData);
          this.files.delete(filePath);
        }
      }
      for (const folderPath of this.folders) {
        if (folderPath.startsWith(oldPath + '/')) {
          const newFolderPath = newPath + folderPath.slice(oldPath.length);
          this.folders.add(newFolderPath);
          this.folders.delete(folderPath);
        }
      }
    }
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    const file = this.files.get(sourcePath);
    if (!file) throw new Error(`File not found: ${sourcePath}`);
    this.ensureParentFolder(destPath);
    const now = Date.now();
    this.files.set(destPath, {
      content: file.content,
      binary: file.binary,
      stat: { size: file.stat.size, ctime: now, mtime: now },
    });
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const existing = this.files.get(path);
    const now = Date.now();
    if (existing) {
      existing.binary = data;
      existing.stat.mtime = now;
      existing.stat.size = data.byteLength;
    } else {
      this.ensureParentFolder(path);
      this.files.set(path, {
        content: '',
        binary: data,
        stat: { size: data.byteLength, ctime: now, mtime: now },
      });
    }
  }

  async createFolder(path: string): Promise<void> {
    if (this.folders.has(path)) {
      throw new Error(`Folder already exists: ${path}`);
    }
    this.ensureParentFolder(path);
    this.folders.add(path);
  }

  async deleteFolder(path: string, recursive: boolean): Promise<void> {
    if (!this.folders.has(path)) {
      throw new FolderNotFoundError(path);
    }
    const children = this.getDirectChildren(path);
    if (!recursive && (children.files.length > 0 || children.folders.length > 0)) {
      throw new Error(`Folder "${path}" is not empty. Use recursive=true to delete.`);
    }
    if (recursive) {
      for (const [filePath] of this.files.entries()) {
        if (filePath.startsWith(path + '/')) {
          this.files.delete(filePath);
        }
      }
      for (const folderPath of this.folders) {
        if (folderPath.startsWith(path + '/')) {
          this.folders.delete(folderPath);
        }
      }
    }
    this.folders.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async stat(path: string): Promise<FileStat | null> {
    const file = this.files.get(path);
    if (file) return { ...file.stat };
    return null;
  }

  list(path: string): ListResult {
    const isRoot = path === '/' || path === '';
    if (!this.folders.has(path) && !isRoot) {
      throw new FolderNotFoundError(path);
    }
    return this.getDirectChildren(isRoot ? '' : path);
  }

  listRecursive(path: string): ListResult {
    const isRoot = path === '/' || path === '';
    if (!this.folders.has(path) && !isRoot) {
      throw new FolderNotFoundError(path);
    }
    const prefix = isRoot ? '' : path + '/';
    const files: string[] = [];
    const folders: string[] = [];
    for (const filePath of this.files.keys()) {
      if (isRoot || filePath.startsWith(prefix)) {
        files.push(filePath);
      }
    }
    for (const folderPath of this.folders) {
      if (folderPath === '/') continue; // root sentinel — never user-visible
      if (folderPath !== path && (isRoot || folderPath.startsWith(prefix))) {
        folders.push(folderPath);
      }
    }
    return { files: files.sort(), folders: folders.sort() };
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

  async getFileContent(path: string): Promise<string> {
    return this.readFile(path);
  }

  getFrontmatter(path: string): Record<string, unknown> | null {
    const file = this.files.get(path);
    if (!file) return null;
    return file.metadata?.frontmatter ?? null;
  }

  getTags(path: string): string[] {
    const file = this.files.get(path);
    if (!file) return [];
    return file.metadata?.tags ?? [];
  }

  getAllTags(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [filePath, file] of this.files.entries()) {
      const tags = file.metadata?.tags ?? [];
      for (const tag of tags) {
        if (!result[tag]) result[tag] = [];
        result[tag].push(filePath);
      }
    }
    return result;
  }

  getHeadings(path: string): Array<{ heading: string; level: number }> {
    const file = this.files.get(path);
    if (!file) return [];
    return file.metadata?.headings ?? [];
  }

  getLinks(path: string): Array<{ link: string; displayText?: string }> {
    const file = this.files.get(path);
    if (!file) return [];
    return file.metadata?.links ?? [];
  }

  getEmbeds(path: string): Array<{ link: string; displayText?: string }> {
    const file = this.files.get(path);
    if (!file) return [];
    return file.metadata?.embeds ?? [];
  }

  getBacklinks(path: string): string[] {
    const backlinks: string[] = [];
    for (const [filePath, file] of this.files.entries()) {
      const links = file.metadata?.links ?? [];
      if (links.some((l) => l.link === path || l.link + '.md' === path)) {
        backlinks.push(filePath);
      }
    }
    return backlinks;
  }

  getResolvedLinks(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [filePath, file] of this.files.entries()) {
      const links = file.metadata?.links ?? [];
      if (links.length > 0) {
        result[filePath] = {};
        for (const link of links) {
          const target = this.files.has(link.link) ? link.link : link.link + '.md';
          if (this.files.has(target)) {
            result[filePath][target] = (result[filePath][target] ?? 0) + 1;
          }
        }
      }
    }
    return result;
  }

  getUnresolvedLinks(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [filePath, file] of this.files.entries()) {
      const links = file.metadata?.links ?? [];
      for (const link of links) {
        const target = link.link;
        if (!this.files.has(target) && !this.files.has(target + '.md')) {
          if (!result[filePath]) result[filePath] = {};
          result[filePath][target] = (result[filePath][target] ?? 0) + 1;
        }
      }
    }
    return result;
  }

  getAllFiles(): string[] {
    return Array.from(this.files.keys()).filter((p) => p.endsWith('.md'));
  }

  // Editor operations (mock state)
  private activeFile: string | null = null;
  private editorContent: string | null = null;
  private cursor: { line: number; ch: number } = { line: 0, ch: 0 };
  private selection: { from: { line: number; ch: number }; to: { line: number; ch: number } } | null = null;

  // Workspace operations (mock state)
  private openLeaves: Array<{ path: string; leafId: string }> = [];
  private activeLeafId: string | null = null;

  // Plugin operations (mock state)
  private installedPlugins: Array<{ id: string; name: string; enabled: boolean }> = [];
  private executedCommands: string[] = [];

  getActiveFileContent(): string | null {
    return this.editorContent;
  }

  getActiveFilePath(): string | null {
    return this.activeFile;
  }

  getActiveLineCount(): number | null {
    if (this.editorContent === null) return null;
    return this.editorContent.split('\n').length;
  }

  insertTextAt(line: number, ch: number, text: string): boolean {
    if (this.editorContent === null) return false;
    const lines = this.editorContent.split('\n');
    if (line >= lines.length) return false;
    const lineStr = lines[line];
    lines[line] = lineStr.slice(0, ch) + text + lineStr.slice(ch);
    this.editorContent = lines.join('\n');
    return true;
  }

  replaceRange(fromLine: number, fromCh: number, toLine: number, toCh: number, text: string): boolean {
    if (this.editorContent === null) return false;
    const lines = this.editorContent.split('\n');
    const before = lines.slice(0, fromLine).join('\n') + (fromLine > 0 ? '\n' : '') + lines[fromLine].slice(0, fromCh);
    const after = lines[toLine].slice(toCh) + (toLine < lines.length - 1 ? '\n' : '') + lines.slice(toLine + 1).join('\n');
    this.editorContent = before + text + after;
    return true;
  }

  deleteRange(fromLine: number, fromCh: number, toLine: number, toCh: number): boolean {
    return this.replaceRange(fromLine, fromCh, toLine, toCh, '');
  }

  getCursorPosition(): { line: number; ch: number } | null {
    if (this.editorContent === null) return null;
    return { ...this.cursor };
  }

  setCursorPosition(line: number, ch: number): boolean {
    if (this.editorContent === null) return false;
    this.cursor = { line, ch };
    return true;
  }

  getSelection(): { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string } | null {
    if (this.editorContent === null || !this.selection) return null;
    const lines = this.editorContent.split('\n');
    const from = this.selection.from;
    const to = this.selection.to;
    let text = '';
    if (from.line === to.line) {
      text = lines[from.line].slice(from.ch, to.ch);
    } else {
      text = lines[from.line].slice(from.ch) + '\n';
      for (let i = from.line + 1; i < to.line; i++) {
        text += lines[i] + '\n';
      }
      text += lines[to.line].slice(0, to.ch);
    }
    return { from: { ...from }, to: { ...to }, text };
  }

  setSelection(fromLine: number, fromCh: number, toLine: number, toCh: number): boolean {
    if (this.editorContent === null) return false;
    this.selection = { from: { line: fromLine, ch: fromCh }, to: { line: toLine, ch: toCh } };
    return true;
  }

  getActiveLeafInfo(): Record<string, unknown> | null {
    if (!this.activeLeafId) return null;
    const leaf = this.openLeaves.find((l) => l.leafId === this.activeLeafId);
    if (!leaf) return null;
    return { id: leaf.leafId, type: 'markdown', filePath: leaf.path };
  }

  async openFile(path: string, _mode?: string): Promise<void> {
    if (!this.files.has(path)) throw new Error(`File not found: ${path}`);
    const leafId = `leaf-${String(this.openLeaves.length)}`;
    this.openLeaves.push({ path, leafId });
    this.activeLeafId = leafId;
    this.activeFile = path;
    this.editorContent = this.files.get(path)?.content ?? '';
  }

  getOpenFiles(): Array<{ path: string; leafId: string }> {
    return [...this.openLeaves];
  }

  setActiveLeaf(leafId: string): boolean {
    const leaf = this.openLeaves.find((l) => l.leafId === leafId);
    if (!leaf) return false;
    this.activeLeafId = leafId;
    this.activeFile = leaf.path;
    return true;
  }

  getWorkspaceLayout(): Record<string, unknown> {
    return {
      main: { type: 'split', children: this.openLeaves.map((l) => ({ type: 'leaf', id: l.leafId })) },
    };
  }

  showNotice(_message: string, _duration?: number): void {
    // no-op in mock
  }

  getInstalledPlugins(): Array<{ id: string; name: string; enabled: boolean }> {
    return [...this.installedPlugins];
  }

  isPluginEnabled(pluginId: string): boolean {
    return this.installedPlugins.some((p) => p.id === pluginId && p.enabled);
  }

  executeCommand(commandId: string): boolean {
    this.executedCommands.push(commandId);
    return true;
  }

  private dataviewApi: DataviewApi | null = null;

  getDataviewApi(): DataviewApi | null {
    return this.dataviewApi;
  }

  setDataviewApi(api: DataviewApi | null): void {
    this.dataviewApi = api;
  }

  private dailyNotesSettings: {
    format: string;
    folder: string;
    template: string;
  } | null = null;

  getDailyNotesSettings(): {
    format: string;
    folder: string;
    template: string;
  } | null {
    return this.dailyNotesSettings;
  }

  setDailyNotesSettings(
    value: { format: string; folder: string; template: string } | null,
  ): void {
    this.dailyNotesSettings = value;
  }

  // Test helpers
  setActiveEditor(path: string, content: string): void {
    this.activeFile = path;
    this.editorContent = content;
  }

  addOpenLeaf(path: string, leafId: string): void {
    this.openLeaves.push({ path, leafId });
  }

  setActiveLeafId(leafId: string): void {
    this.activeLeafId = leafId;
  }

  addInstalledPlugin(id: string, name: string, enabled: boolean): void {
    this.installedPlugins.push({ id, name, enabled });
  }

  getExecutedCommands(): string[] {
    return [...this.executedCommands];
  }

  setMetadata(path: string, metadata: MockFileMetadata): void {
    const file = this.files.get(path);
    if (file) {
      file.metadata = metadata;
    }
  }

  setVaultPath(path: string): void {
    this.vaultPath = path;
  }

  addFile(path: string, content: string, stat?: Partial<FileStat>): void {
    this.ensureParentFolder(path);
    const now = Date.now();
    this.files.set(path, {
      content,
      stat: {
        size: stat?.size ?? content.length,
        ctime: stat?.ctime ?? now,
        mtime: stat?.mtime ?? now,
      },
    });
  }

  addFolder(path: string): void {
    this.folders.add(path);
  }

  private getDirectChildren(path: string): ListResult {
    const isRoot = path === '/' || path === '';
    const prefix = isRoot ? '' : path + '/';
    const files: string[] = [];
    const folders: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix) && !filePath.slice(prefix.length).includes('/')) {
        files.push(filePath);
      }
    }
    for (const folderPath of this.folders) {
      if (folderPath === '/') continue; // root sentinel — never user-visible
      if (
        folderPath !== path &&
        folderPath.startsWith(prefix) &&
        !folderPath.slice(prefix.length).includes('/')
      ) {
        folders.push(folderPath);
      }
    }
    return { files: files.sort(), folders: folders.sort() };
  }

  private ensureParentFolder(path: string): void {
    const parts = path.split('/');
    parts.pop(); // Remove the file/folder name
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (current && !this.folders.has(current)) {
        this.folders.add(current);
      }
    }
  }
}
