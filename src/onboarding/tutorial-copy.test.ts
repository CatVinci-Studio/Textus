import { describe, expect, it } from "vitest";
import { LANGS, resolveStrings } from "../i18n/strings";
import { BUILTIN_SKILLS } from "../ai/skills/builtin";
import {
  pickerSkills,
  resolveSkillName,
  SKILL_COMMAND,
} from "../ai/chat/skill-picker";
import type { SkillListItem } from "../platform/ipc";
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

  it("names built-in skills that a typed /word really runs", () => {
    const items = BUILTIN_SKILLS.map(
      (skill) =>
        ({
          ...skill,
          description: "",
          source: "builtin",
          overridesBuiltin: false,
          enabled: true,
        }) as unknown as SkillListItem,
    );
    const available = pickerSkills(items, lang);
    const words = [...t.tutorialSkillsTask.matchAll(/`([^`]+)`/g)].map(
      (m) => m[1],
    );
    expect(words).toHaveLength(2);
    const names = words.map((word) => {
      const token = SKILL_COMMAND.exec(word)?.[1] ?? "";
      return resolveSkillName(token, available);
    });
    expect(names).toEqual(["tighten", "translate"]);
  });

  it("finds the sidebar through the View menu's own labels", () => {
    const outline = t.outlineTab.toLowerCase();
    const sidebar = t.menuToggleSidebar.toLowerCase();
    for (const text of [t.tutorialSidebarTask, t.tutorialSidebarTaskMac]) {
      expect(text.toLowerCase()).toContain(outline);
      expect(text).toContain(`${t.menuView} › ${t.menuToggleSidebar}`);
    }
    expect(t.tutorialSidebarTaskPhone.toLowerCase()).toContain(outline);
    expect(t.tutorialSidebarTaskPhone.toLowerCase()).toContain(sidebar);
  });

  it("names the buttons the learner clicks as the app does", () => {
    expect(t.tutorialWriteSend).toContain(t.proposalAccept);
    expect(t.tutorialRevisionSend).toContain(t.proposalAccept);
    expect(t.tutorialRevisionSend).toContain(t.proposalReject);
    expect(t.tutorialGrammarApply).toContain(t.grammarApply);
    expect(t.tutorialGrammarApplyPhone).toContain(t.grammarApply);
    expect(t.tutorialDoneMemory).toContain(t.agentTabMemory);
  });

  it("has the learner type the practice notes' title and slip", () => {
    expect(t.tutorialWysiwygHeading).toContain("`# {title}`");
    expect(t.tutorialGrammarType).toContain("`{slip}`");
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
