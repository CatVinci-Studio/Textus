// Unit tests render in any language straight away: every language's file
// is loaded before they run, as main.tsx loads the UI's before the first
// render (i18n/strings.ts loads them lazily).
import { LANGS, loadLocale } from "./i18n/strings";

await Promise.all(LANGS.map(loadLocale));
