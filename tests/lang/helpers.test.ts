import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/lang/helpers';
import en from '../../src/lang/locale/en';
import de from '../../src/lang/locale/de';

interface WindowWithStorage {
  localStorage: { getItem: (key: string) => string | null };
}

function setLanguage(lang: string | null): void {
  const win: WindowWithStorage = {
    localStorage: {
      getItem: (key: string): string | null =>
        key === 'language' ? lang : null,
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
}

function clearWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

describe('t()', () => {
  const consoleErrorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => {});

  beforeEach(() => {
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    clearWindow();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('locale detection', () => {
    it('returns the English string when language is "en"', () => {
      setLanguage('en');
      expect(t('setting_status_name')).toBe(en.setting_status_name);
    });

    it('returns the German string when language is "de"', () => {
      setLanguage('de');
      expect(t('setting_status_name')).toBe(de.setting_status_name);
    });

    it('falls back to English when window is undefined (SSR / tests)', () => {
      clearWindow();
      expect(t('setting_port_name')).toBe(en.setting_port_name);
    });

    it('falls back to English when language is not set', () => {
      setLanguage(null);
      expect(t('setting_port_name')).toBe(en.setting_port_name);
    });

    it('does not log an error when using a registered locale', () => {
      setLanguage('de');
      t('setting_status_name');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('fallback behaviour', () => {
    it('falls back to English when the German translation is missing for a key', () => {
      setLanguage('de');
      const germanMap = de as Partial<Record<string, string>>;
      // Sanity check: the key exists in English but we simulate a gap in German
      const key = 'setting_status_name';
      const original = germanMap[key];
      delete germanMap[key];
      try {
        expect(t('setting_status_name')).toBe(en.setting_status_name);
      } finally {
        if (original !== undefined) germanMap[key] = original;
      }
    });

    it('falls back to English for an unknown locale and logs an error', () => {
      setLanguage('fr');
      const result = t('setting_port_name');
      expect(result).toBe(en.setting_port_name);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('fr'),
      );
    });
  });

  describe('interpolation', () => {
    it('substitutes a single placeholder', () => {
      setLanguage('en');
      expect(t('notice_server_started', { port: 28741 })).toBe(
        'MCP server started on port 28741',
      );
    });

    it('substitutes multiple placeholders', () => {
      setLanguage('en');
      expect(
        t('status_running_many', {
          url: 'http://127.0.0.1:28741',
          count: 3,
        }),
      ).toBe('Running on http://127.0.0.1:28741 (3 connections)');
    });

    it('leaves unknown placeholders untouched when params are missing', () => {
      setLanguage('en');
      expect(t('notice_server_started')).toBe('MCP server started on port {port}');
    });

    it('applies interpolation to the German string when locale is "de"', () => {
      setLanguage('de');
      expect(t('notice_server_started', { port: 28741 })).toBe(
        'MCP-Server auf Port 28741 gestartet',
      );
    });
  });
});
