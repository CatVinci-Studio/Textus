import { isLang, type Lang } from "./langs";
import type { Plural } from "./plural";
import { lazyModule, type LazyModule } from "../lazy/lazy-module";
import en from "./locales/en";

export { AI_NAME, APP_NAME } from "./names";
export {
  LANGS,
  LANG_NAMES,
  detectLang,
  isLang,
  localeOf,
  type Lang,
} from "./langs";
export { plural, type Plural } from "./plural";

type English = typeof en;

export type StringKey = keyof English;

/** The UI's strings in one language: English's keys, each a string or, for
 *  a count, the plural forms (plural.ts). */
export type Strings = {
  [K in StringKey]: English[K] extends string ? string : Plural;
};

/** The keys whose value is plain text - those that can be shown as-is. */
export type TextKey = {
  [K in StringKey]: English[K] extends string ? K : never;
}[StringKey];

/** What a language's file holds: any of English's keys, translated. A key
 *  left out shows in English. */
export type Translation = Partial<Strings>;

/** A language's file (locales/<code>.ts): its translations, and whether it
 *  claims to translate every key - strings.test.ts holds a complete one to
 *  that, so a key added later can't go untranslated unnoticed. */
interface Locale {
  default: Translation;
  complete: boolean;
}

/** Every language's file but English's, loaded when the UI is first in it
 *  (lazy-module.ts). English is what a missing key falls back to, so it is
 *  always there; each other language is a chunk of its own. */
const files = import.meta.glob<Locale>(["./locales/*.ts", "!./locales/en.ts"]);

const LOCALES = new Map<Lang, LazyModule<Locale>>([
  [
    "en",
    lazyModule("locale:en", async () => ({ default: en, complete: true })),
  ],
]);
for (const [path, load] of Object.entries(files)) {
  const code = path.slice("./locales/".length, -".ts".length) as Lang;
  LOCALES.set(code, lazyModule(`locale:${code}`, load));
}

/** A language's file, loading it if it hasn't been. */
export function loadLocale(lang: Lang): Promise<Locale> {
  return LOCALES.get(isLang(lang) ? lang : "en")!.load();
}

/** Whether resolveStrings(lang) gives that language's own strings yet. */
export function localeLoaded(lang: Lang): boolean {
  return !isLang(lang) || lang === "en" || !!LOCALES.get(lang)?.peek();
}

const resolved = new Map<Lang, Strings>();

/** The strings for `lang`: its translations over English, so a key it
 *  hasn't translated yet - or a whole language that has none - shows in
 *  English instead of nothing. An unknown code (a newer build's, a hand
 *  edit) gets English, and so does a language whose file hasn't loaded
 *  yet (loadLocale - main.tsx loads the UI's before the first render). */
export function resolveStrings(lang: Lang): Strings {
  const code = isLang(lang) ? lang : "en";
  const cached = resolved.get(code);
  if (cached) return cached;
  const file = code === "en" ? { default: en } : LOCALES.get(code)?.peek();
  if (!file) return resolveStrings("en");
  const merged: Record<string, unknown> = { ...en };
  for (const [key, value] of Object.entries(file.default))
    if (value !== undefined) merged[key] = value;
  const table = merged as Strings;
  resolved.set(code, table);
  return table;
}
