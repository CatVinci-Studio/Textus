import type { SkillTexts } from "../builtin";

/** English: the source the other languages translate. */
export default {
  expand: {
    label: "Expand",
    hint: "Make a passage fuller without adding facts",
    aliases: ["elaborate"],
  },
  tighten: {
    label: "Tighten",
    hint: "Cut the wordiness and keep every fact",
    aliases: ["shorten", "concise"],
  },
  translate: {
    label: "Translate and polish",
    hint: "Translate so it reads like native writing",
    aliases: ["translation"],
  },
  proofread: {
    label: "Proofread",
    hint: "Check spelling, punctuation and numbers against your language's standards",
    aliases: ["typos", "check"],
  },
  continuity: {
    label: "Check continuity",
    hint: "Find contradictions with the library and other chapters",
    aliases: ["consistency"],
  },
  summarize: {
    label: "Summarize",
    hint: "Sum up faithfully, at the length you ask for",
    aliases: ["summary", "tldr", "abstract"],
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
