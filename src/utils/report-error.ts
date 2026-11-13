import { Notice } from 'obsidian';
import { t } from '../lang/helpers';
import type { Logger } from './logger';

export function reportError(
  scope: string,
  logger: Logger,
): (err: unknown) => void {
  return (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${scope}: ${message}`, err);
    new Notice(t('notice_action_failed', { action: scope }));
  };
}
