import { randomBytes } from 'crypto';
import type { Setting } from 'obsidian';

export interface ValidationErrorController {
  show: (message: string) => void;
  clear: () => void;
}

/**
 * Attach an error-message slot to a Setting's description. Call `show(msg)` to
 * render the slot below the description, and `clear()` to remove it. Multiple
 * controllers can be attached to the same Setting — each owns a separate
 * `mcp-settings-error` element.
 */
export function createValidationError(
  setting: Setting,
): ValidationErrorController {
  let errorEl: HTMLElement | null = null;
  return {
    show: (message: string): void => {
      if (errorEl) {
        errorEl.textContent = message;
        return;
      }
      errorEl = setting.descEl.createEl('div', {
        cls: 'mcp-settings-error',
        text: message,
      });
    },
    clear: (): void => {
      if (errorEl) {
        errorEl.remove();
        errorEl = null;
      }
    },
  };
}

/** Generate a fresh 256-bit hex access key for Bearer authentication. */
export function generateAccessKey(): string {
  return randomBytes(32).toString('hex');
}

/** Minimal IPv4 validator — four decimal octets in 0..255. */
export function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return /^\d{1,3}$/.test(part) && num >= 0 && num <= 255;
  });
}
