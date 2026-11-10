import { describe, it, expect, vi } from 'vitest';
import { renderAllowlistSection } from '../../src/settings/allowlist-section';
import type McpPlugin from '../../src/main';

interface FakeEl {
  tag: string;
  text?: string;
  value: string;
  listeners: Map<string, () => void>;
  addEventListener: (event: string, handler: () => void) => void;
}

function fakeContainer(): { container: HTMLElement; created: FakeEl[] } {
  const created: FakeEl[] = [];
  const container = {
    createEl: (tag: string, opts?: { text?: string }): FakeEl => {
      const el: FakeEl = {
        tag,
        text: opts?.text,
        value: '',
        listeners: new Map(),
        addEventListener: (event, handler): void => {
          el.listeners.set(event, handler);
        },
      };
      created.push(el);
      return el;
    },
  };
  return { container: container as unknown as HTMLElement, created };
}

describe('renderAllowlistSection (#469)', () => {
  function render(initial: string[]): {
    textarea: FakeEl;
    plugin: { settings: { executeCommandAllowlist: string[] }; registry: { refreshAvailability: ReturnType<typeof vi.fn> }; saveSettings: ReturnType<typeof vi.fn> };
    created: FakeEl[];
  } {
    const plugin = {
      settings: { executeCommandAllowlist: initial },
      registry: { refreshAvailability: vi.fn().mockReturnValue(true) },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      logger: { error: vi.fn() },
    };
    const { container, created } = fakeContainer();
    renderAllowlistSection(container, plugin as unknown as McpPlugin);
    const textarea = created.find((el) => el.tag === 'textarea');
    if (!textarea) throw new Error('no textarea');
    return { textarea, plugin, created };
  }

  it('shows the saved allowlist one id per line', () => {
    const { textarea } = render(['app:reload', 'editor:save-file']);
    expect(textarea.value).toBe('app:reload\neditor:save-file');
  });

  it('says the tool is hidden while the list is empty', () => {
    const { created } = render([]);
    const note = created.find((el) => el.tag === 'p');
    expect(note?.text).toMatch(/do not see the tool/);
  });

  it('saving the list stores the trimmed ids and re-checks tool availability', () => {
    const { textarea, plugin } = render([]);
    textarea.value = '  app:reload \n\n editor:save-file\r\n';
    textarea.listeners.get('change')?.();
    expect(plugin.settings.executeCommandAllowlist).toEqual(['app:reload', 'editor:save-file']);
    expect(plugin.registry.refreshAvailability).toHaveBeenCalledTimes(1);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });
});
