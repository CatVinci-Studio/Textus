import type { Lang } from "./langs";
import { resolveStrings, type Strings } from "./strings";
import { plural, type Plural } from "./plural";

/** The interface language, for code outside React that has no useSettings.
 *  Kept up to date by SettingsContext. */
let current: Lang = "en";

export function setCurrentLanguage(lang: Lang) {
  current = lang;
}

export function currentLanguage(): Lang {
  return current;
}

/** A count in words, as the interface language says it ("1 note", "3
 *  notes"; one form in Chinese, three in Russian). */
export function counted(forms: Plural, n: number): string {
  return plural(forms, n, current);
}

export function currentStrings(): Strings {
  return resolveStrings(current);
}
