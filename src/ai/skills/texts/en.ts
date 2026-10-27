import type { SkillTexts } from "../builtin";

/** English: the source the other languages translate. */
export default {
  proofread: {
    label: "Proofread",
    hint: "Check spelling, punctuation and numbers against your language's standards",
    aliases: ["typos", "check"],
  },
  theme: {
    label: "Design a theme",
    hint: "Write an editor theme from your description, ready to use",
    aliases: ["theme-css", "stylesheet"],
  },
  plugin: {
    label: "Make a plugin",
    hint: "Build a small Textus plugin from your description, ready to install",
    aliases: ["make-plugin", "extension", "add-on"],
  },
  skill: {
    label: "Make a skill",
    hint: "Save a task you repeat as a skill you call with /",
    aliases: ["make-skill", "new skill"],
  },
} satisfies SkillTexts;
