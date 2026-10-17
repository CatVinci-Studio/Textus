import { describe, expect, it } from "vitest";
import { LANGS } from "../i18n/strings";
import { evaluateWysiwyg } from "./tutorial-evaluation";
import { practiceDiary, withPracticeDiary } from "./practice-diary";

describe("the practice diary", () => {
  it("is written in English and Chinese, English for the rest", () => {
    expect(practiceDiary("en").title).toBe("Three days in Kyoto");
    expect(practiceDiary("zh").title).toBe("京都三日");
    for (const lang of LANGS)
      if (lang !== "zh") expect(practiceDiary(lang)).toBe(practiceDiary("en"));
  });

  it.each(["en", "zh"] as const)(
    "in %s, has its slip once and an outline",
    (lang) => {
      const diary = practiceDiary(lang);
      expect(diary.body.split(diary.slip)).toHaveLength(2);
      expect(diary.body.match(/^## /gm)).toHaveLength(3);
      // Nothing the writing lessons ask the learner to add.
      expect(evaluateWysiwyg(diary.body)).toBe(0);
    },
  );

  it("goes under what the learner wrote, with its title only if empty", () => {
    const diary = practiceDiary("en");
    const mine = "# My trip\n\n- Passport\n";
    expect(withPracticeDiary(mine, diary)).toBe(
      `# My trip\n\n- Passport\n\n${diary.body}`,
    );
    expect(withPracticeDiary("  \n", diary)).toBe(
      `# Three days in Kyoto\n\n${diary.body}`,
    );
  });

  it("is never added twice, whatever language it went in as", () => {
    const en = withPracticeDiary("", practiceDiary("en"));
    expect(withPracticeDiary(en, practiceDiary("en"))).toBe(en);
    expect(withPracticeDiary(en, practiceDiary("zh"))).toBe(en);
    const zh = withPracticeDiary("", practiceDiary("zh"));
    expect(withPracticeDiary(zh, practiceDiary("en"))).toBe(zh);
  });
});
