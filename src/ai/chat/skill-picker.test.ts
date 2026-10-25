import { describe, expect, it } from "vitest";
import type { SkillListItem } from "../../platform/ipc";
import { LANGS } from "../../i18n/langs";
import { BUILTIN_SKILLS } from "../skills/builtin";
import { SKILL_TEXTS } from "../skills/texts";
import {
  MENTION_TRIGGER,
  SKILL_COMMAND,
  SKILL_TRIGGER,
  groupSkills,
  listFromWorkspace,
  matchSkills,
  pickerSkills,
  resolveSkillName,
} from "./skill-picker";

const builtins: SkillListItem[] = BUILTIN_SKILLS.map((skill) => ({
  name: skill.name,
  description: `Long model-facing description of ${skill.name}.`,
  category: skill.category,
  invocation: skill.invocation,
  source: "builtin",
  overridesBuiltin: false,
  enabled: true,
  aliases: {},
}));

const own: SkillListItem = {
  name: "house-style",
  description: "Apply the house style",
  category: "revise",
  invocation: "both",
  source: "global",
  overridesBuiltin: false,
  enabled: true,
  aliases: {},
};

const project: SkillListItem = {
  ...own,
  name: "会议纪要",
  description: "按公司模板整理纪要",
  source: "project",
};

describe("the triggers", () => {
  it("open on / and what CJK IMEs type for it", () => {
    for (const key of ["/", "／", "、", "・"]) {
      expect(SKILL_TRIGGER.exec(key)?.[1]).toBe("");
      expect(SKILL_TRIGGER.exec(`${key}续`)?.[1]).toBe("续");
    }
    expect(SKILL_TRIGGER.exec("/tighten ")).toBeNull();
    expect(SKILL_TRIGGER.exec("a/b")).toBeNull();
    // A 、 inside a sentence is punctuation, not a command.
    expect(SKILL_COMMAND.exec("我们、他们")).toBeNull();
  });

  it("open the file picker on @ and ＠ after a space or at the start", () => {
    expect(MENTION_TRIGGER.exec("@")?.[1]).toBe("");
    expect(MENTION_TRIGGER.exec("see ＠no")?.[1]).toBe("no");
    expect(MENTION_TRIGGER.exec("mail@host")).toBeNull();
  });
});

describe("pickerSkills", () => {
  it("leaves out turned-off built-ins and hidden packs", () => {
    const list = pickerSkills(
      [
        { ...builtins[0], enabled: false },
        ...builtins.slice(1),
        { ...own, name: "standards-en", invocation: "hidden" as never },
      ],
      "en",
    );
    expect(list.map((s) => s.name)).not.toContain("continue-story");
    expect(list.map((s) => s.name)).not.toContain("standards-en");
    expect(list).toHaveLength(19);
  });

  it("shows a built-in by its label and hint in the UI language", () => {
    const [first] = pickerSkills(builtins, "ja");
    expect(first).toMatchObject({
      name: "continue-story",
      label: "続きを書く",
      category: "write",
    });
    // A user skill keeps its own name and description.
    const [mine] = pickerSkills([own], "ja");
    expect(mine).toMatchObject({
      label: null,
      hint: "Apply the house style",
      category: null,
    });
  });

  it("adds the backend's aliases to the terms", () => {
    const [skill] = pickerSkills(
      [{ ...own, aliases: { en: ["house"], zh: ["文风手册"] } }],
      "zh",
    );
    expect(skill.terms).toEqual(
      expect.arrayContaining(["house-style", "house", "文风手册"]),
    );
  });
});

describe.each(LANGS)("the theme skill in %s", (lang) => {
  const skills = pickerSkills(builtins, lang);
  const text = SKILL_TEXTS[lang].theme;

  it("is in the / list under Formats, by its label", () => {
    const theme = skills.find((s) => s.name === "theme");
    expect(theme).toMatchObject({ label: text.label, category: "format" });
    const format = groupSkills(skills, []).find((g) => g.id === "format")!;
    expect(format.skills.map((s) => s.name)).toContain("theme");
  });

  it("answers to /theme, its label and its aliases", () => {
    for (const term of ["theme", text.label, ...text.aliases])
      expect(resolveSkillName(term, skills), term).toBe("theme");
  });
});

describe("matchSkills", () => {
  const skills = pickerSkills([...builtins, own], "zh");

  it("puts an exact alias first", () => {
    expect(matchSkills(skills, "校对", [])[0].name).toBe("proofread");
    expect(matchSkills(skills, "续写", [])[0].name).toBe("continue-story");
  });

  it("matches names, labels and full-width letters, case-blind", () => {
    expect(matchSkills(skills, "ＴＩＧ", [])[0].name).toBe("tighten");
    expect(matchSkills(skills, "Story", [])[0].name).toBe("continue-story");
    // A CJK label matches inside, not only at its start.
    expect(matchSkills(skills, "标题", []).map((s) => s.name)).toContain(
      "headline",
    );
  });

  it("finds another language's word too", () => {
    expect(matchSkills(skills, "続き", [])[0].name).toBe("continue-story");
  });

  it("breaks ties in favour of the recently used", () => {
    const names = matchSkills(skills, "c", ["continuity"]).map((s) => s.name);
    expect(names.indexOf("continuity")).toBeLessThan(
      names.indexOf("change-tone"),
    );
  });
});

describe("groupSkills", () => {
  const skills = pickerSkills([...builtins, own, project], "en");

  it("lists recent, project, yours, then the built-ins by category", () => {
    const groups = groupSkills(skills, ["summarize", "proofread"]);
    expect(groups.map((g) => g.id)).toEqual([
      "recent",
      "project",
      "global",
      "write",
      "revise",
      "check",
      "format",
    ]);
    expect(groups[0].skills.map((s) => s.name)).toEqual([
      "summarize",
      "proofread",
    ]);
    // Not listed twice.
    const check = groups.find((g) => g.id === "check")!;
    expect(check.skills.map((s) => s.name)).toEqual(["continuity"]);
  });

  it("leaves empty groups out", () => {
    expect(groupSkills(pickerSkills([own], "en"), []).map((g) => g.id)).toEqual(
      ["global"],
    );
  });
});

describe("resolveSkillName", () => {
  const skills = pickerSkills([...builtins, project], "en");

  it("maps an alias in any language to the canonical name", () => {
    expect(resolveSkillName("续写", skills)).toBe("continue-story");
    expect(resolveSkillName("公文", skills)).toBe("notice");
    expect(resolveSkillName("要약", skills)).toBeNull();
    expect(resolveSkillName("요약", skills)).toBe("summarize");
    expect(resolveSkillName("Proofread", skills)).toBe("proofread");
    expect(resolveSkillName("会议纪要", skills)).toBe("会议纪要");
    expect(resolveSkillName("usr/bin", skills)).toBeNull();
  });

  it("prefers a skill's own name over another skill's alias", () => {
    // A project skill named like a built-in alias wins.
    const withShadow = pickerSkills(
      [...builtins, { ...own, name: "续写" }],
      "en",
    );
    expect(resolveSkillName("续写", withShadow)).toBe("续写");
  });
});

describe("listFromWorkspace", () => {
  it("files built-ins under their category and the rest as the user's", () => {
    const list = listFromWorkspace([
      { name: "tighten", description: "", prompt: "Cut." },
      { name: "mine", description: "Mine", prompt: "Do." },
    ]);
    expect(list[0]).toMatchObject({
      category: "revise",
      invocation: "userOnly",
    });
    expect(list[1]).toMatchObject({ source: "global", description: "Mine" });
  });
});
