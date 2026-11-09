import { describe, it, expect } from 'vitest';
import {
  validateVaultPath,
  validateFolderListPath,
  validateToolPath,
  isInConfigDir,
  assertOutsideConfigDir,
  withoutConfigDir,
  ConfigDirError,
  PathTraversalError,
} from '../../src/utils/path-guard';

const VAULT_ROOT = '/home/user/vault';
const CONFIG_DIR = '.obsidian';

describe('validateVaultPath', () => {
  describe('valid paths', () => {
    it('should accept a simple file path', () => {
      expect(validateVaultPath('notes/test.md', VAULT_ROOT)).toBe('notes/test.md');
    });

    it('should accept a root-level file', () => {
      expect(validateVaultPath('test.md', VAULT_ROOT)).toBe('test.md');
    });

    it('should accept deeply nested paths', () => {
      expect(validateVaultPath('a/b/c/d/e.md', VAULT_ROOT)).toBe('a/b/c/d/e.md');
    });

    it('should normalize redundant slashes', () => {
      expect(validateVaultPath('notes//test.md', VAULT_ROOT)).toBe('notes/test.md');
    });

    it('should normalize current directory references', () => {
      expect(validateVaultPath('./notes/test.md', VAULT_ROOT)).toBe('notes/test.md');
    });

    it('should strip leading slashes', () => {
      expect(validateVaultPath('/notes/test.md', VAULT_ROOT)).toBe('notes/test.md');
    });

    it('should accept paths with spaces', () => {
      expect(validateVaultPath('my notes/my file.md', VAULT_ROOT)).toBe('my notes/my file.md');
    });

    it('should accept paths with unicode characters', () => {
      expect(validateVaultPath('notes/日本語.md', VAULT_ROOT)).toBe('notes/日本語.md');
    });
  });

  describe('path traversal attacks', () => {
    it('should reject simple ../ traversal', () => {
      expect(() => validateVaultPath('../etc/passwd', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject ../../ traversal', () => {
      expect(() => validateVaultPath('../../etc/passwd', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject mid-path traversal', () => {
      expect(() => validateVaultPath('notes/../../etc/passwd', VAULT_ROOT)).toThrow(
        PathTraversalError,
      );
    });

    it('should reject backslash traversal', () => {
      expect(() => validateVaultPath('..\\etc\\passwd', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject null byte injection', () => {
      expect(() => validateVaultPath('test.md\0.jpg', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject encoded dot traversal (%2e)', () => {
      expect(() => validateVaultPath('%2e%2e/etc/passwd', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject encoded slash (%2f)', () => {
      expect(() => validateVaultPath('..%2fetc/passwd', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject encoded backslash (%5c)', () => {
      expect(() => validateVaultPath('..%5cetc%5cpasswd', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject uppercase encoded sequences', () => {
      expect(() => validateVaultPath('%2E%2E/%2F', VAULT_ROOT)).toThrow(PathTraversalError);
    });
  });

  describe('edge cases', () => {
    it('should reject empty string', () => {
      expect(() => validateVaultPath('', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject whitespace-only string', () => {
      expect(() => validateVaultPath('   ', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject bare ..', () => {
      expect(() => validateVaultPath('..', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should reject path that resolves to vault root exactly via traversal', () => {
      expect(() => validateVaultPath('notes/../..', VAULT_ROOT)).toThrow(PathTraversalError);
    });

    it('should handle paths with consecutive dots in names (not traversal)', () => {
      expect(validateVaultPath('notes/file...md', VAULT_ROOT)).toBe('notes/file...md');
    });

    it('should handle paths with .. in filenames (not traversal)', () => {
      expect(validateVaultPath('notes/file..name.md', VAULT_ROOT)).toBe('notes/file..name.md');
    });
  });
});

describe('validateFolderListPath', () => {
  it.each(['', '/', '.', './', '  '])('maps %j to the vault root', (input) => {
    expect(validateFolderListPath(input, VAULT_ROOT, CONFIG_DIR)).toBe('');
  });

  it('rejects the config folder and folders inside it (#462)', () => {
    expect(() => validateFolderListPath('.obsidian', VAULT_ROOT, CONFIG_DIR)).toThrow(ConfigDirError);
    expect(() => validateFolderListPath('.obsidian/plugins', VAULT_ROOT, CONFIG_DIR)).toThrow(
      ConfigDirError,
    );
  });

  it('passes ordinary folder paths through validateVaultPath', () => {
    expect(validateFolderListPath('notes/sub', VAULT_ROOT, CONFIG_DIR)).toBe('notes/sub');
    expect(validateFolderListPath('/notes', VAULT_ROOT, CONFIG_DIR)).toBe('notes');
  });

  it('still rejects traversal', () => {
    expect(() => validateFolderListPath('../etc', VAULT_ROOT, CONFIG_DIR)).toThrow(PathTraversalError);
  });

  it('does not change validateVaultPath, which still rejects the root aliases', () => {
    expect(() => validateVaultPath('', VAULT_ROOT)).toThrow(PathTraversalError);
    expect(() => validateVaultPath('/', VAULT_ROOT)).toThrow(PathTraversalError);
  });
});

describe('isInConfigDir (#462)', () => {
  it.each([
    '.obsidian',
    '.obsidian/',
    '.obsidian/app.json',
    '.obsidian/plugins/vault-mcp-server/data.json',
    '.Obsidian/app.json',
    '.OBSIDIAN',
    './.obsidian/app.json',
    '.obsidian//plugins',
    'notes/../.obsidian/app.json',
    '.obsidian./app.json',
    '.obsidian /app.json',
  ])('matches %j', (path) => {
    expect(isInConfigDir(path, CONFIG_DIR)).toBe(true);
  });

  it.each([
    'notes/a.md',
    '.obsidianx/a.md',
    'x.obsidian/a.md',
    'notes/.obsidian/a.md',
    '.obsidian-notes.md',
    '.trash/a.md',
    '',
  ])('does not match %j', (path) => {
    expect(isInConfigDir(path, CONFIG_DIR)).toBe(false);
  });

  it('uses the given config folder, not a hard-coded .obsidian', () => {
    expect(isInConfigDir('.config/app.json', '.config')).toBe(true);
    expect(isInConfigDir('.obsidian/app.json', '.config')).toBe(false);
    expect(isInConfigDir('.config/app.json', '/.config/')).toBe(true);
  });

  it('matches nothing for an empty config folder', () => {
    expect(isInConfigDir('.obsidian/app.json', '')).toBe(false);
    expect(isInConfigDir('notes/a.md', '/')).toBe(false);
  });
});

describe('assertOutsideConfigDir (#462)', () => {
  it('throws ConfigDirError, a PathTraversalError, naming the folder', () => {
    let caught: unknown;
    try {
      assertOutsideConfigDir('.obsidian/app.json', CONFIG_DIR);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigDirError);
    expect(caught).toBeInstanceOf(PathTraversalError);
    expect((caught as Error).message).toBe(
      'Path is inside the Obsidian config folder (.obsidian); it cannot be read or written',
    );
  });

  it('passes other paths', () => {
    expect(() => assertOutsideConfigDir('notes/a.md', CONFIG_DIR)).not.toThrow();
  });
});

describe('validateToolPath (#462)', () => {
  it('returns the normalised path outside the config folder', () => {
    expect(validateToolPath('/notes/a.md', VAULT_ROOT, CONFIG_DIR)).toBe('notes/a.md');
  });

  it('rejects the config folder after normalisation', () => {
    expect(() => validateToolPath('/.obsidian/app.json', VAULT_ROOT, CONFIG_DIR)).toThrow(
      ConfigDirError,
    );
    expect(() => validateToolPath('notes/../.Obsidian/app.json', VAULT_ROOT, CONFIG_DIR)).toThrow(
      ConfigDirError,
    );
  });

  it('still rejects traversal first', () => {
    expect(() => validateToolPath('../x', VAULT_ROOT, CONFIG_DIR)).toThrow(
      'Path must not traverse outside the vault',
    );
  });

  it('leaves validateVaultPath alone: it does not know the config folder', () => {
    expect(validateVaultPath('.obsidian/app.json', VAULT_ROOT)).toBe('.obsidian/app.json');
  });
});

describe('withoutConfigDir (#462)', () => {
  it('drops the config folder and its contents from a listing', () => {
    expect(
      withoutConfigDir(
        {
          files: ['a.md', '.obsidian/app.json', '.Obsidian/x.json'],
          folders: ['notes', '.obsidian', '.obsidian/plugins'],
        },
        CONFIG_DIR,
      ),
    ).toEqual({ files: ['a.md'], folders: ['notes'] });
  });
});
