import { describe, expect, it } from "vitest";
import {
  evaluateWysiwyg,
  hasBlock,
  isLessonComplete,
  MODES_PART,
  WYSIWYG_PART,
} from "./tutorial-evaluation";
import { practiceDiary, withPracticeDiary } from "./practice-diary";
import { LANGS } from "../i18n/strings";

describe("the WYSIWYG lesson", () => {
  it("sees a level-one heading and a list, each on its own", () => {
    expect(evaluateWysiwyg("# Three days in Kyoto")).toBe(WYSIWYG_PART.heading);
    expect(evaluateWysiwyg("- Passport")).toBe(WYSIWYG_PART.list);
    expect(evaluateWysiwyg("1. Passport")).toBe(WYSIWYG_PART.list);
    expect(evaluateWysiwyg("* [ ] Passport")).toBe(WYSIWYG_PART.list);
    expect(evaluateWysiwyg("# 京都三日\n\n- 护照\n- 相机")).toBe(3);
  });

  it("wants a heading with text, and a level-one one", () => {
    expect(evaluateWysiwyg("#\n## Day one\n-\n")).toBe(0);
  });
});

describe("the blocks lesson", () => {
  it("takes a table, a formula or a diagram", () => {
    expect(hasBlock("| Day | Where |\n| --- | --- |\n| 1 | Inari |")).toBe(
      true,
    );
    expect(hasBlock("| Day | Where |\n|:-|-:|")).toBe(true);
    expect(hasBlock("Cost: $E=mc^2$")).toBe(true);
    expect(hasBlock("```mermaid\ngraph LR\n```")).toBe(true);
  });

  it("finds none in the diary itself", () => {
    for (const lang of LANGS) {
      const diary = practiceDiary(lang);
      expect(hasBlock(withPracticeDiary("", diary)), lang).toBe(false);
    }
  });
});

describe("isLessonComplete", () => {
  it("wants both parts of a two-part lesson", () => {
    expect(isLessonComplete("wysiwyg", WYSIWYG_PART.heading)).toBe(false);
    expect(isLessonComplete("wysiwyg", 3)).toBe(true);
    expect(isLessonComplete("modes-themes", MODES_PART.theme)).toBe(false);
    expect(isLessonComplete("modes-themes", 3)).toBe(true);
  });

  it("never gates the opening, connecting or the end", () => {
    for (const id of ["welcome", "connect", "done"] as const)
      expect(isLessonComplete(id, 0)).toBe(true);
  });

  it("gates every other lesson until it is done", () => {
    for (const id of ["blocks", "ai-panel", "grammar", "memory"] as const) {
      expect(isLessonComplete(id, 0)).toBe(false);
      expect(isLessonComplete(id, 1)).toBe(true);
    }
  });
});
