import en from './locale/en';
import de from './locale/de';

export type TranslationKey = keyof typeof en;

type LocaleMap = Partial<Record<TranslationKey, string>>;

// Registry of supported locales. Add a new entry here when a new translation
// file is introduced; `t()` looks up by the raw value of Obsidian's
// `localStorage.getItem('language')`.
const locales: Record<string, LocaleMap> = {
  en,
  de,
};

function detectLocale(): string {
  if (typeof window === 'undefined') return 'en';
  try {
    return window.localStorage.getItem('language') ?? 'en';
  } catch {
    return 'en';
  }
}

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
  const lang = detectLocale();
  const map = locales[lang];
  if (!map) {
    // Unknown locale → surface a one-line console error so the user/dev
    // can tell why their translations aren't showing up, then fall back
    // to English. The logger module is intentionally not used here to
    // keep this module dependency-free.
    // eslint-disable-next-line no-console
    console.error(
      `[vault-mcp-server] locale "${lang}" is not registered, falling back to en`,
    );
  }
  const raw = map?.[key] ?? en[key];
  return params ? interpolate(raw, params) : raw;
}
