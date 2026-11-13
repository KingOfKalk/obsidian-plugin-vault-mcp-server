import { describe, it, expect, vi } from 'vitest';
import { mockElement, type Modal as MockModal } from '../__mocks__/obsidian';
import { DebugInfoModal } from '../../src/ui/debug-info-modal';

describe('DebugInfoModal', () => {
  it('constructs without throwing when handed a stub plugin', () => {
    const stubPlugin = {
      logger: {
        error: (): void => {},
      },
    };
    const modal = new DebugInfoModal(
      {} as never,
      stubPlugin as never,
    );
    expect(modal).toBeInstanceOf(DebugInfoModal);
  });

  it('onClose empties the content element', () => {
    const stubPlugin = { logger: { error: (): void => {} } };
    const modal = new DebugInfoModal({} as never, stubPlugin as never);
    // The mock Modal.contentEl comes with an `empty` method — onClose should
    // call it without throwing.
    expect(() => {
      modal.onClose();
    }).not.toThrow();
  });

  it('sets its title with Modal.setTitle instead of an HTML heading (#558)', () => {
    const stubPlugin = { logger: { error: vi.fn() } };
    const modal = new DebugInfoModal({} as never, stubPlugin as never);
    const contentEl = mockElement();
    (modal as unknown as { contentEl: unknown }).contentEl = contentEl;

    modal.onOpen();

    expect((modal as unknown as MockModal).title).toBe('Debug info');
    expect(contentEl.children.find((c) => /^h[1-6]$/.test(c.tagName))).toBeUndefined();
  });
});
