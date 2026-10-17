import { describe, expect, it } from "vitest";
import { TUTORIAL_SECTIONS, TUTORIAL_STEPS } from "./tutorial-steps";

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
    ).toEqual(["welcome", "markdownIntro", "aiIntro", "done"]);
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
