import { describe, expect, it } from "vitest";
import { LANGS, resolveStrings } from "../i18n/strings";
import { TUTORIAL_STEPS } from "./tutorial-steps";
import { withCode } from "./TutorialOverlay";

// The tour's copy as the learner reads it, in every language.
describe.each(LANGS)("the tour in %s", (lang) => {
  const t = resolveStrings(lang);
  const lines = TUTORIAL_STEPS.flatMap((step) =>
    (step.tasks ?? []).flatMap((task) =>
      [task.key, task.macKey, task.phoneKey].flatMap((key) =>
        key ? [{ step: step.id, key, text: t[key] }] : [],
      ),
    ),
  );

  it("names the buttons the learner clicks as the app does", () => {
    expect(t.tutorialWriteSend).toContain(t.proposalAccept);
    expect(t.tutorialDoneMemory).toContain(t.agentTabProject);
    expect(t.tutorialPluginsTask).toContain(t.navExtensions);
  });

  it("has the learner type the practice notes' title", () => {
    expect(t.tutorialWysiwygHeading).toContain("`# {title}`");
  });

  it("keeps each lesson to one sentence and one line per thing to do", () => {
    for (const step of TUTORIAL_STEPS) {
      const body = t[step.bodyKey];
      // One sentence: no break, and no full stop before its last one.
      expect(body, step.id).not.toContain("\n");
      expect(body.replace(/[.。！!]\s*$/, ""), step.id).not.toMatch(
        /\.(\s|$)|[。！？]/,
      );
    }
    for (const line of lines) {
      expect(line.text, line.key).not.toContain("\n");
      // Every code span closes: a stray backtick would show as text.
      const prose = withCode(line.text).filter(
        (part) => typeof part === "string",
      );
      expect(prose.join(""), line.key).not.toContain("`");
    }
  });
});
