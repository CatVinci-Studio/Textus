import { describe, expect, it } from "vitest";
import { LANGS, resolveStrings } from "../i18n/strings";
import { WRITING_CONVENTIONS } from "../platform/ipc";
import {
  CONVENTION_PROFILES,
  conventionsLanguageName,
  conventionsProfileName,
  isConventionsValue,
} from "./writing-conventions";

describe("writing conventions", () => {
  it("knows Automatic and every profile, and nothing else", () => {
    expect(isConventionsValue("automatic")).toBe(true);
    expect(isConventionsValue("zh-Hans-CN/fiction")).toBe(true);
    expect(isConventionsValue("en-GB/govuk")).toBe(true);
    expect(isConventionsValue("xx-YY")).toBe(false);
    const all = CONVENTION_PROFILES.flatMap((g) => g.profiles);
    expect(new Set(all).size).toBe(all.length);
  });

  it("offers exactly the profiles Rust accepts, each under its language", () => {
    const ours = CONVENTION_PROFILES.flatMap((g) => g.profiles).sort();
    const rust = Object.values(WRITING_CONVENTIONS)
      .flatMap((l) => l.profiles)
      .sort();
    expect(ours).toEqual(rust);
    const hant = CONVENTION_PROFILES.find((g) => g.language === "zh-Hant");
    expect(hant?.profiles).toContain("zh-Hant-CN");
  });

  it("names each profile by region and variant", () => {
    const en = resolveStrings("en");
    expect(conventionsProfileName(en, "en", "en-US/news")).toBe("US · News");
    expect(conventionsProfileName(en, "en", "en-GB/govuk")).toBe("UK · GOV.UK");
    expect(conventionsProfileName(en, "en", "en-US/tech-google")).toBe(
      "US · Technical · Google",
    );
    expect(conventionsProfileName(en, "en", "ko")).toBe("Standard");
    expect(conventionsProfileName(en, "en", "es/eu")).toBe("EU institutions");
    const zh = resolveStrings("zh");
    expect(conventionsProfileName(zh, "zh", "zh-Hans-CN/fiction")).toBe("小说");
    // Where a language's profiles differ in region, each says its own.
    expect(conventionsProfileName(en, "en", "zh-Hant-TW")).toBe("Taiwan");
    expect(conventionsLanguageName("zh", "zh-Hans")).toBe("简体中文");
    expect(conventionsLanguageName("en", "zh-Hant")).toBe(
      "Traditional Chinese",
    );
  });

  it("gives every profile a name in every UI language", () => {
    for (const lang of LANGS) {
      const t = resolveStrings(lang);
      for (const group of CONVENTION_PROFILES) {
        expect(conventionsLanguageName(lang, group.language)).toBeTruthy();
        for (const profile of group.profiles)
          expect(conventionsProfileName(t, lang, profile)).not.toMatch(/\//);
      }
    }
  });
});
