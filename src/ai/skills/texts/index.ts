import type { Lang } from "../../../i18n/langs";
import { isLang } from "../../../i18n/langs";
import type { BuiltinSkillName, SkillText, SkillTexts } from "../builtin";
import en from "./en";
import zh from "./zh";
import zhHant from "./zh-Hant";
import ja from "./ja";
import ko from "./ko";
import es from "./es";
import fr from "./fr";
import de from "./de";
import ru from "./ru";
import pt from "./pt";

/**
 * The built-in skills' labels, hints and aliases in every UI language
 * (docs/dev/translating.md, the sixth file of a language). Each file covers all
 * eighteen skills - the type says so - so none shows in another language.
 */
export const SKILL_TEXTS: Record<Lang, SkillTexts> = {
  en,
  zh,
  "zh-Hant": zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  ru,
  pt,
};

/** A built-in's words in `lang` (English for an unknown code). */
export function skillText(lang: Lang, name: BuiltinSkillName): SkillText {
  return SKILL_TEXTS[isLang(lang) ? lang : "en"][name];
}
