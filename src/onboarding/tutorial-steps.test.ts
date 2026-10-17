import { describe, expect, it } from "vitest";
import {
  resolveSavedStepIndex,
  TUTORIAL_SECTIONS,
  TUTORIAL_STEPS,
} from "./tutorial-steps";

describe("newcomer guide structure", () => {
  it("has the three course sections in order", () => {
    expect(TUTORIAL_SECTIONS.map((section) => section.id)).toEqual([
      "markdown",
      "workspace",
      "ai",
    ]);
    expect(
      new Set(
        TUTORIAL_STEPS.flatMap((step) => (step.section ? [step.section] : [])),
      ),
    ).toEqual(new Set(["markdown", "workspace", "ai"]));
  });

  it("uses full modals only for the opening, chapter transitions, and ending", () => {
    expect(
      TUTORIAL_STEPS.filter((step) => step.layout === "overlay").map(
        (step) => step.id,
      ),
    ).toEqual(["welcome", "markdownIntro", "aiIntro", "connectAi", "done"]);
    expect(
      TUTORIAL_STEPS.filter((step) => step.layout === "card").map(
        (step) => step.id,
      ),
    ).toEqual([
      "markdownPractice",
      "sidebar",
      "completion",
      "grammar",
      "agentChat",
      "agentEdit",
    ]);
  });
});

describe("connecting a real AI", () => {
  it("closes the AI chapter, right before the ending", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(ids.slice(-3)).toEqual(["agentEdit", "connectAi", "done"]);
    expect(TUTORIAL_STEPS.find((s) => s.id === "connectAi")?.section).toBe(
      "ai",
    );
  });
});

describe("resuming saved progress", () => {
  const indexOf = (id: string) => TUTORIAL_STEPS.findIndex((s) => s.id === id);

  it("resumes at the saved step id, wherever that step now sits", () => {
    expect(resolveSavedStepIndex({ stepId: "connectAi", stepIndex: 2 })).toBe(
      indexOf("connectAi"),
    );
    expect(resolveSavedStepIndex({ stepId: "done", stepIndex: 0 })).toBe(
      indexOf("done"),
    );
  });

  it("reads an index saved before connectAi existed against the old list", () => {
    // Old builds saved only stepIndex; 9 was "done", 8 "agentEdit".
    expect(resolveSavedStepIndex({ stepIndex: 9 })).toBe(indexOf("done"));
    expect(resolveSavedStepIndex({ stepIndex: 8 })).toBe(indexOf("agentEdit"));
    expect(resolveSavedStepIndex({ stepIndex: 3 })).toBe(indexOf("sidebar"));
  });

  it.each([2.5, -1, 999, "invalid", null, undefined])(
    "lands a malformed index %s on a real step",
    (stepIndex) => {
      const index = resolveSavedStepIndex({ stepIndex });
      expect(TUTORIAL_STEPS[index]).toBeDefined();
    },
  );

  it("falls back to the index when the saved id is unknown", () => {
    expect(resolveSavedStepIndex({ stepId: "gone", stepIndex: 9 })).toBe(
      indexOf("done"),
    );
  });
});
