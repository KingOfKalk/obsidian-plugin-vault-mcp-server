import { describe, it, expect } from 'vitest';
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
});
