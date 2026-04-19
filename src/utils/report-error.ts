import { Notice } from 'obsidian';
import type { Logger } from './logger';

export function reportError(
  scope: string,
  logger: Logger,
): (err: unknown) => void {
  return (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${scope}: ${message}`, err);
    new Notice(`Obsidian MCP: ${scope} failed — see console`);
  };
}
