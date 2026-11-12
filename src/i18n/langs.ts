import TABLES from "../prefs/appearance-tables.json";
/**
 * The UI languages, in the order the language pickers list them. "zh" is
 * Simplified Chinese, kept as the code saved settings already use.
 */
export const LANGS = [
  "en",
  "zh",
  "zh-Hant",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "ru",
  "pt",
] as const;

export type Lang = (typeof LANGS)[number];

/** Each language's name in that language, so a user finds their own. */
export const LANG_NAMES = TABLES.langNames as Record<Lang, string>;

/** The BCP 47 tag for a UI language: `<html lang>`, which the CSS :lang()
 *  font stacks key off, and the locale for dates and numbers. One table
 *  with the boot script's (prefs/appearance-tables.json). */
export function localeOf(lang: Lang): string {
  return (TABLES.locales as Partial<Record<Lang, string>>)[lang] ?? lang;
}

export function isLang(value: unknown): value is Lang {
  return (LANGS as readonly unknown[]).includes(value);
}

/** The UI language for an OS locale, English when the app lacks it. Chinese
 *  goes by script, else by region: Taiwan, Hong Kong and Macau get Traditional. */
export function detectLang(locale: string): Lang {
  const tag = locale.toLowerCase().replace(/_/g, "-");
  const [primary, ...rest] = tag.split("-");
  if (primary === "zh") {
    if (rest.includes("hans")) return "zh";
    if (rest.some((sub) => ["hant", "tw", "hk", "mo"].includes(sub)))
      return "zh-Hant";
    return "zh";
  }
  return isLang(primary) ? primary : "en";
}
