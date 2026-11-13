/**
 * Typed stubs for the subset of the Obsidian API that this plugin's tests
 * exercise. Kept deliberately structural: the goal is "matches what the
 * production code pulls off these objects", not "is literally the Obsidian
 * runtime type". That's why we don't `implements Obsidian.Plugin`; the real
 * surface is enormous and we only mock what we use.
 */

export interface MockElement {
  setText: (text: string) => void;
  style: Record<string, unknown>;
  textContent: string;
  className: string;
  tagName: string;
  title: string;
  ariaLabel: string;
  attributes: Record<string, string>;
  classList: { add: (cls: string) => void; remove: (cls: string) => void };
  addEventListener: (event: string, handler: unknown) => void;
  children: MockElement[];
  empty: () => void;
  remove: () => void;
  _icon?: string;
  createEl: (
    tag?: string,
    opts?: { text?: string; cls?: string; attr?: Record<string, string> },
  ) => MockElement;
  createDiv: (opts?: { text?: string; cls?: string; attr?: Record<string, string> }) => MockElement;
  createSpan: (opts?: { text?: string; cls?: string; attr?: Record<string, string> }) => MockElement;
}

function mockEl(): MockElement {
  const el: MockElement = {
    setText: (text: string): void => {
      el.textContent = text;
    },
    style: {},
    textContent: '',
    className: '',
    tagName: '',
    title: '',
    ariaLabel: '',
    attributes: {},
    classList: {
      add: (): void => {},
      remove: (): void => {},
    },
    addEventListener: (): void => {},
    children: [],
    empty: (): void => {
      el.children.length = 0;
      el.textContent = '';
    },
    remove: (): void => {},
    createEl: (tag, opts): MockElement => {
      const child = mockEl();
      if (tag) child.tagName = tag;
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
      if (opts?.attr) Object.assign(child.attributes, opts.attr);
      el.children.push(child);
      child.remove = (): void => {
        const idx = el.children.indexOf(child);
        if (idx >= 0) el.children.splice(idx, 1);
      };
      return child;
    },
    createDiv: (opts): MockElement => el.createEl('div', opts),
    createSpan: (opts): MockElement => el.createEl('span', opts),
  };
  return el;
}

/** Exported so section tests can use a child-tracking container element. */
export function mockElement(): MockElement {
  return mockEl();
}

/**
 * Obsidian's `apiVersion` export. Follows the desktop app's release
 * cycle, so the plugin reports it as the Obsidian version.
 */
export const apiVersion = '1.8.9';

let mockLanguage = 'en';

/** Obsidian's `getLanguage()` (since 1.8.7): the app language, default `en`. */
export function getLanguage(): string {
  return mockLanguage;
}

/** Test helper: the value `getLanguage()` returns. */
export function setMockLanguage(language: string): void {
  mockLanguage = language;
}

export interface MockManifest {
  id: string;
  version: string;
}

export interface MockRibbonIcon {
  remove: () => void;
}

export type MockStatusBarItem = MockElement;

export interface MockCommand {
  id?: string;
  name?: string;
  callback?: () => void;
}

export class Plugin {
  app: unknown;
  manifest: MockManifest = { id: 'vault-mcp-server', version: '0.0.0' };

  loadData(): Promise<unknown> {
    return Promise.resolve(null);
  }

  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }

  addSettingTab(_tab: unknown): void {
    // no-op
  }

  addRibbonIcon(
    _icon: string,
    _title: string,
    _callback: () => void,
  ): MockRibbonIcon {
    return { remove: (): void => {} };
  }

  addCommand(_command: MockCommand): Record<string, never> {
    return {};
  }

  addStatusBarItem(): MockStatusBarItem {
    return mockEl();
  }
}

export interface MockContainerEl {
  empty: () => void;
  createEl: () => MockElement;
  createDiv: (opts?: { cls?: string }) => MockElement;
}

