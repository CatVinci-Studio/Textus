import { describe, expect, it } from "vitest";
import { LANGS } from "../../../i18n/langs";
import { SKILL_TEXTS, skillText } from ".";
import { BUILTIN_SKILLS } from "../builtin";
import { fold } from "../../chat/skill-picker";

// The built-in skills' words in every UI language: what the `/` menu and
// Settings show, and what people type after `/`.

/** Each UI's word for inline completion: never a skill's label, or two
 *  different things would answer to one name. */
const COMPLETION_WORDS = [
  "续写",
  "續寫",
  "補完",
  "이어 쓰기",
  "autocompletado",
  "complétion",
  "Vervollständigung",
  "автодополнение",
  "autocompletar",
];

describe.each(LANGS)("%s", (lang) => {
  const texts = SKILL_TEXTS[lang];

  it("names every built-in, and nothing else", () => {
    expect(Object.keys(texts).sort()).toEqual(
      BUILTIN_SKILLS.map((s) => s.name).sort(),
    );
  });

  it("gives each a short label and a one-line hint", () => {
    for (const [name, text] of Object.entries(texts)) {
      expect(text.label.trim(), name).toBe(text.label);
      expect(text.label.length, name).toBeGreaterThan(0);
      expect([...text.label].length, name).toBeLessThanOrEqual(36);
      expect(text.hint.trim(), name).toBeTruthy();
      expect(text.hint, name).not.toMatch(/\n/);
      expect(text.hint, name).not.toMatch(/[.。]$/);
      for (const alias of text.aliases) expect(alias.trim(), name).toBe(alias);
    }
  });

  it("never labels a skill with the word for inline completion", () => {
    for (const text of Object.values(texts))
      expect(COMPLETION_WORDS).not.toContain(text.label);
  });
});

describe("what people type after /", () => {
  it("means one skill, in whatever language it is typed", () => {
    const owner = new Map<string, string>();
    for (const lang of LANGS)
      for (const [name, text] of Object.entries(SKILL_TEXTS[lang]))
        for (const term of [text.label, ...text.aliases]) {
          const key = fold(term);
          const other = owner.get(key);
          expect(other ?? name, `"${term}" (${lang})`).toBe(name);
          owner.set(key, name);
        }
    // Nor is any of them another skill's own name.
    for (const skill of BUILTIN_SKILLS) {
      const other = owner.get(skill.name);
      expect(other ?? skill.name).toBe(skill.name);
    }
  });

  it("falls back to English for an unknown language", () => {
    expect(skillText("xx" as never, "proofread")).toBe(
      SKILL_TEXTS.en.proofread,
    );
  });
});
