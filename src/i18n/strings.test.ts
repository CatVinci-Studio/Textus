import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalize } from "../onboarding/tutorial-mock-agent";
import { pluralCategories } from "./plural";
import {
  LANGS,
  LANG_NAMES,
  LOCALES,
  localeOf,
  resolveStrings,
  type Plural,
  type StringKey,
} from "./strings";

// Every language's file against English (docs/dev/translating.md): what a
// translation may and must contain, whoever wrote it.

const english = LOCALES.en.default as Record<string, string | Plural>;

/** The `{name}` tokens a string fills in - a translation has to keep each
 *  one (or the value never shows) and may not invent any. */
function tokens(text: string): string[] {
  return [...text.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]).sort();
}

describe("the languages", () => {
  it("are registered everywhere they are listed", () => {
    expect(Object.keys(LOCALES).sort()).toEqual([...LANGS].sort());
    expect(Object.keys(LANG_NAMES).sort()).toEqual([...LANGS].sort());
    // The boot script sets <html lang> before React does, from its own copy
    // of localeOf().
    const boot = readFileSync("src-tauri/src/boot.js", "utf8");
    for (const lang of LANGS)
      expect(boot).toMatch(new RegExp(`"?${lang}"?: "${localeOf(lang)}",`));
  });

  it("are all fully translated, so none ships half in English", () => {
    const complete = LANGS.filter((lang) => LOCALES[lang].complete);
    expect(complete.sort()).toEqual(
      ["de", "en", "es", "fr", "ja", "ko", "pt", "ru", "zh", "zh-Hant"].sort(),
    );
  });

  it("fall back to English for an unknown code - a newer build's", () => {
    expect(resolveStrings("xx" as never)).toBe(resolveStrings("en"));
  });
});

describe.each(LANGS.filter((lang) => lang !== "en"))("%s", (lang) => {
  const { default: translation, complete } = LOCALES[lang];
  const entries = Object.entries(translation) as [
    string,
    string | Plural | undefined,
  ][];

  it("translates only keys English has, each the same kind", () => {
    for (const [key, value] of entries) {
      expect(english, `${key} is not an English key`).toHaveProperty(key);
      expect(typeof value, key).toBe(typeof english[key]);
    }
  });

  it("leaves no string empty", () => {
    for (const [key, value] of entries) {
      const forms =
        typeof value === "string" ? [value] : Object.values(value ?? {});
      for (const form of forms) expect(form?.trim(), key).toBeTruthy();
    }
  });

  it("keeps every {placeholder}, and invents none", () => {
    for (const [key, value] of entries) {
      const source = english[key];
      const expected = tokens(
        typeof source === "string" ? source : source.other,
      );
      const forms =
        typeof value === "string" ? [value] : Object.values(value ?? {});
      for (const form of forms)
        expect(tokens(form ?? ""), key).toEqual(expected);
    }
  });

  it("gives a count every plural form the language has, and no other", () => {
    const categories = pluralCategories(lang).sort();
    for (const [key, value] of entries) {
      if (typeof value === "string" || !value) continue;
      expect(Object.keys(value).sort(), key).toEqual(categories);
    }
  });

  if (complete)
    it("translates every key (its file says it is complete)", () => {
      const missing = (Object.keys(english) as StringKey[]).filter(
        (key) => !(key in translation),
      );
      expect(missing).toEqual([]);
    });
});

// The tutorial's practice exercises are scripted per language: the app
// grades what the learner types against these strings, so they have to fit
// together the way useTutorialDocumentEvaluation and tutorial-mock-agent
// read them. Checked on the resolved strings - what the learner sees.
describe.each(LANGS)("the tutorial exercises in %s", (lang) => {
  const t = resolveStrings(lang);

  it("completion: the suggestion continues the sentence typed", () => {
    const target = t.tutorialCompletionTarget;
    expect(target.trim()).toBe(target);
    expect(t.tutorialCompletionSuggestion.trim()).toBeTruthy();
    // Typing the sentence must not already count as accepting.
    expect(target).not.toContain(t.tutorialCompletionSuggestion);
  });

  it("grammar: the mistake is in the sentence, once, and the fix differs", () => {
    const target = t.tutorialGrammarTarget;
    const original = t.tutorialGrammarOriginal;
    expect(target.trim()).toBe(target);
    expect(target.split(original).length - 1).toBe(1);
    expect(t.tutorialGrammarSuggestion).not.toBe(original);
    const corrected = target.replace(original, t.tutorialGrammarSuggestion);
    // Typing the sentence must not already count as the fix.
    expect(target).not.toContain(corrected);
  });

  it("edit: the prompt is recognised, the revision is shorter and new", () => {
    const target = t.tutorialAgentEditTarget;
    const suggestion = t.tutorialAgentEditSuggestion;
    expect(target.trim()).toBe(target);
    expect([...suggestion].length).toBeLessThan([...target].length);
    // Typing the sentence must not already count as the applied edit.
    expect(target).not.toContain(suggestion);
    // The mock agent matches the prompt with punctuation and spacing
    // stripped: something must be left, and the chat lesson's question
    // must not match it.
    const prompt = normalize(t.tutorialAgentEditPrompt);
    expect(prompt).toBeTruthy();
    expect(normalize(t.tutorialAgentChatPrompt)).not.toContain(prompt);
  });
});
