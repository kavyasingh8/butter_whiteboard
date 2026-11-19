import en from '../../locales/en.json';

// English is bundled so the UI works before the game sends a locale, and in `npm run dev`.
const strings: Record<string, string> = { ...en.ui };

export type StringKey = keyof typeof en.ui;

/** Replaces the strings with the active locale's `ui` section sent by the client. */
export function setLocale(locale: Record<string, string> | unknown[] | null | undefined) {
  if (!locale || Array.isArray(locale)) return;
  Object.assign(strings, locale);
}

/** A UI string, with each `%s` replaced by the next argument. */
export function t(key: StringKey, ...args: (string | number)[]) {
  let i = 0;
  return (strings[key] ?? key).replace(/%s/g, () => String(args[i++] ?? ''));
}
