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

// The tour's copy as the learner reads it, in every language.
describe.each(LANGS)("the tour in %s", (lang) => {
  const t = resolveStrings(lang);

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

  it("calls the sidebar's outline by its tab's own name", () => {
    const tab = t.outlineTab.toLowerCase();
    expect(t.tutorialSidebarTask.toLowerCase()).toContain(tab);
    expect(t.tutorialSidebarTaskPhone.toLowerCase()).toContain(tab);
  });

  it("keeps each lesson to one sentence and one task", () => {
    for (const step of TUTORIAL_STEPS) {
      const body = t[step.bodyKey];
      // One sentence: no break, and no full stop before its last one.
      expect(body, step.id).not.toContain("\n");
      expect(body.replace(/[.。！!]\s*$/, ""), step.id).not.toMatch(
        /\.(\s|$)|[。！？]/,
      );
      if (step.taskKey) expect(t[step.taskKey], step.id).not.toContain("\n");
    }
  });
});
