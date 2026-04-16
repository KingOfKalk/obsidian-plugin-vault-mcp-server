/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/explicit-function-return-type */

export class Plugin {
  app: any;
  manifest: any;
  async loadData(): Promise<any> {
    return null;
  }
  async saveData(_data: any): Promise<void> {
    // no-op
  }
  addSettingTab(_tab: any): void {
    // no-op
  }
  addRibbonIcon(_icon: string, _title: string, _callback: () => void): any {
    return { remove: () => {} };
  }
  addCommand(_command: any): any {
    return {};
  }
  addStatusBarItem(): any {
    return { setText: () => {} };
  }
}

export class PluginSettingTab {
  app: any;
  containerEl: any = {
    empty: () => {},
    createEl: () => ({ setText: () => {} }),
  };
  constructor(_app: any, _plugin: any) {
    this.app = _app;
  }
  display(): void {
    // no-op
  }
  hide(): void {
    // no-op
  }
}

export class Setting {
  constructor(_containerEl: any) {}
  setName(_name: string): this {
    return this;
  }
  setDesc(_desc: string): this {
    return this;
  }
  addText(_cb: (text: any) => void): this {
    return this;
  }
  addToggle(_cb: (toggle: any) => void): this {
    return this;
  }
  addButton(_cb: (btn: any) => void): this {
    return this;
  }
}

export class TFile {
  path = '';
  name = '';
  basename = '';
  extension = '';
  parent: any = null;
  stat = { ctime: 0, mtime: 0, size: 0 };
  vault: any = null;
}

export class TFolder {
  path = '';
  name = '';
  parent: any = null;
  children: any[] = [];
  isRoot(): boolean {
    return this.path === '/';
  }
}

export class TAbstractFile {
  path = '';
  name = '';
  parent: any = null;
  vault: any = null;
}

export class Vault {
  static recurseChildren(_root: any, _cb: (file: any) => void): void {
    // no-op
  }
}

export class App {
  vault: any = new Vault();
  workspace: any = {};
  metadataCache: any = {};
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export class Modal {
  app: any;
  contentEl: any = {
    createEl: () => ({}),
    empty: () => {},
  };
  constructor(_app: any) {
    this.app = _app;
  }
  open(): void {}
  close(): void {}
}
