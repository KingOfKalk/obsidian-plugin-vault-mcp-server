import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import {
  handleToolError,
  BinaryTooLargeError,
  NotFoundError,
  ValidationError,
  PluginNotInstalledError,
  DestinationExistsError,
  FileNotFoundError,
  registerVaultBasePath,
  clearVaultBasePaths,
  redactFilesystemPaths,
} from '../../../src/tools/shared/errors';
import { PathTraversalError } from '../../../src/utils/path-guard';

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content[0];
  return item.type === 'text' && item.text !== undefined ? item.text : '';
}

describe('handleToolError', () => {
  it('maps ZodError to Invalid arguments with path/message pairs', () => {
    const schema = z.object({ path: z.string().min(1) });
    let zodErr: z.ZodError | null = null;
    try {
      schema.parse({ path: '' });
    } catch (e) {
      if (e instanceof z.ZodError) zodErr = e;
    }
    expect(zodErr).not.toBeNull();

    const result = handleToolError(zodErr);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Invalid arguments');
    expect(getText(result)).toContain('path');
  });

  it('maps PathTraversalError to the same message with Error: prefix', () => {
    const result = handleToolError(new PathTraversalError('Outside vault'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: Outside vault');
  });

  it('maps NotFoundError to the bare message', () => {
    const result = handleToolError(new NotFoundError('File not found: a.md'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: File not found: a.md');
  });

  it('passes ValidationError messages straight through', () => {
    const result = handleToolError(new ValidationError('bad shape'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: bad shape');
  });

  it('passes the other typed errors through without redacting paths', () => {
    registerVaultBasePath('/home/u/vault');
    expect(getText(handleToolError(new FileNotFoundError('a.md', 'a.md.md')))).toBe(
      'Error: File not found: a.md. Did you mean a.md.md?',
    );
    expect(getText(handleToolError(new PluginNotInstalledError('dataview')))).toBe(
      'Error: Plugin not installed or disabled: dataview',
    );
    expect(getText(handleToolError(new DestinationExistsError('/home/u/vault/b.md')))).toBe(
      'Error: Destination already exists: /home/u/vault/b.md. Choose another path or delete it first; nothing was changed.',
    );
    expect(getText(handleToolError(new BinaryTooLargeError(10, 5)))).toContain(
      'Error: Binary file too large (10 bytes, limit 5).',
    );
    clearVaultBasePaths();
  });

  it('falls through to the generic Error branch for plain Errors', () => {
    const result = handleToolError(new Error('plain boom'));
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: plain boom');
  });

  it('stringifies non-Error values', () => {
    const result = handleToolError('oops');
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Error: oops');
  });
});

describe('BinaryTooLargeError', () => {
  it('renders a clear message including size and limit', () => {
    const err = new BinaryTooLargeError(2_000_000, 1_048_576);
    expect(err.name).toBe('BinaryTooLargeError');
    expect(err.message).toBe(
      'Binary file too large (2000000 bytes, limit 1048576). Fetch the file out-of-band or use a chunked read when available.',
    );
    expect(err.sizeBytes).toBe(2_000_000);
    expect(err.limitBytes).toBe(1_048_576);
  });

  it('handleToolError maps BinaryTooLargeError to an isError CallToolResult with the same message', () => {
    const result = handleToolError(new BinaryTooLargeError(2_000_000, 1_048_576));
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'Error: Binary file too large (2000000 bytes, limit 1048576). Fetch the file out-of-band or use a chunked read when available.',
    });
  });
});

describe('handleToolError never leaks absolute filesystem paths (#405)', () => {
  afterEach(() => {
    clearVaultBasePaths();
  });

  it('turns the registered vault base path into a vault-relative path', () => {
    registerVaultBasePath('/home/alice/Vault/');
    const err = new Error("ENOENT: no such file or directory, open '/home/alice/Vault/new/note.md'");
    const text = getText(handleToolError(err));
    expect(text).toBe("Error: ENOENT: no such file or directory, open 'new/note.md'");
  });

  it('replaces a bare vault base path with <vault>', () => {
    registerVaultBasePath('/home/alice/Vault');
    expect(redactFilesystemPaths('cannot scan /home/alice/Vault')).toBe('cannot scan <vault>');
  });

  it('handles a Windows vault base path', () => {
    registerVaultBasePath('C:\\Users\\alice\\Vault');
    expect(
      redactFilesystemPaths("EPERM: operation not permitted, open 'C:\\Users\\alice\\Vault\\a\\b.md'"),
    ).toBe("EPERM: operation not permitted, open 'a\\b.md'");
  });

  it('redacts unknown absolute paths when no base path is registered', () => {
    const err = new Error("ENOENT: no such file or directory, open '/srv/vaults/me/x/y.md'");
    expect(getText(handleToolError(err))).toBe(
      "Error: ENOENT: no such file or directory, open '<path>'",
    );
    expect(redactFilesystemPaths('failed at C:\\Users\\bob\\v\\a.md')).toBe('failed at <path>');
    expect(redactFilesystemPaths('failed at D:/v/a.md now')).toBe('failed at <path> now');
  });

  it('leaves vault-relative paths and short messages alone', () => {
    expect(redactFilesystemPaths('File already exists: notes/a.md')).toBe(
      'File already exists: notes/a.md',
    );
    expect(redactFilesystemPaths('Folder not found: /')).toBe('Folder not found: /');
    expect(redactFilesystemPaths('a/b and x-y/c/d.md')).toBe('a/b and x-y/c/d.md');
  });

  it('applies to non-Error values too', () => {
    expect(getText(handleToolError('bad /tmp/x/y'))).toBe('Error: bad <path>');
  });
});
