import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  ACCESS_KEY_SECRET_ID,
  AccessKeyStore,
  type SecretStorageLike,
} from '../../src/settings/access-key-store';

/** In-memory stand-in for `app.secretStorage`. */
function memoryStorage(initial: Record<string, string> = {}): SecretStorageLike & {
  secrets: Map<string, string>;
} {
  const secrets = new Map(Object.entries(initial));
  return {
    secrets,
    getSecret: vi.fn((id: string) => secrets.get(id) ?? null),
    setSecret: vi.fn((id: string, secret: string) => {
      secrets.set(id, secret);
    }),
  };
}

function quietLog(): {
  info: Mock<(message: string) => void>;
  warn: Mock<(message: string, data?: unknown) => void>;
} {
  return {
    info: vi.fn<(message: string) => void>(),
    warn: vi.fn<(message: string, data?: unknown) => void>(),
  };
}

describe('AccessKeyStore (#560)', () => {
  it('uses a valid SecretStorage id (lowercase alphanumeric with dashes)', () => {
    expect(ACCESS_KEY_SECRET_ID).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  describe('load', () => {
    it('moves a key found in data.json into secret storage, unchanged', () => {
      const storage = memoryStorage();
      const log = quietLog();
      const store = new AccessKeyStore(storage, log);

      expect(store.load('existing-key')).toBe('existing-key');
      expect(storage.secrets.get(ACCESS_KEY_SECRET_ID)).toBe('existing-key');
      expect(store.location).toBe('secret-storage');
      expect(log.info).toHaveBeenCalledTimes(1);
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('returns the key from secret storage when data.json has none', () => {
      const storage = memoryStorage({ [ACCESS_KEY_SECRET_ID]: 'stored-key' });
      const store = new AccessKeyStore(storage, quietLog());

      expect(store.load('')).toBe('stored-key');
      expect(store.location).toBe('secret-storage');
      expect(storage.setSecret).not.toHaveBeenCalled();
    });

    it('keeps the key in secret storage when data.json holds a different one', () => {
      const storage = memoryStorage({ [ACCESS_KEY_SECRET_ID]: 'stored-key' });
      const log = quietLog();
      const store = new AccessKeyStore(storage, log);

      expect(store.load('other-key')).toBe('stored-key');
      expect(storage.secrets.get(ACCESS_KEY_SECRET_ID)).toBe('stored-key');
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('stored-key');
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('other-key');
    });

    it('returns an empty key on a fresh install without writing anything', () => {
      const storage = memoryStorage();
      const store = new AccessKeyStore(storage, quietLog());

      expect(store.load('')).toBe('');
      expect(store.location).toBe('secret-storage');
      expect(storage.setSecret).not.toHaveBeenCalled();
    });

    it('falls back to data.json when SecretStorage is not available', () => {
      const log = quietLog();
      const store = new AccessKeyStore(undefined, log);

      expect(store.load('existing-key')).toBe('existing-key');
      expect(store.location).toBe('data-json');
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('falls back to data.json when reading the secret throws', () => {
      const storage = memoryStorage();
      vi.mocked(storage.getSecret).mockImplementation(() => {
        throw new Error('safeStorage unavailable');
      });
      const log = quietLog();
      const store = new AccessKeyStore(storage, log);

      expect(store.load('existing-key')).toBe('existing-key');
      expect(store.location).toBe('data-json');
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('keeps the key in data.json when the moved key does not read back', () => {
      const storage = memoryStorage();
      vi.mocked(storage.setSecret).mockImplementation(() => {
        // Silently drops the write.
      });
      const store = new AccessKeyStore(storage, quietLog());

      expect(store.load('existing-key')).toBe('existing-key');
      expect(store.location).toBe('data-json');
    });
  });

  describe('save', () => {
    it('writes a new key (e.g. Generate) to secret storage', () => {
      const storage = memoryStorage({ [ACCESS_KEY_SECRET_ID]: 'old-key' });
      const store = new AccessKeyStore(storage, quietLog());
      store.load('');

      expect(store.save('new-key')).toBe(true);
      expect(storage.secrets.get(ACCESS_KEY_SECRET_ID)).toBe('new-key');
    });

    it('does not rewrite an unchanged key', () => {
      const storage = memoryStorage({ [ACCESS_KEY_SECRET_ID]: 'stored-key' });
      const store = new AccessKeyStore(storage, quietLog());
      store.load('');

      expect(store.save('stored-key')).toBe(true);
      expect(storage.setSecret).not.toHaveBeenCalled();
    });

    it('does not create an empty secret when there is no key', () => {
      const storage = memoryStorage();
      const store = new AccessKeyStore(storage, quietLog());
      store.load('');

      expect(store.save('')).toBe(true);
      expect(storage.setSecret).not.toHaveBeenCalled();
    });

    it('returns false in fallback mode, so data.json keeps the key', () => {
      const store = new AccessKeyStore(undefined, quietLog());
      store.load('existing-key');

      expect(store.save('new-key')).toBe(false);
    });

    it('falls back to data.json when writing the secret throws, and warns once', () => {
      const storage = memoryStorage();
      const log = quietLog();
      const store = new AccessKeyStore(storage, log);
      store.load('');
      vi.mocked(storage.setSecret).mockImplementation(() => {
        throw new Error('write failed');
      });

      expect(store.save('new-key')).toBe(false);
      expect(store.save('newer-key')).toBe(false);
      expect(store.location).toBe('data-json');
      expect(log.warn).toHaveBeenCalledTimes(1);
    });
  });
});
