import { describe, expect, it } from "vitest";
import {
  evaluateWysiwyg,
  isLessonComplete,
  isTaskDone,
  LESSON_DONE,
  WRITE_PART,
  WYSIWYG_PART,
} from "./tutorial-evaluation";
import {
  stepIndexOf,
  TUTORIAL_STEPS,
  type TutorialStepId,
} from "./tutorial-steps";

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

describe("isLessonComplete", () => {
  it("wants every part of a lesson with parts", () => {
    expect(isLessonComplete(step("wysiwyg"), WYSIWYG_PART.heading)).toBe(false);
    expect(isLessonComplete(step("wysiwyg"), 15)).toBe(true);
    expect(isLessonComplete(step("write"), WRITE_PART.panel)).toBe(false);
    expect(
      isLessonComplete(step("write"), WRITE_PART.panel | LESSON_DONE),
    ).toBe(true);
  });

  it("never gates the opening, connecting, the end or the optional lessons", () => {
    for (const id of [
      "welcome",
      "connect",
      "done",
      "palette",
      "plugins",
    ] as const)
      expect(isLessonComplete(step(id), 0)).toBe(true);
  });

  it("gates every other lesson until it is done", () => {
    for (const id of ["continuation"] as const) {
      expect(isLessonComplete(step(id), 0)).toBe(false);
      expect(isLessonComplete(step(id), LESSON_DONE)).toBe(true);
    }
  });

  it("ticks a line on its own part, or with the lesson", () => {
    expect(
      isTaskDone(step("wysiwyg"), WYSIWYG_PART.list, WYSIWYG_PART.list),
    ).toBe(true);
    expect(
      isTaskDone(step("wysiwyg"), WYSIWYG_PART.task, WYSIWYG_PART.list),
    ).toBe(false);
    expect(isTaskDone(step("continuation"), undefined, LESSON_DONE)).toBe(true);
  });
});
