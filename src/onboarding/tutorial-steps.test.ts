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
  it("follows the website: four on writing, connecting, then the AI", () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      "welcome",
      "wysiwyg",
      "blocks",
      "modes-themes",
      "sidebar-export",
      "connect",
      "ai-panel",
      "continuation",
      "grammar",
      "revision",
      "review",
      "skills",
      "memory",
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
      "ai-panel": "ai",
      memory: "ai",
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

  it("gives every lesson a task and an animation; the AI ones are AI", () => {
    for (const step of TUTORIAL_STEPS) {
      const lesson = step.layout === "card";
      expect(!!step.clip, step.id).toBe(lesson);
      expect(step.clip ?? step.id, step.id).toBe(step.id);
      expect(!!step.ai, step.id).toBe(step.chapter === "ai");
      if (lesson) expect(step.taskKey, step.id).toBeTruthy();
    }
  });

  it("links to the clips Rust lets it open, and only those", () => {
    // src-tauri/src/commands/links.rs builds the URL from its own list.
    const rust = readFileSync("src-tauri/src/commands/links.rs", "utf8");
    const list = /const TUTORIAL_CLIPS: &\[&str\] = &\[([^\]]*)\]/.exec(rust);
    const clips = [...(list?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(clips).toEqual([...TUTORIAL_CLIPS]);
    expect(TUTORIAL_CLIPS).toEqual([
      "wysiwyg",
      "blocks",
      "modes-themes",
      "sidebar-export",
      "ai-panel",
      "continuation",
      "grammar",
      "revision",
      "review",
      "skills",
      "memory",
    ]);
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
    expect(resolveSavedProgress({ stepId: "blocks" })).toEqual({
      stepIndex: stepIndexOf("blocks"),
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

  it.each([
    ["welcome", "welcome"],
    ["markdownIntro", "wysiwyg"],
    ["markdownPractice", "wysiwyg"],
    ["sidebar", "sidebar-export"],
    ["aiIntro", "connect"],
    ["completion", "connect"],
    // A step of both tours: the old one's had no mode to resume in.
    ["grammar", "connect"],
    ["agentChat", "connect"],
    ["agentEdit", "connect"],
    ["connectAi", "connect"],
    ["done", "done"],
  ])("takes the previous tour's %s to %s", (old, now) => {
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