export class PluginSettingTab {
  app: unknown;
  containerEl: MockContainerEl = {
    empty: (): void => {},
    createEl: (): MockElement => mockEl(),
    createDiv: (): MockElement => mockEl(),
  };

  constructor(app: unknown, _plugin: unknown) {
    this.app = app;
  }

  display(): void {
    // no-op
  }

  hide(): void {
    // no-op
  }
}

interface SettingTextRecord {
  placeholder: string;
  value: string;
  callback: ((value: string) => void | Promise<void>) | null;
}

interface SettingToggleRecord {
  value: boolean;
  tooltip: string;
  callback: ((value: boolean) => void) | null;
}

interface SettingButtonRecord {
  text: string;
  disabled: boolean;
  callback: (() => void) | null;
}

interface SettingExtraButtonRecord {
  icon: string;
  tooltip: string;
  callback: (() => void) | null;
}

interface SettingTextHandle {
  setPlaceholder: (p: string) => SettingTextHandle;
  setValue: (v: string) => SettingTextHandle;
  onChange: (fn: (value: string) => void | Promise<void>) => SettingTextHandle;
}

interface SettingToggleHandle {
  setValue: (v: boolean) => SettingToggleHandle;
  setTooltip: (t: string) => SettingToggleHandle;
  onChange: (fn: (value: boolean) => void) => SettingToggleHandle;
}

interface SettingButtonHandle {
  buttonEl: { disabled: boolean };
  setButtonText: (t: string) => SettingButtonHandle;
  setCta: () => SettingButtonHandle;
  onClick: (fn: () => void) => SettingButtonHandle;
}

interface SettingExtraButtonHandle {
  setIcon: (icon: string) => SettingExtraButtonHandle;
  setTooltip: (t: string) => SettingExtraButtonHandle;
  onClick: (fn: () => void) => SettingExtraButtonHandle;
}

export class Setting {
  static instances: Setting[] = [];
  settingName = '';
  settingDesc = '';
  settingClass = '';
  isHeading = false;
  container: unknown;
  descEl: MockElement;
  buttons: SettingButtonRecord[] = [];
  extraButtons: SettingExtraButtonRecord[] = [];
  toggles: SettingToggleRecord[] = [];
  texts: SettingTextRecord[] = [];
  settingEl: { classList: { add: (cls: string) => void } };

  constructor(containerEl: unknown) {
    Setting.instances.push(this);
    this.container = containerEl;
    this.descEl = mockEl();
    this.settingEl = {
      classList: {
        add: (cls: string): void => {
          this.settingClass = this.settingClass
            ? `${this.settingClass} ${cls}`
            : cls;
        },
      },
    };
  }

  setName(name: string): this {
    this.settingName = name;
    return this;
  }

  setDesc(desc: unknown): this {
    if (typeof desc === 'string') this.settingDesc = desc;
    return this;
  }

  setClass(cls: string): this {
    this.settingClass = this.settingClass ? `${this.settingClass} ${cls}` : cls;
    return this;
  }

  /** Mirrors `Setting.setHeading()`: the row becomes a section heading. */
  setHeading(): this {
    this.isHeading = true;
    return this;
  }

  addText(cb: (text: SettingTextHandle) => void): this {
    const record: SettingTextRecord = {
      placeholder: '',
      value: '',
      callback: null,
    };
    const text: SettingTextHandle = {
      setPlaceholder(p: string): SettingTextHandle {
        record.placeholder = p;
        return text;
      },
      setValue(v: string): SettingTextHandle {
        record.value = v;
        return text;
      },
      onChange(fn): SettingTextHandle {
        record.callback = fn;
        return text;
      },
    };
    cb(text);
    this.texts.push(record);
    return this;
  }

  addToggle(cb: (toggle: SettingToggleHandle) => void): this {
    const record: SettingToggleRecord = {
      value: false,
      tooltip: '',
      callback: null,
    };
    const toggle: SettingToggleHandle = {
      setValue(v: boolean): SettingToggleHandle {
        record.value = v;
        return toggle;
      },
      setTooltip(t: string): SettingToggleHandle {
        record.tooltip = t;
        return toggle;
      },
      onChange(fn): SettingToggleHandle {
        record.callback = fn;
        return toggle;
      },
    };
    cb(toggle);
    this.toggles.push(record);
    return this;
  }

