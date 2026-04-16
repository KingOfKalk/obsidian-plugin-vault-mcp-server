import { FileStat, ListResult, ObsidianAdapter } from './adapter';

interface MockFile {
  content: string;
  binary?: ArrayBuffer;
  stat: FileStat;
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
      throw new Error(`Folder not found: ${path}`);
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
    if (!this.folders.has(path) && path !== '/') {
      throw new Error(`Folder not found: ${path}`);
    }
    return this.getDirectChildren(path);
  }

  listRecursive(path: string): ListResult {
    if (!this.folders.has(path) && path !== '/') {
      throw new Error(`Folder not found: ${path}`);
    }
    const prefix = path === '/' ? '' : path + '/';
    const files: string[] = [];
    const folders: string[] = [];
    for (const filePath of this.files.keys()) {
      if (path === '/' || filePath.startsWith(prefix)) {
        files.push(filePath);
      }
    }
    for (const folderPath of this.folders) {
      if (folderPath !== path && (path === '/' || folderPath.startsWith(prefix))) {
        folders.push(folderPath);
      }
    }
    return { files: files.sort(), folders: folders.sort() };
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

  // Test helpers
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
    const prefix = path === '/' ? '' : path + '/';
    const files: string[] = [];
    const folders: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix) && !filePath.slice(prefix.length).includes('/')) {
        files.push(filePath);
      }
    }
    for (const folderPath of this.folders) {
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
