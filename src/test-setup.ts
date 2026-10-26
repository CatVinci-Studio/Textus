// Unit tests render in any language straight away: every language's strings
// are loaded before they run.
import { LANGS, loadLocale } from "./i18n/strings";

await Promise.all(LANGS.map(loadLocale));
