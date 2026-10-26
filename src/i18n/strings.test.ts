import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pluralCategories } from "./plural";
import {
  LANGS,
  LANG_NAMES,
  loadLocale,
  localeLoaded,
  localeOf,
  resolveStrings,
  type Lang,
  type Plural,
  type StringKey,
  type Translation,
} from "./strings";

// Every language's file against English: what a translation may and must
// contain.

/** The files as written, read here at once (the app loads them lazily). */
const LOCALES = Object.fromEntries(
  Object.entries(
    import.meta.glob<{ default: Translation; complete?: boolean }>(
      "./locales/*.ts",
      { eager: true },
    ),
  ).map(([path, file]) => [
    path.slice("./locales/".length, -".ts".length),
    {
      default: file.default,
      complete: file.complete ?? path.endsWith("/en.ts"),
    },
  ]),
) as Record<Lang, { default: Translation; complete: boolean }>;

const english = LOCALES.en.default as Record<string, string | Plural>;

/** The `{name}` tokens a string fills in; a translation must keep each one
 *  and may not invent any. */
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

  it("load on first use, each in its own chunk", async () => {
    expect(localeLoaded("en")).toBe(true);
    await loadLocale("ko");
    expect(localeLoaded("ko")).toBe(true);
    expect(resolveStrings("ko").textusAiClosePanel).toBe(
      LOCALES.ko.default.textusAiClosePanel,
    );
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
