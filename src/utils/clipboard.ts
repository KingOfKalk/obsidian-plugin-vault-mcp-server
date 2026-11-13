import { Notice } from 'obsidian';
import type { Logger } from './logger';
import { reportError } from './report-error';

/**
 * Copy `text` to the clipboard and show `notice` once it is there. A
 * failure is logged and reported as "`scope` failed".
 */
export function copyWithNotice(
  text: string,
  notice: string,
  scope: string,
  logger: Logger,
): void {
  void writeWithNotice(text, notice, scope, logger);
}

async function writeWithNotice(
  text: string,
  notice: string,
  scope: string,
  logger: Logger,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(notice);
  } catch (err) {
    reportError(scope, logger)(err);
  }
}
