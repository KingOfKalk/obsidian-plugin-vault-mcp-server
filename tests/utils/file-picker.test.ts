import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickFile } from '../../src/utils/file-picker';

type RequireFn = (module: string) => unknown;

interface WindowLike {
  require?: RequireFn;
}

describe('pickFile', () => {
  // Obsidian's window, where the picker finds Node's `require` (#557).
  let win: WindowLike;

  beforeEach(() => {
    win = {};
    vi.stubGlobal('window', win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null outside Obsidian, where there is no window', async () => {
    vi.unstubAllGlobals();
    expect(typeof window).toBe('undefined');
    const result = await pickFile({ title: 't', filters: [] });
    expect(result).toBeNull();
  });

  it('returns the first selected path when the user picks a file', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/my.crt'],
    });
    win.require = (m: string): unknown => {
      if (m === 'electron') {
        return { remote: { dialog: { showOpenDialog } } };
      }
      throw new Error(`unexpected require: ${m}`);
    };

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
    win.require = (m: string): unknown => {
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
    };

    const result = await pickFile({ title: 't', filters: [] });
    expect(result).toBeNull();
  });

  it('returns null when Electron is not available', async () => {
    win.require = undefined;
    const result = await pickFile({ title: 't', filters: [] });
    expect(result).toBeNull();
  });

  it('returns null when the dialog resolves without filePaths', async () => {
    win.require = (m: string): unknown => {
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
    };

    const result = await pickFile({ title: 't', filters: [] });
    expect(result).toBeNull();
  });
});
