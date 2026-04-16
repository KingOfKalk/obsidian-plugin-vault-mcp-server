/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/explicit-function-return-type */

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

function mockEl(): any {
  return {
    setText: () => {},
    style: {},
    textContent: '',
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    createEl: () => mockEl(),
    createDiv: (_opts?: any) => mockEl(),
  };
}

export class PluginSettingTab {
  app: any;
  containerEl: any = {
    empty: () => {},
    createEl: () => mockEl(),
    createDiv: (_opts?: any) => mockEl(),
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
  static instances: Setting[] = [];
  settingName = '';
  settingDesc = '';
  settingClass = '';
  container: any;
  buttons: Array<{ text: string; disabled: boolean; callback: (() => void) | null }> = [];
  extraButtons: Array<{ icon: string; tooltip: string; callback: (() => void) | null }> = [];
  toggles: Array<{ value: boolean; tooltip: string; callback: ((value: boolean) => void) | null }> = [];
  settingEl: { classList: { add: (cls: string) => void } };

  constructor(containerEl: any) {
    Setting.instances.push(this);
    this.container = containerEl;
    this.settingEl = {
      classList: {
        add: (cls: string): void => {
          this.settingClass = this.settingClass ? `${this.settingClass} ${cls}` : cls;
        },
      },
    };
  }
  setName(name: string): this {
    this.settingName = name;
    return this;
  }
  setDesc(desc: any): this {
    if (typeof desc === 'string') this.settingDesc = desc;
    return this;
  }
  setClass(cls: string): this {
    this.settingClass = this.settingClass ? `${this.settingClass} ${cls}` : cls;
    return this;
  }
  addText(_cb: (text: any) => void): this {
    return this;
  }
  addToggle(cb: (toggle: any) => void): this {
    const record = { value: false, tooltip: '', callback: null as ((value: boolean) => void) | null };
    const toggle = {
      setValue(v: boolean) { record.value = v; return toggle; },
      setTooltip(t: string) { record.tooltip = t; return toggle; },
      onChange(fn: (value: boolean) => void) { record.callback = fn; return toggle; },
    };
    cb(toggle);
    this.toggles.push(record);
    return this;
  }
  addButton(cb: (btn: any) => void): this {
    const record = { text: '', disabled: false, callback: null as (() => void) | null };
    const btn = {
      buttonEl: { disabled: false },
      setButtonText(t: string) { record.text = t; return btn; },
      setCta() { return btn; },
      onClick(fn: () => void) { record.callback = fn; return btn; },
    };
    cb(btn);
    record.disabled = btn.buttonEl.disabled;
    this.buttons.push(record);
    return this;
  }
  addExtraButton(cb: (btn: any) => void): this {
    const record = { icon: '', tooltip: '', callback: null as (() => void) | null };
    const btn = {
      setIcon(icon: string) { record.icon = icon; return btn; },
      setTooltip(t: string) { record.tooltip = t; return btn; },
      onClick(fn: () => void) { record.callback = fn; return btn; },
    };
    cb(btn);
    this.extraButtons.push(record);
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

export function setIcon(el: any, icon: string): void {
  if (el) el._icon = icon;
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
