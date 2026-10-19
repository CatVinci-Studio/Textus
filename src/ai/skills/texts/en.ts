import type { SkillTexts } from "../builtin";

/** English: the source the other languages translate. */
export default {
  "continue-story": {
    label: "Continue the story",
    hint: "Write the next section in your voice, consistent with the library",
    aliases: ["continue", "next-scene"],
  },
  describe: {
    label: "Describe a scene or character",
    hint: "Add concrete, sensory detail to a person, place or scene",
    aliases: ["scene", "character"],
  },
  dialogue: {
    label: "Polish dialogue",
    hint: "Fix dialogue punctuation and speech tags for the document's language",
    aliases: ["dialog"],
  },
  "imitate-style": {
    label: "Imitate a style",
    hint: "Rewrite in the style of a sample or your style profile",
    aliases: ["style", "pastiche"],
  },
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
  "change-tone": {
    label: "Change tone",
    hint: "Make text more formal, plainer, warmer or firmer",
    aliases: ["tone", "formal", "plain"],
  },
  "de-ai": {
    label: "Remove AI tone",
    hint: "Take out stock AI phrasing, or just point it out",
    aliases: ["ai-tone"],
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
  email: {
    label: "Write an email",
    hint: "Draft or restructure an email or letter",
    aliases: ["letter", "reply"],
  },
  notice: {
    label: "Notice or official document",
    hint: "Draft or fix a notice, announcement or official letter",
    aliases: ["announcement", "memo"],
  },
  minutes: {
    label: "Meeting minutes",
    hint: "Turn notes into decisions and action items",
    aliases: ["action-items"],
  },
  "academic-polish": {
    label: "Academic polish",
    hint: "Formal, measured academic wording, citations untouched",
    aliases: ["academic", "paper"],
  },
  "social-post": {
    label: "Social post",
    hint: "Write a post that fits the platform's limits and rules",
    aliases: ["post", "tweet", "caption"],
  },
  headline: {
    label: "Headline or title",
    hint: "Write an accurate title of the right length",
    aliases: ["title", "subject"],
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
} satisfies SkillTexts;