  addButton(cb: (btn: SettingButtonHandle) => void): this {
    const record: SettingButtonRecord = {
      text: '',
      disabled: false,
      callback: null,
    };
    const btn: SettingButtonHandle = {
      buttonEl: { disabled: false },
      setButtonText(t: string): SettingButtonHandle {
        record.text = t;
        return btn;
      },
      setCta(): SettingButtonHandle {
        return btn;
      },
      onClick(fn: () => void): SettingButtonHandle {
        record.callback = fn;
        return btn;
      },
    };
    cb(btn);
    record.disabled = btn.buttonEl.disabled;
    this.buttons.push(record);
    return this;
  }

  addExtraButton(cb: (btn: SettingExtraButtonHandle) => void): this {
    const record: SettingExtraButtonRecord = {
      icon: '',
      tooltip: '',
      callback: null,
    };
    const btn: SettingExtraButtonHandle = {
      setIcon(icon: string): SettingExtraButtonHandle {
        record.icon = icon;
        return btn;
      },
      setTooltip(t: string): SettingExtraButtonHandle {
        record.tooltip = t;
        return btn;
      },
      onClick(fn: () => void): SettingExtraButtonHandle {
        record.callback = fn;
        return btn;
      },
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
  parent: unknown = null;
  stat = { ctime: 0, mtime: 0, size: 0 };
  vault: unknown = null;
}

export class TFolder {
  path = '';
  name = '';
  parent: unknown = null;
  children: unknown[] = [];
  isRoot(): boolean {
    return this.path === '/';
  }
}

export class TAbstractFile {
  path = '';
  name = '';
  parent: unknown = null;
  vault: unknown = null;
}

export class Vault {
  static recurseChildren(_root: unknown, _cb: (file: unknown) => void): void {
    // no-op
  }
}

/** A view in a leaf; `leaf` is the leaf it is shown in. */
export abstract class View {
  leaf: unknown = null;
  abstract getViewType(): string;
}

/** A view that shows a file (Markdown, canvas, PDF, image, …). */
export abstract class FileView extends View {
  file: TFile | null = null;
}

/** The desktop vault adapter; `getBasePath()` is the vault's absolute path. */
export class FileSystemAdapter {
  basePath = '/tmp/vault';
  getBasePath(): string {
    return this.basePath;
  }
}

/**
 * Test helper: a `FileSystemAdapter` for `basePath`. Typed loosely because
 * tests see Obsidian's real typings, whose constructor differs.
 */
export function mockFileSystemAdapter(basePath: string): unknown {
  return Object.assign(new FileSystemAdapter(), { basePath });
}

/**
 * Obsidian's `normalizePath()`: one `/` between segments, no leading or
 * trailing slash (`/` for the root), non-breaking spaces as spaces, NFC.
 */
export function normalizePath(path: string): string {
  let result = path.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (result === '') result = '/';
  return result.replace(/[\u00A0\u202F]/g, ' ').normalize('NFC');
}

export class App {
  vault: Vault = new Vault();
  workspace: Record<string, unknown> = {};
  metadataCache: Record<string, unknown> = {};
}

export class Notice {
  constructor(_message: string, _timeout?: number) {
    // no-op
  }
}

export function setIcon(el: { _icon?: string } | null, icon: string): void {
  if (el) el._icon = icon;
}

/**
 * Mirrors Obsidian's `parseFrontMatterTags`: the `tags` / `tag` keys (any
 * case), as a list or a comma/space separated string, normalised to `#tag`.
 * Returns null when the frontmatter declares no tags.
 */
export function parseFrontMatterTags(
  frontmatter: Record<string, unknown> | null | undefined,
): string[] | null {
  if (!frontmatter) return null;
  const tags: string[] = [];
  const add = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value !== 'string' && typeof value !== 'number') return;
    for (const part of String(value).split(/[,\s]+/)) {
      const name = part.replace(/^#+/, '');
      if (name) tags.push(`#${name}`);
    }
  };
  for (const key of Object.keys(frontmatter)) {
    if (/^tags?$/i.test(key)) add(frontmatter[key]);
  }
  return tags.length > 0 ? tags : null;
}

/**
 * Mirrors Obsidian's `getAllTags(cache)`: frontmatter tags followed by the
 * inline `cache.tags`, one entry per occurrence (duplicates kept). Returns
 * null when the cache has neither.
 */
export function getAllTags(cache: {
  frontmatter?: Record<string, unknown>;
  tags?: Array<{ tag: string }>;
}): string[] | null {
  const tags = [
    ...(parseFrontMatterTags(cache.frontmatter) ?? []),
    ...(cache.tags ?? []).map((t) => t.tag),
  ];
  return tags.length > 0 ? tags : null;
}

export interface MockModalContentEl {
  createEl: () => Record<string, never>;
  empty: () => void;
}

export class Modal {
  app: unknown;
  contentEl: MockModalContentEl = {
    createEl: (): Record<string, never> => ({}),
    empty: (): void => {},
  };

