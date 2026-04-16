import { describe, it, expect } from 'vitest';
import { validateVaultPath, PathTraversalError } from '../../src/utils/path-guard';

const VAULT_ROOT = '/home/user/vault';

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
