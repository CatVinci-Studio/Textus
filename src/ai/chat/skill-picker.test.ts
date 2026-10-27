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
  modes: [skill.mode],
  aliases: {},
}));

const own: SkillListItem = {
  name: "house-style",
  description: "Apply the house style",
  category: "revise",
  invocation: "both",
  source: "global",
  overridesBuiltin: false,
  modes: ["write"],
  aliases: {},
};

/** A skill from the market, as its file names it. */
const email: SkillListItem = {
  ...own,
  name: "email",
  description: "Drafts an email.",
  category: null,
  labels: {
    en: { label: "Write an email", hint: "Draft or restructure an email" },
    zh: { label: "写邮件", hint: "起草或重新组织一封邮件" },
  },
  aliases: { zh: ["邮件", "回信"] },
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
  it("offers only the mode's skills, and no hidden packs", () => {
    const items = [
      ...builtins,
      own,
      { ...own, name: "standards-en", invocation: "hidden" as never },
    ];
    const names = (mode: "write" | "review" | "create") =>
      pickerSkills(items, "en", mode).map((s) => s.name);
    expect(names("write")).toEqual(["house-style"]);
    expect(names("review")).toEqual(["proofread"]);
    expect(names("create")).toEqual(["theme", "plugin", "skill"]);
    // A skill in two modes is in both.
    const both = { ...own, modes: ["write", "review"] } as SkillListItem;
    expect(pickerSkills([both], "en", "review")).toHaveLength(1);
  });

  it("shows a built-in by its label and hint in the UI language", () => {
    const [first] = pickerSkills(builtins, "ja", "review");
    expect(first).toMatchObject({
      name: "proofread",
      label: SKILL_TEXTS.ja.proofread.label,
      category: "check",
    });
    // A user skill keeps its own name and description.
    const [mine] = pickerSkills([own], "ja", "write");
    expect(mine).toMatchObject({
      label: null,
      hint: "Apply the house style",
      category: null,
    });
  });

  it("shows a market skill by the label its file gives", () => {
    const [zh] = pickerSkills([email], "zh", "write");
    expect(zh).toMatchObject({
      label: "写邮件",
      hint: "起草或重新组织一封邮件",
    });
    // No label in the UI's language: the English one.
    const [ja] = pickerSkills([email], "ja", "write");
    expect(ja.label).toBe("Write an email");
    expect(resolveSkillName("写邮件", [ja])).toBe("email");
    expect(resolveSkillName("回信", [ja])).toBe("email");
  });

  it("adds the backend's aliases to the terms", () => {
    const [skill] = pickerSkills(
      [{ ...own, aliases: { en: ["house"], zh: ["文风手册"] } }],
      "zh",
      "write",
    );
    expect(skill.terms).toEqual(
      expect.arrayContaining(["house-style", "house", "文风手册"]),
    );
  });
});

describe.each(LANGS)("the theme skill in %s", (lang) => {
  const skills = pickerSkills(builtins, lang, "create");
  const text = SKILL_TEXTS[lang].theme;

  it("is in Create's / list under Make, by its label", () => {
    const theme = skills.find((s) => s.name === "theme");
    expect(theme).toMatchObject({ label: text.label, category: "create" });
    const create = groupSkills(skills, []).find((g) => g.id === "create")!;
    expect(create.skills.map((s) => s.name)).toEqual([
      "theme",
      "plugin",
      "skill",
    ]);
  });

  it("answers to /theme, its label and its aliases", () => {
    for (const term of ["theme", text.label, ...text.aliases])
      expect(resolveSkillName(term, skills), term).toBe("theme");
  });
});

/** The user's skills, in Create beside its built-ins. */
const inCreate = (skill: SkillListItem): SkillListItem => ({
  ...skill,
  modes: ["create"],
});

describe("matchSkills", () => {
  const skills = pickerSkills(
    [...builtins, inCreate(own), inCreate(email)],
    "zh",
    "create",
  );

  it("puts an exact alias first", () => {
    const alias = SKILL_TEXTS.zh.theme.aliases[0];
    expect(matchSkills(skills, alias, [])[0].name).toBe("theme");
    expect(matchSkills(skills, "邮件", [])[0].name).toBe("email");
  });

  it("matches names, labels and full-width letters, case-blind", () => {
    expect(matchSkills(skills, "ＰＬＵ", [])[0].name).toBe("plugin");
    expect(matchSkills(skills, "House", [])[0].name).toBe("house-style");
    // A CJK label matches inside, not only at its start.
    expect(matchSkills(skills, "邮", []).map((s) => s.name)).toContain("email");
  });

  it("finds another language's word too", () => {
    const ja = SKILL_TEXTS.ja.plugin.label;
    expect(matchSkills(skills, ja, [])[0].name).toBe("plugin");
  });

  it("breaks ties in favour of the recently used", () => {
    const two = pickerSkills(
      [
        inCreate({ ...own, name: "tab-a" }),
        inCreate({ ...own, name: "tab-b" }),
      ],
      "en",
      "create",
    );
    const names = matchSkills(two, "tab", ["tab-b"]).map((s) => s.name);
    expect(names.indexOf("tab-b")).toBeLessThan(names.indexOf("tab-a"));
  });
});

describe("groupSkills", () => {
  const skills = pickerSkills(
    [...builtins, inCreate(own), inCreate(project)],
    "en",
    "create",
  );

  it("lists recent, project, yours, then the built-ins by category", () => {
    const groups = groupSkills(skills, ["plugin", "skill"]);
    expect(groups.map((g) => g.id)).toEqual([
      "recent",
      "project",
      "global",
      "create",
    ]);
    expect(groups[0].skills.map((s) => s.name)).toEqual(["plugin", "skill"]);
    // Not listed twice.
    const create = groups.find((g) => g.id === "create")!;
    expect(create.skills.map((s) => s.name)).toEqual(["theme"]);
  });

  it("leaves empty groups out", () => {
    expect(
      groupSkills(pickerSkills([own], "en", "write"), []).map((g) => g.id),
    ).toEqual(["global"]);
  });
});

describe("resolveSkillName", () => {
  const skills = pickerSkills([...builtins, inCreate(project)], "en", "create");

  it("maps an alias in any language to the canonical name", () => {
    expect(resolveSkillName(SKILL_TEXTS.zh.theme.label, skills)).toBe("theme");
    expect(resolveSkillName(SKILL_TEXTS.ko.plugin.label, skills)).toBe(
      "plugin",
    );
    expect(resolveSkillName("Theme", skills)).toBe("theme");
    expect(resolveSkillName("会议纪要", skills)).toBe("会议纪要");
    expect(resolveSkillName("usr/bin", skills)).toBeNull();
    expect(resolveSkillName("nope", skills)).toBeNull();
  });

  it("prefers a skill's own name over another skill's alias", () => {
    // A user's skill named like a built-in alias wins.
    const alias = SKILL_TEXTS.zh.theme.aliases[0];
    const withShadow = pickerSkills(
      [...builtins, inCreate({ ...own, name: alias })],
      "en",
      "create",
    );
    expect(resolveSkillName(alias, withShadow)).toBe(alias);
  });
});

describe("listFromWorkspace", () => {
  it("files built-ins under their category and the rest as the user's", () => {
    const list = listFromWorkspace([
      { name: "theme", description: "", prompt: "Draw." },
      { name: "mine", description: "Mine", prompt: "Do." },
    ]);
    expect(list[0]).toMatchObject({
      category: "create",
      invocation: "both",
    });
    expect(list[1]).toMatchObject({ source: "global", description: "Mine" });
  });
});
