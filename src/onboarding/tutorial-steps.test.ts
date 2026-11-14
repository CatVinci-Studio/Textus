import { describe, expect, it } from "vitest";
import { resolveStrings } from "../i18n/strings";
import {
  resolveSavedStep,
  stepIndexOf,
  TUTORIAL_STEPS,
} from "./tutorial-steps";

describe("the tour", () => {
  it("walks the window from the sidebar to the AI, then ends", () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      "welcome",
      "sidebar",
      "rail",
      "settings",
      "editor",
      "ai",
      "signin",
      "ai-use",
      "done",
    ]);
  });

  it("opens and ends on a card in the middle, lighting a part in between", () => {
    for (const step of TUTORIAL_STEPS) {
      const centred = step.id === "welcome" || step.id === "done";
      expect(!step.target && !step.stops, step.id).toBe(centred);
    }
  });

  it("uses the AI only once one is signed in, in write mode", () => {
    const use = TUTORIAL_STEPS[stepIndexOf("ai-use")];
    expect(use).toMatchObject({ ai: true, live: true, agentMode: "write" });
    expect(TUTORIAL_STEPS.filter((step) => step.live)).toEqual([use]);
  });

  it("has copy for every step and stop", () => {
    const t = resolveStrings("en");
    for (const step of TUTORIAL_STEPS) {
      const keys = [step.titleKey, step.bodyKey, step.phoneBodyKey];
      for (const key of [...keys, ...(step.stops ?? []).map((s) => s.key)])
        if (key) expect(t[key], key).toBeTruthy();
    }
  });
});

describe("resuming saved progress", () => {
  it("resumes a step by its id, and starts over for one unknown", () => {
    expect(resolveSavedStep({ stepId: "editor" })).toBe(stepIndexOf("editor"));
    expect(resolveSavedStep({ stepId: "wysiwyg" })).toBe(0);
    expect(resolveSavedStep({})).toBe(0);
  });
});
