import type { Lang } from "./langs";
import { resolveStrings, type Strings } from "./strings";

/**
 * The interface language, for code that draws outside React - an editor
 * widget, a preview in the document - and so has no useSettings. Kept up
 * to date by SettingsContext.
 */
let current: Lang = "en";

export function setCurrentLanguage(lang: Lang) {
  current = lang;
}

/** The interface's strings, in its language now. */
export function currentStrings(): Strings {
  return resolveStrings(current);
}
