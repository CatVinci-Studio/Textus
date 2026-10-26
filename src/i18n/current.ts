import type { Lang } from "./langs";
import { resolveStrings, type Strings } from "./strings";

/** The interface language, for code outside React that has no useSettings.
 *  Kept up to date by SettingsContext. */
let current: Lang = "en";

export function setCurrentLanguage(lang: Lang) {
  current = lang;
}

export function currentStrings(): Strings {
  return resolveStrings(current);
}
