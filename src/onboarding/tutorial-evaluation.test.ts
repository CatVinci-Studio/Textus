import { describe, expect, it } from "vitest";
import {
  evaluateMarks,
  evaluateTable,
  evaluateWysiwyg,
  GRAMMAR_PART,
  hasFormulaOrDiagram,
  hasSentence,
  isLessonComplete,
  isTaskDone,
  LESSON_DONE,
  MARKS_PART,
  MODES_PART,
  TABLE_PART,
  WRITE_PART,
  WYSIWYG_PART,
} from "./tutorial-evaluation";
import { practiceNotes, withPracticeNotes } from "./practice-notes";
import {
  stepIndexOf,
  TUTORIAL_STEPS,
  type TutorialStepId,
} from "./tutorial-steps";
import { LANGS } from "../i18n/strings";

const step = (id: TutorialStepId) => TUTORIAL_STEPS[stepIndexOf(id)];

describe("the WYSIWYG lesson", () => {
  it("sees a heading, a list, a numbered list and a task, each on its own", () => {
    expect(evaluateWysiwyg("# Notes on Hamlet")).toBe(WYSIWYG_PART.heading);
    expect(evaluateWysiwyg("- Hamlet\n- Horatio")).toBe(WYSIWYG_PART.list);
    expect(evaluateWysiwyg("1. Act I")).toBe(WYSIWYG_PART.numbered);
    expect(evaluateWysiwyg("- [ ] Finish Act V")).toBe(WYSIWYG_PART.task);
    expect(
      evaluateWysiwyg(
        "# 《红楼梦》读书笔记\n\n- 林黛玉\n- 贾宝玉\n\n1. 第三回\n\n- [ ] 读完第五回\n",
      ),
    ).toBe(15);
  });

  it("wants a level-one heading with text, and items with text", () => {
    expect(evaluateWysiwyg("#\n## Act I\n-\n1.\n")).toBe(0);
  });
});

describe("the marks lesson", () => {
  const notes = practiceNotes("en");
  const doc = withPracticeNotes("# Notes on Hamlet\n", notes);

  it("finds nothing in the notes as the tour wrote them, quote and all", () => {
    for (const lang of LANGS) {
      const own = practiceNotes(lang);
      expect(evaluateMarks(withPracticeNotes("", own), own.body), lang).toBe(0);
    }
  });

  it("sees each line the learner adds", () => {
    const typed = (line: string) =>
      evaluateMarks(`${doc}\n${line}\n`, notes.body);
    expect(typed("Horatio is **loyal** and *calm*.")).toBe(MARKS_PART.emphasis);
    expect(typed("> Something is rotten in the state of Denmark.")).toBe(
      MARKS_PART.quote,
    );
    expect(typed("Read `Act I` again.")).toBe(MARKS_PART.code);
    expect(typed("[Gutenberg](https://gutenberg.org)")).toBe(MARKS_PART.link);
  });

  it("wants both bold and italic for the first line", () => {
    expect(evaluateMarks(`${doc}\nOnly **bold**.\n`, notes.body)).toBe(0);
    expect(evaluateMarks(`${doc}\nOnly *italic*.\n`, notes.body)).toBe(0);
  });
});

describe("the table lesson", () => {
  it("sees a table, then a row filled in", () => {
    const header = "| Character | Impression |\n| --------- | ---------- |\n";
    expect(evaluateTable(`${header}|  |  |\n`)).toBe(TABLE_PART.table);
    expect(evaluateTable(`${header}| Hamlet | Torn |\n`)).toBe(
      TABLE_PART.table | TABLE_PART.row,
    );
    expect(evaluateTable("| a | b |\n")).toBe(0);
  });

  it("finds none in the notes themselves", () => {
    for (const lang of LANGS)
      expect(
        evaluateTable(withPracticeNotes("", practiceNotes(lang))),
        lang,
      ).toBe(0);
  });
});

describe("the formulas and diagrams lesson", () => {
  it("takes a formula or a diagram, and the notes have neither", () => {
    expect(hasFormulaOrDiagram("Energy: $E=mc^2$")).toBe(true);
    expect(hasFormulaOrDiagram("```mermaid\ngraph LR; A-->B\n```")).toBe(true);
    for (const lang of LANGS)
      expect(
        hasFormulaOrDiagram(withPracticeNotes("", practiceNotes(lang))),
      ).toBe(false);
  });
});

describe("the grammar lesson's sentence", () => {
  it("is found however the editor spaced it, and not before it is whole", () => {
    const { slip } = practiceNotes("en");
    expect(hasSentence(`notes\n\n${slip}\n`, slip)).toBe(true);
    expect(hasSentence(`notes\n\n${slip.slice(0, -5)}\n`, slip)).toBe(false);
    expect(
      hasSentence("宝玉说这话时笑的 很开心。", "宝玉说这话时笑的很开心。"),
    ).toBe(true);
  });
});

describe("isLessonComplete", () => {
  it("wants every part of a lesson with parts", () => {
    expect(isLessonComplete(step("wysiwyg"), WYSIWYG_PART.heading)).toBe(false);
    expect(isLessonComplete(step("wysiwyg"), 15)).toBe(true);
    expect(isLessonComplete(step("modes-themes"), MODES_PART.theme)).toBe(
      false,
    );
    expect(isLessonComplete(step("modes-themes"), 3)).toBe(true);
    expect(isLessonComplete(step("write"), WRITE_PART.panel)).toBe(false);
    expect(
      isLessonComplete(step("write"), WRITE_PART.panel | LESSON_DONE),
    ).toBe(true);
  });

  it("never gates the opening, connecting, the end or the optional lesson", () => {
    for (const id of ["welcome", "connect", "done", "blocks"] as const)
      expect(isLessonComplete(step(id), 0)).toBe(true);
  });

  it("lets the grammar lesson go when the card opened or the AI was quiet", () => {
    const grammar = step("grammar");
    expect(isLessonComplete(grammar, GRAMMAR_PART.typed)).toBe(false);
    expect(
      isLessonComplete(grammar, GRAMMAR_PART.typed | GRAMMAR_PART.card),
    ).toBe(true);
    expect(
      isLessonComplete(grammar, GRAMMAR_PART.typed | GRAMMAR_PART.quiet),
    ).toBe(true);
  });

  it("gates every other lesson until it is done", () => {
    for (const id of [
      "review",
      "revision",
      "continuation",
      "skills",
    ] as const) {
      expect(isLessonComplete(step(id), 0)).toBe(false);
      expect(isLessonComplete(step(id), LESSON_DONE)).toBe(true);
    }
  });

  it("ticks a line on its own part, or with the lesson", () => {
    expect(isTaskDone(step("table"), TABLE_PART.table, TABLE_PART.table)).toBe(
      true,
    );
    expect(isTaskDone(step("table"), TABLE_PART.row, TABLE_PART.table)).toBe(
      false,
    );
    expect(isTaskDone(step("revision"), undefined, LESSON_DONE)).toBe(true);
  });
});
