/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-call */

export class Plugin {
  app: any;
  manifest: any = { id: 'obsidian-mcp', version: '0.0.0' };
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
    return mockEl();
  }
}

function mockEl(): any {
  const el: any = {
    setText: (text: string) => {
      el.textContent = text;
    },
    style: {},
    textContent: '',
    className: '',
    tagName: '',
    title: '',
    ariaLabel: '',
    attributes: {} as Record<string, string>,
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    children: [] as any[],
    empty: () => {
      el.children.length = 0;
      el.textContent = '';
    },
    remove: () => {},
    createEl: (tag?: string, opts?: { text?: string; cls?: string; attr?: Record<string, string> }) => {
      const child = mockEl();
      if (tag) child.tagName = tag;
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
      if (opts?.attr) Object.assign(child.attributes, opts.attr);
      el.children.push(child);
      child.remove = () => {
        const idx = el.children.indexOf(child);
        if (idx >= 0) el.children.splice(idx, 1);
      };
      return child;
    },
    createDiv: (opts?: { cls?: string }) => {
      const child = mockEl();
      child.tagName = 'div';
      if (opts?.cls) child.className = opts.cls;
      el.children.push(child);
      child.remove = () => {
        const idx = el.children.indexOf(child);
        if (idx >= 0) el.children.splice(idx, 1);
      };
      return child;
    },
  };
  return el;
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
  descEl: any;
  buttons: Array<{ text: string; disabled: boolean; callback: (() => void) | null }> = [];
  extraButtons: Array<{ icon: string; tooltip: string; callback: (() => void) | null }> = [];
  toggles: Array<{ value: boolean; tooltip: string; callback: ((value: boolean) => void) | null }> = [];
  texts: Array<{
    placeholder: string;
    value: string;
    callback: ((value: string) => void | Promise<void>) | null;
  }> = [];
  settingEl: { classList: { add: (cls: string) => void } };

  constructor(containerEl: any) {
    Setting.instances.push(this);
    this.container = containerEl;
    this.descEl = mockEl();
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
  addText(cb: (text: any) => void): this {
    const record = {
      placeholder: '',
      value: '',
      callback: null as ((value: string) => void | Promise<void>) | null,
    };
    const text = {
      setPlaceholder(p: string) { record.placeholder = p; return text; },
      setValue(v: string) { record.value = v; return text; },
      onChange(fn: (value: string) => void | Promise<void>) { record.callback = fn; return text; },
    };
    cb(text);
    this.texts.push(record);
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
