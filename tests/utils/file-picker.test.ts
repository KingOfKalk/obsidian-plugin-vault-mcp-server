import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickFile } from '../../src/utils/file-picker';

type RequireFn = (module: string) => unknown;

interface WindowLike {
  require?: RequireFn;
}

describe('pickFile', () => {
  const originalRequire = (globalThis as unknown as WindowLike).require;

  beforeEach(() => {
    (globalThis as unknown as WindowLike).require = undefined;
  });

  afterEach(() => {
    (globalThis as unknown as WindowLike).require = originalRequire;
  });

  it('returns the first selected path when the user picks a file', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/my.crt'],
    });
    (globalThis as unknown as WindowLike).require = ((m: string) => {
      if (m === 'electron') {
        return { remote: { dialog: { showOpenDialog } } };
      }
      throw new Error(`unexpected require: ${m}`);
    }) as RequireFn;

    const result = await pickFile({
      title: 'Pick a cert',
      filters: [{ name: 'PEM', extensions: ['pem', 'crt'] }],
    });

    expect(result).toBe('/tmp/my.crt');
    expect(showOpenDialog).toHaveBeenCalledWith({
      title: 'Pick a cert',
      properties: ['openFile'],
      filters: [{ name: 'PEM', extensions: ['pem', 'crt'] }],
    });
  });

  it('returns null when the user cancels the dialog', async () => {
    (globalThis as unknown as WindowLike).require = ((m: string) => {
      if (m === 'electron') {
        return {
          remote: {
            dialog: {
              showOpenDialog: vi
                .fn()
                .mockResolvedValue({ canceled: true, filePaths: [] }),
            },
          },
        };
      }
      throw new Error(`unexpected require: ${m}`);
    }) as RequireFn;

    const result = await pickFile({ title: 't', filters: [] });
    expect(result).toBeNull();
  });

  it('returns null when Electron is not available', async () => {
    (globalThis as unknown as WindowLike).require = undefined;
    const result = await pickFile({ title: 't', filters: [] });
    expect(result).toBeNull();
  });

  it('returns null when the dialog resolves without filePaths', async () => {
    (globalThis as unknown as WindowLike).require = ((m: string) => {
      if (m === 'electron') {
        return {
          remote: {
            dialog: {
              showOpenDialog: vi
                .fn()
                .mockResolvedValue({ canceled: false, filePaths: [] }),
            },
          },
        };
      }
      throw new Error(`unexpected require: ${m}`);
    }) as RequireFn;

    const result = await pickFile({ title: 't', filters: [] });
    expect(result).toBeNull();
  });
});