  title = '';

  constructor(app: unknown) {
    this.app = app;
  }

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  open(): void {
    // no-op
  }

  close(): void {
    // no-op
  }
}

/* ------------------------------------------------------------------ *
 * Typed factories for tests — matches the shape production code uses.
 * ------------------------------------------------------------------ */

export interface MockVaultAdapter {
  basePath: string;
  exists: (path: string) => Promise<boolean>;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  append: (path: string, content: string) => Promise<void>;
  stat: (path: string) => Promise<null>;
}

export interface MockVault {
  configDir: string;
  adapter: MockVaultAdapter;
}

/** In-memory `app.secretStorage` (Obsidian 1.11.4+); `secrets` is inspectable. */
export interface MockSecretStorage {
  secrets: Map<string, string>;
  getSecret: (id: string) => string | null;
  setSecret: (id: string, secret: string) => void;
  listSecrets: () => string[];
}

export function mockSecretStorage(
  initial: Record<string, string> = {},
): MockSecretStorage {
  const secrets = new Map(Object.entries(initial));
  return {
    secrets,
    getSecret: (id: string): string | null => secrets.get(id) ?? null,
    setSecret: (id: string, secret: string): void => {
      secrets.set(id, secret);
    },
    listSecrets: (): string[] => [...secrets.keys()],
  };
}

export interface MockApp {
  vault: MockVault;
  workspace: Record<string, unknown>;
  metadataCache: Record<string, unknown>;
  /** `undefined` simulates an Obsidian without SecretStorage. */
  secretStorage?: MockSecretStorage;
}

export function mockVaultAdapter(
  overrides: Partial<MockVaultAdapter> = {},
): MockVaultAdapter {
  // A FileSystemAdapter, as on desktop, so `getBasePath()` works (#557).
  return Object.assign(new FileSystemAdapter(), {
    basePath: '/tmp/vault',
    exists: (): Promise<boolean> => Promise.resolve(false),
    read: (): Promise<string> => Promise.resolve(''),
    write: (): Promise<void> => Promise.resolve(),
    append: (): Promise<void> => Promise.resolve(),
    stat: (): Promise<null> => Promise.resolve(null),
    ...overrides,
  });
}

export function mockVault(overrides: Partial<MockVault> = {}): MockVault {
  return {
    configDir: '.obsidian',
    adapter: mockVaultAdapter(),
    ...overrides,
  };
}

export function mockApp(overrides: Partial<MockApp> = {}): MockApp {
  return {
    vault: mockVault(),
    workspace: {
      onLayoutReady: (callback: () => void): void => {
        callback();
      },
    },
    metadataCache: {},
    secretStorage: mockSecretStorage(),
    ...overrides,
  };
}
