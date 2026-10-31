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
      "palette",
      "plugins",
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

  it("gives every lesson things to do and, but the palette and plugins tips, an animation; the AI ones are AI", () => {
    for (const step of TUTORIAL_STEPS) {
      const lesson = step.layout === "card";
      expect(!!step.clip, step.id).toBe(
        lesson && step.id !== "palette" && step.id !== "plugins",
      );
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
      revision: "write",
      skills: "review",
    });
  });

  it("locks every lesson until it is done, except formulas, diagrams, the palette and plugins", () => {
    expect(
      TUTORIAL_STEPS.filter((step) => step.optional).map((step) => step.id),
    ).toEqual(["blocks", "palette", "plugins"]);
  });

  it("links to the clips Rust lets it open, and only those", () => {
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
    expect(resolveSavedProgress({ stepId: "grammar", aiMode: "live" })).toEqual(
      { stepIndex: stepIndexOf("grammar"), aiMode: "live" },
    );
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

  it.each(["ai-panel", "markdownIntro", "gone", 3, null, undefined])(
    "starts the tour over for a step it doesn't have (%s)",
    (stepId) => {
      expect(resolveSavedProgress({ stepId, aiMode: "live" })).toEqual({
        stepIndex: stepIndexOf("welcome"),
        aiMode: "live",
      });
    },
  );
});
