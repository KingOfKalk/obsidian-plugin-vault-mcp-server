import { getLanguage } from 'obsidian';
import en from './locale/en';
import de from './locale/de';

export type TranslationKey = keyof typeof en;

type LocaleMap = Partial<Record<TranslationKey, string>>;

// Registry of supported locales. Add a new entry here when a new translation
// file is introduced; `t()` looks up by the code Obsidian's `getLanguage()`
// returns (#557).
const locales: Record<string, LocaleMap> = {
  en,
  de,
};

/** Unknown locales already reported, so each is logged once, not per lookup. */
const reportedLocales = new Set<string>();

function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const lang = getLanguage();
  const map = locales[lang];
  if (!map && !reportedLocales.has(lang)) {
    // Unknown locale → surface a one-line console error so the user/dev
    // can tell why their translations aren't showing up, then fall back
    // to English. The logger module is intentionally not used here to
    // keep this module dependency-free.
    reportedLocales.add(lang);
    console.error(
      `[vault-mcp-server] locale "${lang}" is not registered, falling back to en`,
    );
  }
  const raw = map?.[key] ?? en[key];
  return params ? interpolate(raw, params) : raw;
}
