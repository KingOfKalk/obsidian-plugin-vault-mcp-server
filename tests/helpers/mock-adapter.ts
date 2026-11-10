/**
 * In-memory `ObsidianAdapter` for tests, scripts and evals. Lives under
 * tests/helpers/ so it is never part of the shipped plugin (#534).
 */
import {
  DailyNotesSettings,
  DataviewApi,
  FileStat,
  OpenFileMode,
  ListResult,
  ObsidianAdapter,
  TrashDestination,
} from '../../src/obsidian/adapter';
import { buildTagIndex, type TagUsage } from '../../src/obsidian/tag-index';
import {
  FileNotFoundError,
  FolderNotFoundError,
  NotFoundError,
  markdownCandidate,
} from '../../src/tools/shared/errors';
import { createLinkResolver, resolveLinkpath } from './link-resolver';
// Dev-only dependency: `yaml` is only used by this test helper.
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const FRONTMATTER_TAG_KEY = /^tags?$/i;

function frontmatterTagValues(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,\s]+/);
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(frontmatterTagValues);
  return [];
}

/**
 * Tags declared in a note's frontmatter, in Obsidian's `#tag` format, one
 * entry per occurrence. Mirrors Obsidian's `parseFrontMatterTags`: reads
 * the `tags` and `tag` keys (any case), as a list or as a comma/space
 * separated string, with or without a leading `#` (#440).
 */
export function parseFrontmatterTags(
  frontmatter: Record<string, unknown> | null | undefined,
): string[] {
  if (!frontmatter) return [];
  const tags: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!FRONTMATTER_TAG_KEY.test(key)) continue;
    for (const raw of frontmatterTagValues(value)) {
      const name = raw.trim().replace(/^#+/, '');
      if (name !== '') tags.push(`#${name}`);
    }
  }
  return tags;
}

interface MockFileMetadata {
  frontmatter?: Record<string, unknown>;
  tags?: string[];
  headings?: Array<{ heading: string; level: number }>;
  links?: Array<{ link: string; displayText?: string }>;
  embeds?: Array<{ link: string; displayText?: string }>;
}

/**
 * Split a note into its leading `---` YAML frontmatter block and the body.
 * Returns `yaml: null` when the note has no frontmatter block.
 */
function splitFrontmatter(content: string): { yaml: string | null; body: string } {
  const lines = content.split('\n');
  if (lines[0]?.trimEnd() !== '---') return { yaml: null, body: content };
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (end === -1) return { yaml: null, body: content };
  return {
    yaml: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
  };
}

function parseFrontmatterBlock(yaml: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(yaml);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Frontmatter is not a YAML mapping');
  }
  return parsed as Record<string, unknown>;
}

type LinkMap = Record<string, Record<string, number>>;

/** A link's path without its `#subpath`, trimmed. */
function linkpathOf(link: string): string {
  const hash = link.indexOf('#');
  return (hash === -1 ? link : link.slice(0, hash)).trim();
}

