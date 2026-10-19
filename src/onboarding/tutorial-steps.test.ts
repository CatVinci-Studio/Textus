import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveSavedProgress,
  stepIndexOf,
  TUTORIAL_CHAPTERS,
  TUTORIAL_CLIPS,
  TUTORIAL_STEPS,
} from "./tutorial-steps";

describe("the tour", () => {
  it("writes, connects, then follows the AI from Write to the skills", () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      "welcome",
      "wysiwyg",
      "marks",
      "table",
      "blocks",
      "modes-themes",
      "sidebar-export",
      "connect",
      "write",
      "review",
      "revision",
      "grammar",
      "continuation",
      "skills",
      "done",
    ]);
  });

  it("groups its steps into five chapters, in order", () => {
    expect(TUTORIAL_CHAPTERS.map((chapter) => chapter.id)).toEqual([
      "start",
      "writing",
      "connect",
      "ai",
      "done",
    ]);
    const chapterOf = Object.fromEntries(
      TUTORIAL_STEPS.map((step) => [step.id, step.chapter]),
    );
    expect(chapterOf).toMatchObject({
      welcome: "start",
      wysiwyg: "writing",
      "sidebar-export": "writing",
      connect: "connect",
      write: "ai",
      skills: "ai",
      done: "done",
    });
    // A chapter's steps are next to each other.
    const order = TUTORIAL_STEPS.map((step) => step.chapter);
    expect(order.filter((c, i) => c !== order[i - 1])).toEqual(
      TUTORIAL_CHAPTERS.map((chapter) => chapter.id),
    );
  });

  it("dims the window only to open, to connect and to end", () => {
    expect(
      TUTORIAL_STEPS.filter((step) => step.layout === "overlay").map(
        (step) => step.id,
      ),
    ).toEqual(["welcome", "connect", "done"]);
  });

  it("gives every lesson things to do and an animation; the AI ones are AI", () => {
    for (const step of TUTORIAL_STEPS) {
      const lesson = step.layout === "card";
      expect(!!step.clip, step.id).toBe(lesson);
      expect(!!step.ai, step.id).toBe(step.chapter === "ai");
      if (lesson) expect(step.tasks?.length, step.id).toBeGreaterThan(0);
    }
  });

  it("sets the AI panel's mode for the lessons that need one", () => {
    const modes = Object.fromEntries(
      TUTORIAL_STEPS.filter((step) => step.agentMode).map((step) => [
        step.id,
        step.agentMode,
      ]),
    );
    expect(modes).toEqual({
      write: "write",
      review: "review",
      revision: "revise",
      skills: "revise",
    });
  });

  it("locks every lesson until it is done, except formulas and diagrams", () => {
    expect(
      TUTORIAL_STEPS.filter((step) => step.optional).map((step) => step.id),
    ).toEqual(["blocks"]);
  });

  it("links to the clips Rust lets it open, and only those", () => {
    // src-tauri/src/commands/links.rs builds the URL from its own list.
    const rust = readFileSync("src-tauri/src/commands/links.rs", "utf8");
    const list = /const TUTORIAL_CLIPS: &\[&str\] = &\[([^\]]*)\]/.exec(rust);
    const clips = [...(list?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(clips).toEqual([...TUTORIAL_CLIPS]);
    for (const step of TUTORIAL_STEPS)
      if (step.clip) expect(TUTORIAL_CLIPS, step.id).toContain(step.clip);
  });
});

describe("resuming saved progress", () => {
  it("resumes this tour's step with its AI mode", () => {
    expect(
      resolveSavedProgress({ stepId: "grammar", stepIndex: 1, aiMode: "live" }),
    ).toEqual({ stepIndex: stepIndexOf("grammar"), aiMode: "live" });
    expect(resolveSavedProgress({ stepId: "skills", aiMode: "watch" })).toEqual(
      { stepIndex: stepIndexOf("skills"), aiMode: "watch" },
    );
    expect(resolveSavedProgress({ stepId: "marks" })).toEqual({
      stepIndex: stepIndexOf("marks"),
      aiMode: null,
    });
  });

  it("asks about connecting again when an AI lesson has no mode saved", () => {
    for (const aiMode of [undefined, null, "mock", 1])
      expect(resolveSavedProgress({ stepId: "review", aiMode })).toEqual({
        stepIndex: stepIndexOf("connect"),
        aiMode: null,
      });
  });

  it("takes the second tour's AI panel lesson to AI writing, its memory one to the end", () => {
    expect(
      resolveSavedProgress({ stepId: "ai-panel", aiMode: "live" }),
    ).toEqual({ stepIndex: stepIndexOf("write"), aiMode: "live" });
    expect(resolveSavedProgress({ stepId: "memory", aiMode: "watch" })).toEqual(
      { stepIndex: stepIndexOf("done"), aiMode: "watch" },
    );
  });

  it.each([
    ["welcome", "welcome"],
    ["markdownIntro", "wysiwyg"],
    ["markdownPractice", "wysiwyg"],
    ["sidebar", "sidebar-export"],
    ["aiIntro", "connect"],
    ["completion", "connect"],
    // A step of every tour: the first one's had no mode to resume in.
    ["grammar", "connect"],
    ["agentChat", "connect"],
    ["agentEdit", "connect"],
    ["connectAi", "connect"],
    ["done", "done"],
  ])("takes the first tour's %s to %s", (old, now) => {
    expect(resolveSavedProgress({ stepId: old })).toEqual({
      stepIndex: stepIndexOf(now as never),
      aiMode: null,
    });
  });

  it("reads the first tour's index-only progress against its own list", () => {
    // 0 welcome, 2 markdownPractice, 3 sidebar, 6 grammar, 9 done.
    const at = (stepIndex: number) =>
      TUTORIAL_STEPS[resolveSavedProgress({ stepIndex }).stepIndex].id;
    expect(at(0)).toBe("welcome");
    expect(at(2)).toBe("wysiwyg");
    expect(at(3)).toBe("sidebar-export");
    expect(at(6)).toBe("connect");
    expect(at(9)).toBe("done");
  });

  it.each([2.5, -1, 999, "invalid", null, undefined])(
    "lands a malformed index %s on a real step",
    (stepIndex) => {
      const { stepIndex: index } = resolveSavedProgress({ stepIndex });
      expect(TUTORIAL_STEPS[index]).toBeDefined();
    },
  );

  it("falls back to the index when the saved id is unknown", () => {
    expect(
      resolveSavedProgress({ stepId: "gone", stepIndex: 9 }).stepIndex,
    ).toBe(stepIndexOf("done"));
  });
});
