import type { SecretStorage } from 'obsidian';

/**
 * Where the access key lives (#560). `app.secretStorage` keeps secrets
 * outside the vault, per device; `data.json` is synced and backed up with
 * the vault, so it is only the fallback.
 */
export const ACCESS_KEY_SECRET_ID = 'vault-mcp-server-access-key';

export type AccessKeyLocation = 'secret-storage' | 'data-json';

/** The part of Obsidian's `SecretStorage` the store uses. */
export type SecretStorageLike = Pick<SecretStorage, 'getSecret' | 'setSecret'>;

interface StoreLog {
  info(message: string): void;
  warn(message: string, data?: unknown): void;
}

/**
 * Keeps the access key in Obsidian's `SecretStorage`, with `data.json` as
 * the fallback when the API is missing or fails. The plugin keeps the key
 * in `settings.accessKey` at runtime; this class only decides where it is
 * persisted. It never logs the key.
 */
export class AccessKeyStore {
  private current: AccessKeyLocation;
  /** The value last written to or read from secret storage. */
  private persisted: string | null = null;
  private fallbackLogged = false;

  constructor(
    private readonly storage: SecretStorageLike | undefined,
    private readonly log: StoreLog,
  ) {
    this.current = storage ? 'secret-storage' : 'data-json';
  }

  get location(): AccessKeyLocation {
    return this.current;
  }

  /**
   * Resolve the key on load. `dataKey` is the key found in `data.json`
   * (empty if none). A key already in secret storage wins; otherwise a
   * key from `data.json` is moved there unchanged, so connected clients
   * keep working. The caller removes it from `data.json` by saving while
   * {@link location} is `secret-storage`.
   */
  load(dataKey: string): string {
    if (!this.storage) {
      this.fallBack('Obsidian SecretStorage is not available');
      return dataKey;
    }
    try {
      const stored = this.storage.getSecret(ACCESS_KEY_SECRET_ID);
      if (stored) {
        if (dataKey && dataKey !== stored) {
          // Another device or an older plugin version wrote a key to the
          // synced data.json. The key in secret storage is the one this
          // device's clients use, so it stays.
          this.log.warn(
            'data.json held a different access key than secret storage; kept the one in secret storage and removed the other from data.json',
          );
        }
        this.persisted = stored;
        return stored;
      }
      if (!dataKey) {
        return '';
      }
      this.storage.setSecret(ACCESS_KEY_SECRET_ID, dataKey);
      if (this.storage.getSecret(ACCESS_KEY_SECRET_ID) !== dataKey) {
        throw new Error('the access key did not read back from SecretStorage');
      }
      this.persisted = dataKey;
      this.log.info("Moved the access key from data.json to Obsidian's secret storage");
      return dataKey;
    } catch (error) {
      this.fallBack('Obsidian SecretStorage failed', error);
      return dataKey;
    }
  }

  /**
   * Persist `key`. Returns true when it is in secret storage, so
   * `data.json` must not hold it; false when it has to stay in `data.json`.
   */
  save(key: string): boolean {
    if (this.current === 'data-json' || !this.storage) {
      return false;
    }
    // Unchanged, or still no key: nothing to write.
    if (key === (this.persisted ?? '')) {
      return true;
    }
    try {
      this.storage.setSecret(ACCESS_KEY_SECRET_ID, key);
      this.persisted = key;
      return true;
    } catch (error) {
      this.fallBack('Obsidian SecretStorage failed', error);
      return false;
    }
  }

  private fallBack(reason: string, error?: unknown): void {
    this.current = 'data-json';
    if (this.fallbackLogged) return;
    this.fallbackLogged = true;
    this.log.warn(`${reason}; the access key stays in data.json`, error);
  }
}