function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
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
  private configDir = '.obsidian';
  /** Paths moved to the trash, in order (mirrors `fileManager.trashFile`). */
  private trashed: string[] = [];
  /** Mock "Automatically update internal links"; on by default. */
  private autoUpdateLinks: boolean | null = true;
  /** Mock "Deleted files" setting. */
  private trashDestination: TrashDestination = 'system';

  async readFile(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw this.fileNotFound(path);
    return file.content;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);
    if (!file) throw this.fileNotFound(path);
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
    if (!file) throw this.fileNotFound(path);
    file.content = content;
    file.stat.mtime = Date.now();
    file.stat.size = content.length;
  }

  async processFile(path: string, fn: (content: string) => string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw this.fileNotFound(path);
    // Like app.vault.process: if fn throws, nothing is written.
    const next = fn(file.content);
    file.content = next;
    file.stat.mtime = Date.now();
    file.stat.size = next.length;
    return next;
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.files.has(path)) {
      throw this.fileNotFound(path);
    }
    this.files.delete(path);
    this.trashed.push(path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const file = this.files.get(oldPath);
    const isFolder = this.folders.has(oldPath);

    if (!file && !isFolder) {
      const suggestion = this.suggestMarkdownFile(oldPath);
      throw new NotFoundError(
        suggestion === undefined
          ? `Path not found: ${oldPath}`
          : `Path not found: ${oldPath}. Did you mean ${suggestion}?`,
      );
    }
    // Obsidian's vault.rename refuses any existing destination (#447).
    if (this.files.has(newPath) || this.folders.has(newPath)) {
      throw new Error('Destination file already exists!');
    }

    if (file) {
      this.ensureParentFolder(newPath);
      this.files.set(newPath, { ...file, stat: { ...file.stat, mtime: Date.now() } });
      this.files.delete(oldPath);
      this.rewriteLinks(oldPath, newPath);
    }

    if (isFolder) {
      this.ensureParentFolder(newPath);
      this.folders.add(newPath);
      this.folders.delete(oldPath);
      // Move all children
      const moved: Array<[string, string]> = [];
      for (const [filePath, fileData] of [...this.files.entries()]) {
        if (filePath.startsWith(oldPath + '/')) {
          const newFilePath = newPath + filePath.slice(oldPath.length);
          this.files.delete(filePath);
          this.files.set(newFilePath, fileData);
          moved.push([filePath, newFilePath]);
        }
      }
      for (const [from, to] of moved) {
        this.rewriteLinks(from, to);
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
    if (!file) throw this.fileNotFound(sourcePath);
    // Obsidian's vault.copy fails with the filesystem's EEXIST (#447).
    if (this.files.has(destPath) || this.folders.has(destPath)) {
      throw new Error(
        `EEXIST: file already exists, copyfile '${sourcePath}' -> '${destPath}'`,
      );
    }
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
    this.trashed.push(path);
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
    const isRoot = path === '/' || path === '' || path === '.';
    if (!this.folders.has(path) && !isRoot) {
      throw new FolderNotFoundError(path);
    }
    return this.getDirectChildren(isRoot ? '' : path);
  }

  listRecursive(path: string): ListResult {
    const isRoot = path === '/' || path === '' || path === '.';
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

  getConfigDir(): string {
    return this.configDir;
  }

  async getFileContent(path: string): Promise<string> {
    return this.readFile(path);
  }

  getFrontmatter(path: string): Record<string, unknown> | null {
    const file = this.requireFile(path);
    return file.metadata?.frontmatter ?? null;
  }

  /**
   * Mock of Obsidian's `fileManager.processFrontMatter()`: parses the YAML
   * block in the file content (falling back to metadata set through
   * `setMetadata` when the content has none), lets `fn` mutate it, writes
   * the YAML back and keeps `metadata.frontmatter` in sync. An emptied
   * frontmatter removes the block.
   */
  async processFrontMatter(
    path: string,
    fn: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    const file = this.files.get(path);
    if (!file) throw this.fileNotFound(path);
    const { yaml, body } = splitFrontmatter(file.content);
    const frontmatter =
      yaml !== null
        ? parseFrontmatterBlock(yaml)
        : structuredClone(file.metadata?.frontmatter ?? {});
    fn(frontmatter);
    const hasKeys = Object.keys(frontmatter).length > 0;
    const content = hasKeys ? `---\n${stringifyYaml(frontmatter)}---\n${body}` : body;
    file.content = content;
    file.stat.mtime = Date.now();
    file.stat.size = content.length;
    file.metadata = {
      ...file.metadata,
      frontmatter: hasKeys ? structuredClone(frontmatter) : undefined,
    };
  }

  /**
   * Frontmatter tags (`tags` / `tag`) followed by inline tags, one entry
   * per occurrence, like Obsidian's `getAllTags(cache)` (#440).
   */
  getTags(path: string): string[] {
    const file = this.requireFile(path);
    return [
      ...parseFrontmatterTags(file.metadata?.frontmatter),
      ...(file.metadata?.tags ?? []),
    ];
  }

  getAllTags(): Record<string, TagUsage> {
    return buildTagIndex(
      Array.from(this.files.keys(), (path) => ({ path, tags: this.getTags(path) })),
    );
  }

  getHeadings(path: string): Array<{ heading: string; level: number }> {
    const file = this.requireFile(path);
    return file.metadata?.headings ?? [];
  }

  getLinks(path: string): Array<{ link: string; displayText?: string }> {
    const file = this.requireFile(path);
    return file.metadata?.links ?? [];
  }

  getEmbeds(path: string): Array<{ link: string; displayText?: string }> {
    const file = this.requireFile(path);
    return file.metadata?.embeds ?? [];
  }

  /** Obsidian's resolution rule, emulated (#485). */
  resolveLinkpath(linkpath: string, sourcePath: string): string | null {
    return resolveLinkpath(linkpath, sourcePath, Array.from(this.files.keys()));
  }

  /**
   * Resolve a link like `Atlas#Risks` from `source` to a vault path, the
   * way Obsidian does: the `#subpath` is dropped, the rest goes through
   * `resolveLinkpath`.
   */
  resolveLink(link: string, source: string): string | null {
    return this.resolveLinkpath(linkpathOf(link), source);
  }

  /** Same rule as the real adapter: every source whose resolved map has `path`. */
  getBacklinks(path: string): string[] {
    // Like the real adapter (#447): a missing path is "File not found",
    // not "no backlinks" (#463).
    this.requireFile(path);
    const { resolved } = this.buildLinkMaps();
    return Object.keys(resolved).filter((source) => path in resolved[source]);
  }

  /**
   * Mock stand-in for the metadata cache's link positions: scan each
   * backlink's content for `[[...]]` / `![[...]]` whose link path resolves
   * to `path`.
   */
  getBacklinkLines(path: string): Array<{ path: string; lines: number[] }> {
    const wikilink = /!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    const resolve = createLinkResolver(Array.from(this.files.keys()));
    return this.getBacklinks(path).map((sourcePath) => {
      const content = this.files.get(sourcePath)?.content ?? '';
      const lines: number[] = [];
      content.split('\n').forEach((text, index) => {
        for (const match of text.matchAll(wikilink)) {
          if (resolve(match[1].trim(), sourcePath) === path) {
            lines.push(index);
            break;
          }
        }
      });
      return { path: sourcePath, lines };
    });
  }

  getResolvedLinks(): Record<string, Record<string, number>> {
    return this.buildLinkMaps().resolved;
  }

  getUnresolvedLinks(): Record<string, Record<string, number>> {
    return this.buildLinkMaps().unresolved;
  }

  /**
   * Both link maps, like Obsidian's `metadataCache.resolvedLinks` and
   * `unresolvedLinks`: one entry per file with metadata, counting its
   * links and embeds. Links resolve by Obsidian's rule (#485); an
   * unresolved link is keyed by its text without the `#subpath`.
   * Built on every call, so they follow every change to the vault; the
   * resolution cache only lives for one build, which keeps large vaults
   * (the eval's bulk notes, #466) fast.
   */
  private buildLinkMaps(): { resolved: LinkMap; unresolved: LinkMap } {
    const resolveIn = createLinkResolver(Array.from(this.files.keys()));
    const cache = new Map<string, string | null>();
    const resolve = (linkpath: string, source: string): string | null => {
      // The result depends only on the lower-cased link path and the source
      // folder (the source itself for an empty link path).
      const key = `${linkpath === '' ? source : dirName(source)}\0${linkpath.toLowerCase()}`;
      let target = cache.get(key);
      if (target === undefined) {
        target = resolveIn(linkpath, source);
        cache.set(key, target);
      }
      return target;
    };
    const resolved: LinkMap = {};
    const unresolved: LinkMap = {};
    for (const [source, file] of this.files.entries()) {
      if (!file.metadata) continue;
      const found: Record<string, number> = {};
      const missing: Record<string, number> = {};
      for (const ref of [...(file.metadata.links ?? []), ...(file.metadata.embeds ?? [])]) {
        const target = resolve(linkpathOf(ref.link), source);
        if (target !== null) {
          found[target] = (found[target] ?? 0) + 1;
        } else {
          const hash = ref.link.indexOf('#');
          const key = hash === -1 ? ref.link : ref.link.slice(0, hash);
          missing[key] = (missing[key] ?? 0) + 1;
        }
      }
      resolved[source] = found;
      unresolved[source] = missing;
    }
    return { resolved, unresolved };
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
    return this.replaceRange(line, ch, line, ch, text);
  }

  /**
   * Like Obsidian's `editor.replaceRange` (#447): a line past the last one
   * means the end of the document, and `ch` is added to the start of the
   * line, so a `ch` past the line end runs into the next line. A range
   * past the end of the document throws CodeMirror's error.
   */
  replaceRange(fromLine: number, fromCh: number, toLine: number, toCh: number, text: string): boolean {
    if (this.editorContent === null) return false;
    const content = this.editorContent;
    const from = this.posToOffset(content, fromLine, fromCh);
    const to = this.posToOffset(content, toLine, toCh);
    if (from > content.length || to > content.length || from > to) {
      throw new RangeError(
        `Invalid change range ${String(from)} to ${String(to)} (in doc of length ${String(content.length)})`,
      );
    }
    this.editorContent = content.slice(0, from) + text + content.slice(to);
    return true;
  }

  private posToOffset(content: string, line: number, ch: number): number {
    const lines = content.split('\n');
    if (line >= lines.length) return content.length;
    let offset = 0;
    for (let i = 0; i < line; i++) offset += lines[i].length + 1;
    return offset + ch;
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

  async openFile(path: string, _mode?: OpenFileMode): Promise<void> {
    if (!this.files.has(path)) throw this.fileNotFound(path);
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

  private dailyNotesSettings: DailyNotesSettings | null = null;

  getDailyNotesSettings(): DailyNotesSettings | null {
    return this.dailyNotesSettings;
  }

  getAutoUpdateLinks(): boolean | null {
    return this.autoUpdateLinks;
  }

  /**
   * Test helper: `false` (or `null`) makes renames leave links alone, like
   * the real adapter's `vault.rename` path (#445).
   */
  setAutoUpdateLinks(value: boolean | null): void {
    this.autoUpdateLinks = value;
  }

  getTrashDestination(): TrashDestination {
    return this.trashDestination;
  }

  setTrashDestination(value: TrashDestination): void {
    this.trashDestination = value;
  }

  setDailyNotesSettings(value: DailyNotesSettings | null): void {
    this.dailyNotesSettings = value;
  }

  private templatesFolder: string | null = null;

  getTemplatesFolder(): string | null {
    return this.templatesFolder;
  }

  /** Test helper: the core Templates plugin's folder option (#470). */
  setTemplatesFolder(value: string | null): void {
    this.templatesFolder = value;
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

  /** Enable or disable an installed plugin, as the Community plugins tab does. */
  setPluginEnabled(id: string, enabled: boolean): void {
    const plugin = this.installedPlugins.find((p) => p.id === id);
    if (plugin) plugin.enabled = enabled;
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

  setConfigDir(dir: string): void {
    this.configDir = dir;
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

  /** Add a binary file (e.g. an image) synchronously, for seeding a vault. */
  addBinaryFile(path: string, data: Uint8Array, stat?: Partial<FileStat>): void {
    this.ensureParentFolder(path);
    const now = Date.now();
    const binary = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.files.set(path, {
      content: '',
      binary: binary as ArrayBuffer,
      stat: { size: data.byteLength, ctime: stat?.ctime ?? now, mtime: stat?.mtime ?? now },
    });
  }

  /** Paths deleted via `deleteFile` / `deleteFolder`, i.e. sent to the trash. */
  getTrashedPaths(): string[] {
    return [...this.trashed];
  }

  addFolder(path: string): void {
    this.folders.add(path);
  }

  private getDirectChildren(path: string): ListResult {
    const isRoot = path === '/' || path === '' || path === '.';
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

  /**
   * Minimal stand-in for Obsidian's "Automatically update internal
   * links": rewrite `[[old]]`, `[[old|alias]]` and `[[old#heading]]`
   * wikilinks (with or without the `.md` extension) in every other file
   * to the new path. The real link format depends on user settings.
   * Does nothing when `autoUpdateLinks` is not `true`. Metadata links
   * set with `setMetadata` are rewritten too, so `getResolvedLinks`
   * stays in step with the content.
   */
  private rewriteLinks(oldPath: string, newPath: string): void {
    if (this.autoUpdateLinks !== true) return;
    const strip = (p: string): string => p.replace(/\.md$/, '');
    const escaped = strip(oldPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\[\\[${escaped}(\\.md)?(?=[\\]|#])`, 'g');
    const replacement = `[[${strip(newPath)}`;
    for (const file of this.files.values()) {
      if (file.binary) continue;
      file.content = file.content.replace(pattern, replacement);
      for (const link of file.metadata?.links ?? []) {
        if (link.link === oldPath) link.link = newPath;
        else if (link.link === strip(oldPath)) link.link = strip(newPath);
      }
    }
  }

  /** The real adapter's "File not found" error, with its "Did you mean" hint. */
  private fileNotFound(path: string): FileNotFoundError {
    return new FileNotFoundError(path, this.suggestMarkdownFile(path));
  }

  /** `path + ".md"` when that file exists (#463). */
  private suggestMarkdownFile(path: string): string | undefined {
    const candidate = markdownCandidate(path);
    return candidate !== null && this.files.has(candidate) ? candidate : undefined;
  }

  /** The file at `path`, or the real adapter's "File not found" error. */
  protected requireFile(path: string): MockFile {
    const file = this.files.get(path);
    if (!file) throw this.fileNotFound(path);
    return file;
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
