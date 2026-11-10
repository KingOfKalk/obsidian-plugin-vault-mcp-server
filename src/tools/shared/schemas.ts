import { z } from 'zod';
import { FILE_PATH_DESC, vaultPathField } from './descriptions';

/** Input schema of a tool without parameters. */
export const noParamsSchema = {};

/** Input schema of a tool that takes one file path. */
export const filePathSchema = { path: vaultPathField(FILE_PATH_DESC) };

/** Most characters of text one write or edit call may carry. */
export const MAX_TEXT_LENGTH = 5_000_000;

/** A text parameter of a write or edit tool, up to {@link MAX_TEXT_LENGTH}. */
export const textInput = z.string().max(MAX_TEXT_LENGTH);
