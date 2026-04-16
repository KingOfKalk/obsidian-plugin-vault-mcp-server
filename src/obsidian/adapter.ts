import { App, TFile, TFolder, TAbstractFile, Vault } from 'obsidian';

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
      throw new Error(`Folder not found: ${path}`);
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
